"""DashScope Realtime API WebSocket 客户端（VAD 模式）。

直连百炼 Realtime API，服务端 VAD 自动检测语音起止，实时返回文本和音频。
"""

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable

import websockets

from app.config import settings

logger = logging.getLogger(__name__)


class RealtimeClient:
    """DashScope Qwen-Omni Realtime WebSocket 客户端。

    每个语音通话会话对应一个 RealtimeClient 实例。
    通过回调机制将 DashScope 事件转发给上层（call_ws.py）。
    """

    def __init__(self, instructions: str) -> None:
        self._instructions = instructions
        self._ws: websockets.WebSocketClientProtocol | None = None
        self._recv_task: asyncio.Task | None = None

        # --- 回调 ---
        self.on_speech_started: Callable[[], Awaitable[None]] | None = None
        self.on_speech_stopped: Callable[[], Awaitable[None]] | None = None
        # AI 回复的文字转录（response.audio_transcript.*）
        self.on_transcript_delta: Callable[[str], Awaitable[None]] | None = None
        self.on_transcript_done: Callable[[str], Awaitable[None]] | None = None
        # 用户语音 ASR 转写（conversation.item.input_audio_transcription.*）
        self.on_user_transcript_delta: Callable[[str], Awaitable[None]] | None = None
        self.on_user_transcript_done: Callable[[str], Awaitable[None]] | None = None
        self.on_audio_delta: Callable[[str], Awaitable[None]] | None = None
        self.on_response_done: Callable[[], Awaitable[None]] | None = None
        self.on_error: Callable[[str], Awaitable[None]] | None = None

    async def connect(self) -> None:
        """建立 WebSocket 连接并配置 VAD 模式会话。"""
        url = settings.dashscope_realtime_url
        extra_headers = {"Authorization": f"Bearer {settings.dashscope_api_key}"}
        logger.info("RealtimeClient: connecting to %s", url)

        self._ws = await websockets.connect(url, additional_headers=extra_headers)

        # 发送 session.update 配置 VAD 模式
        await self._send({
            "type": "session.update",
            "session": {
                "modalities": ["text", "audio"],
                "voice": settings.omni_voice,
                "input_audio_format": "pcm",
                "output_audio_format": "pcm",
                "instructions": self._instructions,
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": 0.5,
                    "silence_duration_ms": 800,
                },
                "input_audio_transcription": {
                    "model": "qwen3-asr-flash-realtime",
                },
            },
        })

        # 启动事件接收循环
        self._recv_task = asyncio.create_task(self._receive_loop())

    async def send_audio(self, b64: str) -> None:
        """发送 base64 编码的 PCM16 16kHz 音频块。"""
        await self._send({
            "type": "input_audio_buffer.append",
            "audio": b64,
        })

    async def cancel_response(self) -> None:
        """打断当前正在生成的响应。"""
        await self._send({"type": "response.cancel"})

    async def close(self) -> None:
        """关闭连接。"""
        if self._recv_task:
            self._recv_task.cancel()
            try:
                await self._recv_task
            except asyncio.CancelledError:
                pass
            self._recv_task = None
        if self._ws:
            await self._ws.close()
            self._ws = None

    # ------------------------------------------------------------------ #
    #  Internal
    # ------------------------------------------------------------------ #

    async def _send(self, msg: dict) -> None:
        if self._ws:
            await self._ws.send(json.dumps(msg, ensure_ascii=False))

    async def _receive_loop(self) -> None:
        try:
            async for raw in self._ws:  # type: ignore[union-attr]
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                await self._handle_event(event)
        except websockets.exceptions.ConnectionClosed:
            logger.info("RealtimeClient: connection closed")
        except Exception:
            logger.exception("RealtimeClient: receive error")

    async def _handle_event(self, event: dict) -> None:
        etype = event.get("type", "")

        match etype:
            case "session.updated":
                logger.info("RealtimeClient: session updated")

            case "input_audio_buffer.speech_started":
                logger.info("RealtimeClient: speech started (VAD)")
                if self.on_speech_started:
                    await self.on_speech_started()

            case "input_audio_buffer.speech_stopped":
                logger.info("RealtimeClient: speech stopped (VAD)")
                if self.on_speech_stopped:
                    await self.on_speech_stopped()

            case "response.audio_transcript.delta":
                delta = event.get("delta", "")
                if delta and self.on_transcript_delta:
                    await self.on_transcript_delta(delta)

            case "response.audio_transcript.done":
                transcript = event.get("transcript", "")
                if self.on_transcript_done:
                    await self.on_transcript_done(transcript)

            case "response.audio.delta":
                delta = event.get("delta", "")
                if delta and self.on_audio_delta:
                    await self.on_audio_delta(delta)

            case "response.done":
                logger.info("RealtimeClient: response done")
                if self.on_response_done:
                    await self.on_response_done()

            case "conversation.item.input_audio_transcription.delta":
                text = event.get("text", "")
                if text and self.on_user_transcript_delta:
                    await self.on_user_transcript_delta(text)

            case "conversation.item.input_audio_transcription.completed":
                transcript = event.get("transcript", "")
                if self.on_user_transcript_done:
                    await self.on_user_transcript_done(transcript)

            case "error":
                msg = event.get("message", "Unknown error")
                logger.error("RealtimeClient: server error %s", msg)
                if self.on_error:
                    await self.on_error(msg)

            case _:
                logger.debug("RealtimeClient: unhandled event type=%s", etype)
