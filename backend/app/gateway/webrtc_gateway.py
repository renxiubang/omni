import asyncio
import json
import logging

import numpy as np
from aiortc import RTCPeerConnection, RTCSessionDescription, MediaStreamTrack
from av import AudioFrame, AudioResampler
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.config import settings
from app.services.realtime_client import RealtimeAPIClient

logger = logging.getLogger(__name__)
router = APIRouter()

# 存储活跃的 PeerConnection
pcs = set()


class QwenAudioTrack(MediaStreamTrack):
    """自定义音频轨道，用于发送 AI 音频给前端（24kHz → 48kHz 重采样）"""
    kind = "audio"

    # WebRTC 期望的音频参数
    SAMPLE_RATE = 48000     # 48kHz
    FRAME_SIZE = 480        # 10ms @ 48kHz = 480 samples
    FRAME_BYTES = 480 * 2   # 16-bit = 2 bytes/sample
    FRAME_DURATION_US = 10000
    GAIN = 2.0              # +6dB 音量增益

    def __init__(self):
        super().__init__()
        self.queue: asyncio.Queue = asyncio.Queue()
        self._ended = False
        self._MediaStreamTrack__ended = False
        self._pcm_buffer = b""
        self._pts_us = 0
        self._frame_count = 0
        # 每个连接独立的 resampler（避免全局共享的竞态问题）
        self._resampler = AudioResampler(format='s16', layout='mono', rate=self.SAMPLE_RATE)

    async def recv(self):
        """返回下一个 10ms 音频帧（迭代模式，无递归风险）"""
        if self._ended:
            return None

        while True:
            # 1. 缓冲区有足够数据 → 直接返回一帧
            if len(self._pcm_buffer) >= self.FRAME_BYTES:
                return self._pop_frame()

            # 2. 缓冲区不足 → 从队列获取新数据
            pcm_24k_data = await self.queue.get()
            if pcm_24k_data is None:
                # 结束标记：排空缓冲区后返回 None
                self._ended = True
                self._MediaStreamTrack__ended = True
                logger.info("QwenAudioTrack: end marker received, draining buffer")
                if len(self._pcm_buffer) > 0:
                    return self._pop_frame(pad=True)
                return None

            # 3. 重采样并写入缓冲区
            try:
                self._append_resampled(pcm_24k_data)
            except Exception:
                logger.exception("QwenAudioTrack: resample failed, skipping chunk")
                # 继续循环，不返回静音帧（静音帧会掩藏错误）

    def _pop_frame(self, pad: bool = False) -> AudioFrame | None:
        """从缓冲区取出 10ms 帧，必要时补零"""
        needed = self.FRAME_BYTES
        chunk = self._pcm_buffer[:needed]
        self._pcm_buffer = self._pcm_buffer[needed:]

        if len(chunk) < needed:
            if not pad:
                return None
            chunk += b'\x00' * (needed - len(chunk))

        arr = np.frombuffer(chunk, dtype=np.int16).reshape(1, -1)
        frame = AudioFrame.from_ndarray(arr, format='s16', layout='mono')
        frame.sample_rate = self.SAMPLE_RATE
        frame.pts = self._pts_us
        self._pts_us += self.FRAME_DURATION_US

        self._frame_count += 1
        if logger.isEnabledFor(logging.DEBUG) and self._frame_count % 100 == 0:
            logger.debug(f"Sending frame #{self._frame_count}: pts={frame.pts}us")
        return frame

    def _append_resampled(self, pcm_24k_bytes: bytes) -> None:
        """将百炼返回的 24kHz PCM 重采样为 48kHz 并追加到缓冲区"""
        arr = np.frombuffer(pcm_24k_bytes, dtype=np.int16)

        # +6dB 增益，clip 防止溢出
        arr = np.clip(arr.astype(np.float32) * self.GAIN, -32768, 32767).astype(np.int16)

        frame_24k = AudioFrame.from_ndarray(
            arr.reshape(1, -1).copy(), format='s16', layout='mono'
        )
        frame_24k.sample_rate = 24000

        frames_48k = self._resampler.resample(frame_24k)
        if not frames_48k:
            return  # resampler 尚未积累足够样本，下次继续

        for f in frames_48k:
            self._pcm_buffer += f.to_ndarray().tobytes()


@router.post("/api/webrtc/offer")
async def offer(request: Request):
    """处理 WebRTC SDP offer，返回 answer"""
    params = await request.json()
    logger.info(f"Received SDP offer, session_id={params.get('session_id', 'unknown')}")
    
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

    pc = RTCPeerConnection()
    pcs.add(pc)
    logger.info(f"Created PeerConnection, total={len(pcs)}")

    # 初始化发往浏览器的音频轨道和百炼客户端
    qwen_track = QwenAudioTrack()
    qwen_client = RealtimeAPIClient(
        api_key=settings.dashscope_api_key,
        url=settings.dashscope_realtime_url
    )
    logger.info("Initialized QwenAudioTrack and RealtimeAPIClient")

    # 添加音频轨道到 PeerConnection（发给前端）
    pc.addTrack(qwen_track)
    logger.info("Added QwenAudioTrack to PeerConnection")

    # 守卫：防止 on_track 被多次调用
    _track_processing_started = False

    @pc.on("track")
    def on_track(track):
        nonlocal _track_processing_started
        logger.info(f"Received track: kind={track.kind}, id={track.id}")

        if _track_processing_started:
            logger.warning("Track already being processed, skipping duplicate: %s", track.id)
            return
        _track_processing_started = True

        if track.kind == "audio":
            logger.info("Received browser mic audio stream (AEC processed)")

            # 每个连接独立的重采样器，48kHz → 16kHz
            mic_resampler = AudioResampler(format='s16', layout='mono', rate=16000)

            async def process_audio():
                try:
                    logger.info("Connecting to DashScope Realtime API...")
                    await qwen_client.connect()
                    logger.info("Connected to DashScope Realtime API")

                    # 启动 AI 音频接收任务
                    async def relay_audio():
                        while True:
                            pcm_24k = await qwen_client.receive_audio()
                            if pcm_24k is None:
                                logger.info("relay_audio: ended")
                                break
                            await qwen_track.queue.put(pcm_24k)

                    asyncio.create_task(relay_audio())

                    # 主循环：接收前端音频 → 重采样 → 发送百炼
                    frame_count = 0
                    try:
                        while True:
                            try:
                                frame = await track.recv()
                                frame_count += 1

                                if frame_count % 100 == 0:
                                    logger.debug("Received %d audio frames from frontend", frame_count)

                                for f in mic_resampler.resample(frame):
                                    await qwen_client.send_audio(f.to_ndarray().tobytes())
                            except Exception:
                                if pc.connectionState in ("failed", "closed", "disconnected"):
                                    logger.info("PeerConnection %s, stopping audio receive", pc.connectionState)
                                else:
                                    logger.exception("Audio processing error")
                                break
                        logger.info("Audio receiving stopped, total frames=%d", frame_count)
                    except asyncio.CancelledError:
                        logger.info("Audio processing task cancelled")
                except Exception:
                    logger.exception("process_audio error")

            asyncio.create_task(process_audio())

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        logger.info(f"Connection state change: {pc.connectionState}")
        if pc.connectionState in ["failed", "closed"]:
            logger.info("Connection failed or closed, cleaning up")
            await qwen_client.close()
            pcs.discard(pc)

    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    logger.info(f"SDP answer created, state={pc.connectionState}")

    return JSONResponse({
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type
    })


async def on_shutdown(app):
    """应用关闭时清理所有 PeerConnection"""
    coros = [pc.close() for pc in pcs]
    await asyncio.gather(*coros)
    pcs.clear()
    logger.info("All WebRTC connections closed")
