import asyncio
import base64
import json
import logging

import websockets

logger = logging.getLogger(__name__)


class RealtimeAPIClient:
    """百炼 Realtime API WebSocket 客户端"""

    def __init__(self, api_key: str, url: str):
        self.api_key = api_key
        self.url = url
        self.ws = None
        self.audio_queue: asyncio.Queue = asyncio.Queue()
        self.text_delta_queue: asyncio.Queue = asyncio.Queue()
        self._listen_task = None
        self._audio_seq = 0  # 递增计数器代替 base64(event_id)

    async def connect(self, system_prompt: str = "", voice: str = "Ethan"):
        """连接百炼 Realtime API 并发送会话配置"""
        headers = [("Authorization", f"Bearer {self.api_key}")]

        self.ws = await websockets.connect(
            self.url,
            additional_headers=headers
        )

        session_update = {
            "event_id": "event_init_001",
            "type": "session.update",
            "session": {
                "modalities": ["text", "audio"],
                "voice": voice,
                "input_audio_format": "pcm",
                "output_audio_format": "pcm",
                "turn_detection": {"type": "server_vad", "threshold": 0.5},
                "instructions": system_prompt,
            }
        }
        await self.ws.send(json.dumps(session_update))
        logger.info("Realtime API session updated")

        self._listen_task = asyncio.create_task(self._listen())

    async def _listen(self):
        """监听百炼返回的事件"""
        try:
            async for message in self.ws:
                data = json.loads(message)
                msg_type = data.get("type", "")

                if msg_type == "response.audio.delta":
                    pcm_bytes = base64.b64decode(data["delta"])
                    await self.audio_queue.put(pcm_bytes)
                elif msg_type == "response.text.delta":
                    delta = data.get("delta", "")
                    await self.text_delta_queue.put(delta)
                elif msg_type == "response.done":
                    # 单次回复结束，会话继续（不发送 None，保持轨道活跃）
                    logger.debug("Response done")
                elif msg_type == "error":
                    logger.error("Realtime API error: %s", data)
                elif msg_type == "input_audio_buffer.speech_started":
                    logger.info("VAD: user started speaking")
                elif msg_type == "input_audio_buffer.speech_stopped":
                    logger.info("VAD: user stopped speaking")
                else:
                    logger.debug("Realtime API event: type=%s", msg_type)
        except Exception:
            logger.exception("Listen error")
        finally:
            logger.info("Listen loop ended, sending None to queues")
            await self.audio_queue.put(None)
            await self.text_delta_queue.put(None)

    async def send_audio(self, pcm_16k_bytes: bytes):
        """发送音频给百炼"""
        if self.ws and self.ws.close_code is None:
            self._audio_seq += 1
            event = {
                "event_id": f"audio_{self._audio_seq:06d}",
                "type": "input_audio_buffer.append",
                "audio": base64.b64encode(pcm_16k_bytes).decode("utf-8")
            }
            await self.ws.send(json.dumps(event))
        else:
            logger.warning("Cannot send audio: WebSocket not connected")

    async def receive_audio(self) -> bytes | None:
        """接收百炼返回的音频（24kHz PCM）"""
        return await self.audio_queue.get()

    async def receive_text_delta(self) -> str | None:
        """接收百炼返回的文本增量"""
        return await self.text_delta_queue.get()

    async def close(self):
        """关闭连接"""
        if self._listen_task:
            self._listen_task.cancel()
            try:
                await self._listen_task
            except asyncio.CancelledError:
                pass
        if self.ws and self.ws.close_code is None:
            await self.ws.close()
            logger.info("Realtime API connection closed")
