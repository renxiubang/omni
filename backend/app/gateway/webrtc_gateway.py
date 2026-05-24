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

    def __init__(self):
        super().__init__()
        self.queue = asyncio.Queue()
        self._ended = False

    async def recv(self):
        """接收从百炼来的音频数据，重采样后发送给前端"""
        if self._ended:
            return None

        pcm_16k_data = await self.queue.get()
        if pcm_16k_data is None:
            # 结束标记
            self._ended = True
            return None

        # 转换为 AV AudioFrame (16kHz)
        pcm_int16 = np.frombuffer(pcm_16k_data, dtype=np.int16)
        frame_16k = AudioFrame.from_ndarray(
            pcm_int16.reshape(1, -1),
            layout='mono',
            rate=16000
        )

        # 重采样为 48kHz 以适配 WebRTC
        frames_48k = resampler_to_48k.resample(frame_16k)
        return frames_48k[0] if frames_48k else frame_16k


@router.post("/api/webrtc/offer")
async def offer(request: Request):
    """处理 WebRTC SDP offer，返回 answer"""
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

    pc = RTCPeerConnection()
    pcs.add(pc)

    # 初始化发往浏览器的音频轨道和百炼客户端
    qwen_track = QwenAudioTrack()
    qwen_client = RealtimeAPIClient(
        api_key=settings.dashscope_api_key,
        url=settings.dashscope_realtime_url
    )

    # 添加音频轨道到 PeerConnection（发给前端）
    pc.addTrack(qwen_track)

    @pc.on("track")
    def on_track(track):
        if track.kind == "audio":
            logger.info("接收到浏览器麦克风音频流（已 AEC 净化）")

            async def process_audio():
                try:
                    # 连接百炼
                    await qwen_client.connect()

                    # 启动音频接收任务
                    async def relay_audio():
                        while True:
                            pcm_16k = await qwen_client.receive_audio()
                            if pcm_16k is None:
                                break
                            await qwen_track.queue.put(pcm_16k)

                    asyncio.create_task(relay_audio())

                    # 处理从前端来的音频
                    while True:
                        try:
                            frame = await track.recv()
                            # 将 48kHz 重采样为 16kHz
                            frames_16k = resampler_to_16k.resample(frame)
                            for f in frames_16k:
                                pcm_bytes = f.to_ndarray().tobytes()
                                await qwen_client.send_audio(pcm_bytes)
                        except Exception as e:
                            logger.error(f"Audio processing error: {e}")
                            break
                except Exception as e:
                    logger.exception(f"Process audio error: {e}")

            asyncio.create_task(process_audio())

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        logger.info(f"Connection state change: {pc.connectionState}")
        if pc.connectionState in ["failed", "closed"]:
            await qwen_client.close()
            pcs.discard(pc)

    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

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
