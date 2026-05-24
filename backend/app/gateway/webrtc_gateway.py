import asyncio
import json
import logging

import numpy as np
from aiortc import RTCPeerConnection, RTCSessionDescription, MediaStreamTrack
from av import AudioFrame, AudioResampler
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.config import settings
from app.services.realtime_client import RealtimeAPIClient, _RESET_AUDIO

logger = logging.getLogger(__name__)
router = APIRouter()

# 存储活跃的 PeerConnection
pcs = set()


# 队列哨兵类型：指示 resampler 需要重置（跨轮次状态清理）
_RESET_SENTINEL = object()


class QwenAudioTrack(MediaStreamTrack):
    """自定义音频轨道，用于发送 AI 音频给前端（24kHz → 48kHz 重采样）

    架构设计（解决音频颤抖 + 静音问题）：
    - 后台 drain 任务持续从队列拉取数据 → 重采样 → 写入 _pcm_buffer
    - IDLE 态（无音频生成）：recv() 非阻塞，buffer 空 → 返回静音帧
    - RESPONDING 态（LLM 正在生成）：recv() 通过 _buffer_ready 事件等待
      （最多 50ms），避免帧缺失导致的颤抖
    - 状态切换：收到音频数据 → RESPONDING；收到 _RESET_SENTINEL → IDLE
    """

    kind = "audio"

    SAMPLE_RATE = 48000
    FRAME_SIZE = 480          # 10ms @ 48kHz
    FRAME_BYTES = FRAME_SIZE * 2
    FRAME_DURATION_US = 10000
    GAIN = 2.0                # +6dB 音量增益
    RESPONDING_TIMEOUT = 0.1   # 100ms（10 帧窗口，减少静音帧）

    # 前置静音裁剪参数
    SILENCE_THRESHOLD = 100       # 幅度 < 此值视为静音（int16）
    MAX_STRIP_MS = 300            # 最多裁剪 300ms 静音（48kHz 下 = 14400 样本）

    def __init__(self):
        super().__init__()
        self.queue: asyncio.Queue = asyncio.Queue()
        self._ended = False
        self._MediaStreamTrack__ended = False
        self._pcm_buffer = b""
        self._pts_us = 0
        self._output_frame_count = 0
        self._silence_count = 0
        self._drain_chunk_count = 0

        # 状态机：IDLE ↔ RESPONDING
        self._is_generating = False
        self._buffer_ready = asyncio.Event()

        # 前置静音裁剪状态
        self._strip_silence = True           # 新一轮对话需裁剪前置静音
        self._stripped_samples = 0           # 已裁剪的静音样本数

        self._drain_task: asyncio.Task | None = None

    # ── 公开接口 ──────────────────────────────────────────────

    def start_drain(self) -> None:
        """启动后台灌流任务（外部创建后调用一次）"""
        if self._drain_task is None:
            self._drain_task = asyncio.create_task(self._drain_queue())

    # ── MediaStreamTrack 接口 ─────────────────────────────────

    async def recv(self):
        """返回下一个 10ms 音频帧，RESPONDING 时短等数据到达"""
        if self._ended:
            if len(self._pcm_buffer) > 0:
                return self._pop_frame(pad=True)
            return None

        # 快速路径：buffer 有数据，直接返回
        if len(self._pcm_buffer) >= self.FRAME_BYTES:
            return self._pop_frame()

        # IDLE 态：非阻塞返回静音（保持 WebRTC 管线不断流）
        if not self._is_generating:
            self._silence_count += 1
            if self._silence_count <= 3 or self._silence_count % 300 == 0:
                logger.debug("QwenAudioTrack: IDLE silence #%d", self._silence_count)
            return self._create_silence_frame()

        # RESPONDING 态：等待 _drain_queue 填满 buffer
        try:
            await asyncio.wait_for(self._buffer_ready.wait(), timeout=self.RESPONDING_TIMEOUT)
            self._buffer_ready.clear()
        except asyncio.TimeoutError:
            pass  # 超时：LLM 音频块还没到

        # 再次检查
        if len(self._pcm_buffer) >= self.FRAME_BYTES:
            return self._pop_frame()

        # 仍然空 → 返回静音（RESPONDING 态下的短暂静音）
        self._silence_count += 1
        if self._silence_count <= 5 or self._silence_count % 100 == 0:
            logger.warning(
                "QwenAudioTrack: RESPONDING starved → silence #%d (output=%d, chunks=%d, buffer=%dB, gen=%s)",
                self._silence_count, self._output_frame_count,
                self._drain_chunk_count, len(self._pcm_buffer), self._is_generating,
            )
        return self._create_silence_frame()

    # ── 内部方法 ──────────────────────────────────────────────

    async def _drain_queue(self):
        """后台任务：持续从队列拉取 → 重采样 → 写入 buffer，管理状态切换"""
        logger.info("QwenAudioTrack: _drain_queue started")
        while True:
            item = await self.queue.get()
            if item is None:
                logger.info("QwenAudioTrack: end signal, drain stopping (chunks=%d)", self._drain_chunk_count)
                self._ended = True
                self._MediaStreamTrack__ended = True
                self._buffer_ready.set()  # 唤醒可能等待中的 recv()
                break
            if item is _RESET_SENTINEL:
                logger.debug("QwenAudioTrack: reset → IDLE (chunks=%d, output=%d)",
                             self._drain_chunk_count, self._output_frame_count)
                self._is_generating = False
                self._drain_chunk_count = 0
                self._reset_resampler()
                continue
            try:
                # 收到音频数据 → 进入 RESPONDING 态
                if not self._is_generating:
                    logger.info("QwenAudioTrack: first audio chunk → RESPONDING")
                    self._is_generating = True

                self._drain_chunk_count += 1
                buf_before = len(self._pcm_buffer)
                self._append_resampled(item)
                buf_after = len(self._pcm_buffer)

                if self._drain_chunk_count <= 3 or self._drain_chunk_count % 50 == 0:
                    logger.info(
                        "QwenAudioTrack: chunk #%d | input=%dB | buffer %d→%d bytes",
                        self._drain_chunk_count, len(item), buf_before, buf_after,
                    )

                # buffer 有足够数据 → 通知 recv()
                if len(self._pcm_buffer) >= self.FRAME_BYTES:
                    self._buffer_ready.set()
            except Exception:
                logger.exception("QwenAudioTrack: resample failed, skipping chunk")

    def _pop_frame(self, pad: bool = False) -> AudioFrame:
        """从缓冲区取出 10ms 帧"""
        needed = self.FRAME_BYTES
        chunk = self._pcm_buffer[:needed]
        self._pcm_buffer = self._pcm_buffer[needed:]

        if len(chunk) < needed:
            if not pad:
                return self._create_silence_frame()
            chunk += b'\x00' * (needed - len(chunk))

        arr = np.frombuffer(chunk, dtype=np.int16).reshape(1, -1)

        # 调试：前 3 帧打印峰值确认裁剪生效
        fc = self._output_frame_count
        if fc < 3 and self._is_generating:
            peak = np.max(np.abs(arr))
            logger.info(
                "QwenAudioTrack: >>> OUTPUT frame#%d | peak=%d | buf_left=%dB",
                fc, peak, len(self._pcm_buffer),
            )

        frame = AudioFrame.from_ndarray(arr, format='s16', layout='mono')
        frame.sample_rate = self.SAMPLE_RATE
        frame.pts = self._pts_us
        self._pts_us += self.FRAME_DURATION_US
        self._output_frame_count += 1
        return frame

    def _create_silence_frame(self) -> AudioFrame:
        """创建静音帧"""
        silence = np.zeros((1, self.FRAME_SIZE), dtype=np.int16)
        frame = AudioFrame.from_ndarray(silence, format='s16', layout='mono')
        frame.sample_rate = self.SAMPLE_RATE
        frame.pts = self._pts_us
        self._pts_us += self.FRAME_DURATION_US
        return frame

    def _append_resampled(self, pcm_24k_bytes: bytes) -> None:
        """24kHz → 48kHz 重采样，裁剪前置静音后追加到缓冲区"""
        arr = np.frombuffer(pcm_24k_bytes, dtype=np.int16).astype(np.int32)
        arr = np.clip(arr * self.GAIN, -32768, 32767).astype(np.int16)

        # 2x 上采样：24kHz → 48kHz，线性插值
        n = len(arr)
        upsampled = np.zeros(n * 2, dtype=np.int16)
        upsampled[0::2] = arr
        if n > 1:
            upsampled[1:-1:2] = ((arr[:-1].astype(np.int32) + arr[1:].astype(np.int32)) // 2).astype(np.int16)
        upsampled[-1] = arr[-1]

        # 前置静音裁剪：新对话的第一个音频块可能以静音开头
        max_strip = int(self.MAX_STRIP_MS / 1000 * self.SAMPLE_RATE)  # 48kHz 下最大裁剪样本数
        if self._strip_silence and self._stripped_samples < max_strip:
            nonzero_idx = -1
            remaining_budget = max_strip - self._stripped_samples
            search_limit = min(len(upsampled), remaining_budget)
            abs_arr = np.abs(upsampled[:search_limit])
            candidates = np.where(abs_arr >= self.SILENCE_THRESHOLD)[0]
            if len(candidates) > 0:
                nonzero_idx = int(candidates[0])
            else:
                # 整个块在预算内都是静音 → 全部丢弃
                if len(upsampled) <= remaining_budget:
                    self._stripped_samples += len(upsampled)
                    logger.debug(
                        "QwenAudioTrack: stripped entire silent chunk #%d (%d samples, total stripped=%d)",
                        self._drain_chunk_count, len(upsampled), self._stripped_samples,
                    )
                    return

            if nonzero_idx >= 0:
                stripped = nonzero_idx
                self._stripped_samples += stripped
                self._strip_silence = False
                upsampled = upsampled[nonzero_idx:]
                logger.info(
                    "QwenAudioTrack: stripped %d leading silence samples "
                    "(total=%d ms), keeping %d samples",
                    stripped,
                    int(self._stripped_samples / self.SAMPLE_RATE * 1000),
                    len(upsampled),
                )

        self._pcm_buffer += upsampled.tobytes()

    def _reset_resampler(self) -> None:
        """清空缓冲区，重置裁剪状态（跨对话轮次调用）"""
        logger.debug("QwenAudioTrack: resetting buffer for new turn")
        self._pcm_buffer = b""
        self._strip_silence = True
        self._stripped_samples = 0


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
    qwen_track.start_drain()  # 启动后台灌流任务
    qwen_client = RealtimeAPIClient(
        api_key=settings.dashscope_api_key,
        url=settings.dashscope_realtime_url
    )
    logger.info("Initialized QwenAudioTrack and RealtimeAPIClient")

    # 添加音频轨道到 PeerConnection（发给前端）
    pc.addTrack(qwen_track)
    logger.info("Added QwenAudioTrack to PeerConnection")

    # 创建 DataChannel 用于发送字幕和事件
    datachannel = pc.createDataChannel("oai-events")
    logger.info("Created DataChannel: oai-events")

    # 监听 DataChannel 打开事件
    @datachannel.on("open")
    def on_datachannel_open():
        logger.info("DataChannel opened, starting subtitle relay")
        # 启动字幕中继任务
        async def relay_subtitles():
            while True:
                try:
                    subtitle_data = await qwen_client.receive_subtitle()
                    if subtitle_data is None:
                        logger.info("Subtitle relay: ended")
                        break
                    # 通过 DataChannel 发送字幕给前端
                    if datachannel.readyState == "open":
                        message = json.dumps(subtitle_data, ensure_ascii=False)
                        datachannel.send(message)
                        logger.debug("Sent subtitle: %s", subtitle_data.get("delta", "")[:50])
                except Exception as e:
                    logger.exception("Subtitle relay error: %s", e)
                    break
        asyncio.create_task(relay_subtitles())

    @datachannel.on("close")
    def on_datachannel_close():
        logger.info("DataChannel closed")

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

                    # 启动 AI 音频中继任务（从百炼拉取 → 推入 qwen_track 队列）
                    async def relay_audio():
                        while True:
                            item = await qwen_client.receive_audio()
                            if item is None:
                                logger.info("relay_audio: ended")
                                break
                            if item == _RESET_AUDIO:
                                await qwen_track.queue.put(_RESET_SENTINEL)
                            else:
                                await qwen_track.queue.put(item)

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
