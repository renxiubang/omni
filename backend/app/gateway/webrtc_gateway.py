import asyncio
import json
import logging
from pathlib import Path

import numpy as np
from aiortc import RTCPeerConnection, RTCSessionDescription, MediaStreamTrack
from av import AudioFrame, AudioResampler
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.config import settings
from app.services.realtime_client import RealtimeAPIClient

logger = logging.getLogger(__name__)
router = APIRouter()

# 音频重采样器
resampler_to_16k = AudioResampler(format='s16', layout='mono', rate=16000)
resampler_to_48k = AudioResampler(format='s16', layout='mono', rate=48000)

# 存储活跃的 PeerConnection
pcs = set()


class QwenAudioTrack(MediaStreamTrack):
    """自定义音频轨道，用于发送 AI 音频给前端"""
    kind = "audio"
    
    # WebRTC 期望的音频参数
    SAMPLE_RATE = 48000  # 48kHz
    FRAME_SIZE = 480      # 10ms 帧 = 480 samples @ 48kHz
    FRAME_DURATION_US = 10000  # 10ms = 10000 微秒

    def __init__(self):
        super().__init__()
        self.queue = asyncio.Queue()
        self._ended = False
        # aiortc MediaStreamTrack 使用双下划线（name mangling）
        # 需要设置 _MediaStreamTrack__ended = False 才能让 readyState 返回 "live"
        self._MediaStreamTrack__ended = False
        # 重采样后的音频数据缓冲区（PCM 数据）
        self._pcm_buffer = b""
        # PTS 计数器（微秒单位）
        self._pts_us = 0

    async def recv(self):
        """接收从百炼来的音频数据，重采样后发送给前端"""
        if self._ended:
            logger.debug("QwenAudioTrack.recv: ended, returning None")
            return None

        # 如果 PCM 缓冲区还有数据，先返回 10ms 帧
        if len(self._pcm_buffer) >= self.FRAME_SIZE * 2:  # 16-bit = 2 bytes/sample
            frame_data = self._pcm_buffer[:self.FRAME_SIZE * 2]
            self._pcm_buffer = self._pcm_buffer[self.FRAME_SIZE * 2:]
            
            # 创建 AudioFrame
            pcm_int16 = np.frombuffer(frame_data, dtype=np.int16)
            frame = AudioFrame.from_ndarray(
                pcm_int16.reshape(1, -1),
                format='s16',
                layout='mono'
            )
            frame.sample_rate = self.SAMPLE_RATE
            frame.pts = self._pts_us
            self._pts_us += self.FRAME_DURATION_US
            
            # 打印调试信息（每 10 帧打印一次）
            if not hasattr(self, '_frame_count'):
                self._frame_count = 0
            self._frame_count += 1
            if self._frame_count % 10 == 0:
                frame_data_arr = frame.to_ndarray()
                logger.info(f"🔊 Sending frame #{self._frame_count}: "
                           f"samples={frame.samples}, pts={frame.pts}us, "
                           f"mean={frame_data_arr.mean():.2f}, std={frame_data_arr.std():.2f}")
            
            return frame

        # 缓冲区数据不足，从队列获取新的音频数据
        pcm_16k_data = await self.queue.get()
        if pcm_16k_data is None:
            # 结束标记
            self._ended = True
            logger.info("QwenAudioTrack.recv: received end marker, setting _ended=True")
            self._MediaStreamTrack__ended = True
            
            # 如果缓冲区还有剩余数据，返回最后的帧
            if len(self._pcm_buffer) > 0:
                # 补零到 10ms
                remaining = self.FRAME_SIZE * 2 - len(self._pcm_buffer)
                if remaining > 0:
                    self._pcm_buffer += b'\x00' * remaining
                return await self.recv()
            
            return None

        try:
            # 转换为 AV AudioFrame (24kHz - 百炼 Realtime API 默认输出采样率)
            pcm_int16 = np.frombuffer(pcm_16k_data, dtype=np.int16)
            
            # 验证输入数据（前 3 帧打印）
            if not hasattr(self, '_input_frame_count'):
                self._input_frame_count = 0
            self._input_frame_count += 1
            if self._input_frame_count <= 3:
                logger.warning(f"🔊 Input data check #{self._input_frame_count}: "
                               f"mean={pcm_int16.mean():.2f}, std={pcm_int16.std():.2f}, "
                               f"first_10={pcm_int16[:10].tolist()}, "
                               f"bytes={len(pcm_16k_data)}, samples={len(pcm_int16)}")
            
            # 创建 AudioFrame - 百炼返回的是 24kHz 采样率
            # 参考 config.py: dashscope_audio_sample_rate: int = 24000
            frame_24k = AudioFrame.from_ndarray(
                pcm_int16.reshape(1, -1).copy(),  # 使用 copy() 确保数据被正确复制
                format='s16',
                layout='mono'
            )
            frame_24k.sample_rate = 24000  # 百炼 Realtime API 输出采样率
            frame_24k.pts = self._pts_us  # 使用相同的 PTS 基准
            
            # 重采样为 48kHz 以适配 WebRTC
            frames_48k = resampler_to_48k.resample(frame_24k)
            
            if not frames_48k:
                logger.warning("🔊 QwenAudioTrack.recv: resampling produced no frames, skipping")
                # 递归调用以获取下一帧（避免返回 None 导致轨道结束）
                return await self.recv()
            
            # 将所有重采样后的帧数据合并到缓冲区
            for f in frames_48k:
                f_data = f.to_ndarray().tobytes()
                self._pcm_buffer += f_data
                if not hasattr(self, '_resample_count'):
                    self._resample_count = 0
                self._resample_count += 1
                logger.debug(f"🔊 Resampled frame {self._resample_count}: "
                            f"samples={f.samples}, pts={f.pts}")
            
            # 递归调用以返回第一帧
            return await self.recv()
            
        except Exception as e:
            logger.error(f"QwenAudioTrack.recv error: {type(e).__name__}: {e}")
            import traceback
            logger.error(traceback.format_exc())
            # 发生错误时，返回静音帧而不是结束轨道
            return self._create_silence_frame()

    def _create_silence_frame(self):
        """创建静音帧（用于错误恢复）"""
        silence = np.zeros((1, self.FRAME_SIZE), dtype=np.int16)  # 10ms @ 48kHz
        frame = AudioFrame.from_ndarray(silence, format='s16', layout='mono')
        frame.sample_rate = self.SAMPLE_RATE
        frame.pts = self._pts_us
        self._pts_us += self.FRAME_DURATION_US
        return frame


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
        
        # 防止重复处理
        if _track_processing_started:
            logger.warning(f"⚠️ Track already being processed, skipping duplicate track: {track.id}")
            return
        _track_processing_started = True
        
        if track.kind == "audio":
            logger.info("接收到浏览器麦克风音频流（已 AEC 净化）")

            async def process_audio():
                try:
                    # 连接百炼
                    logger.info("Connecting to 百炼 Realtime API...")
                    await qwen_client.connect()
                    logger.info("Successfully connected to 百炼 Realtime API")

                    # 启动音频接收任务
                    async def relay_audio():
                        logger.info("Started relay_audio task")
                        while True:
                            pcm_16k = await qwen_client.receive_audio()
                            if pcm_16k is None:
                                logger.info("relay_audio: received None, ending")
                                break
                            logger.debug(f"relay_audio: received {len(pcm_16k)} bytes")
                            await qwen_track.queue.put(pcm_16k)

                    asyncio.create_task(relay_audio())
                    logger.info("Created relay_audio task")

                    # 处理从前端来的音频
                    logger.info("Started receiving audio from frontend")
                    audio_frame_count = 0
                    try:
                        while True:
                            try:
                                frame = await track.recv()
                                audio_frame_count += 1
                                
                                # 每 100 帧打印一次日志（约 2 秒）
                                if audio_frame_count % 100 == 0:
                                    logger.info(f"Received {audio_frame_count} audio frames from frontend")
                                
                                # 将 48kHz 重采样为 16kHz
                                frames_16k = resampler_to_16k.resample(frame)
                                for f in frames_16k:
                                    pcm_bytes = f.to_ndarray().tobytes()
                                    await qwen_client.send_audio(pcm_bytes)
                            except Exception as e:
                                # 检查是否是连接关闭导致的错误
                                if pc.connectionState in ["failed", "closed", "disconnected"]:
                                    logger.info(f"PeerConnection closed ({pc.connectionState}), stopping audio receive")
                                else:
                                    logger.error(f"Audio processing error: {type(e).__name__}: {e}")
                                break
                        logger.info(f"Audio receiving stopped, total frames={audio_frame_count}")
                    except asyncio.CancelledError:
                        logger.info("Audio processing task cancelled")
                except Exception as e:
                    logger.exception(f"Process audio error: {e}")

            asyncio.create_task(process_audio())
            logger.info("Created process_audio task")

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
