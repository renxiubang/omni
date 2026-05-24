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
        self.audio_queue = asyncio.Queue()
        self.text_delta_queue = asyncio.Queue()
        self._listen_task = None

    async def connect(self, system_prompt: str = "", voice: str = "Ethan"):
        """连接百炼 Realtime API 并发送会话配置"""
        # websockets 16.0 使用 additional_headers，格式为列表 of tuples
        headers = [("Authorization", f"Bearer {self.api_key}")]
        
        self.ws = await websockets.connect(
            self.url,
            additional_headers=headers
        )

        # 发送会话配置
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

        # 启动监听任务
        self._listen_task = asyncio.create_task(self._listen())

    async def _listen(self):
        """监听百炼返回的事件"""
        try:
            async for message in self.ws:
                data = json.loads(message)
                msg_type = data.get("type", "")

                if msg_type == "response.audio.delta":
                    # 解析 Base64 PCM 音频并推送到队列
                    pcm_bytes = base64.b64decode(data["delta"])
                    await self.audio_queue.put(pcm_bytes)
                elif msg_type == "response.text.delta":
                    # 文本增量
                    delta = data.get("delta", "")
                    await self.text_delta_queue.put(delta)
                elif msg_type == "response.done":
                    # 响应完成，发送结束标记
                    await self.audio_queue.put(None)
                    await self.text_delta_queue.put(None)
                elif msg_type == "error":
                    logger.error(f"Realtime API error: {data}")
        except Exception as e:
            logger.exception(f"Listen error: {e}")
        finally:
            # 确保队列收到结束标记
            await self.audio_queue.put(None)
            await self.text_delta_queue.put(None)

    async def send_audio(self, pcm_16k_bytes: bytes):
        """发送音频给百炼"""
        if self.ws and not self.ws.closed:
            event = {
                "event_id": "event_audio_" + base64.b64encode(pcm_16k_bytes[:16]).hex(),
                "type": "input_audio_buffer.append",
                "audio": base64.b64encode(pcm_16k_bytes).decode("utf-8")
            }
            await self.ws.send(json.dumps(event))

    async def receive_audio(self) -> bytes | None:
        """接收百炼返回的音频（16kHz PCM）"""
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
        if self.ws and not self.ws.closed:
            await self.ws.close()
            logger.info("Realtime API connection closed")
