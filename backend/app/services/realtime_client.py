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
                
                # 打印所有事件类型（用于调试）
                # 特别处理 audio.delta，打印数据大小
                if msg_type == "response.audio.delta":
                    pcm_bytes = base64.b64decode(data["delta"])
                    # 打印音频数据统计信息（判断是否为静音）
                    import numpy as np
                    pcm_int16 = np.frombuffer(pcm_bytes, dtype=np.int16)
                    logger.info(f"🔊 Received audio delta: {len(pcm_bytes)} bytes, "
                               f"mean={pcm_int16.mean():.2f}, std={pcm_int16.std():.2f}, "
                               f"max={pcm_int16.max()}, min={pcm_int16.min()}, "
                               f"zeros={np.sum(pcm_int16 == 0)}/{len(pcm_int16)}")
                    # 检查是否为静音（标准差很小）
                    if pcm_int16.std() < 10:
                        logger.warning("⚠️ Audio data may be SILENCE (std < 10)")
                elif msg_type == "response.text.delta":
                    delta = data.get("delta", "")
                    logger.debug(f"Received text delta: '{delta}'")
                else:
                    # 其他事件打印完整信息（截断到 300 字符）
                    logger.info(f"Realtime API event: type={msg_type}, data={json.dumps(data)[:300]}")

                if msg_type == "response.audio.delta":
                    # 解析 Base64 PCM 音频并推送到队列
                    pcm_bytes = base64.b64decode(data["delta"])
                    await self.audio_queue.put(pcm_bytes)
                elif msg_type == "response.text.delta":
                    # 文本增量
                    delta = data.get("delta", "")
                    await self.text_delta_queue.put(delta)
                elif msg_type == "response.done":
                    # 响应完成（单次回复结束，但会话继续）
                    # ⚠️ 不要发送 None！否则 QwenAudioTrack 会认为音频流已结束
                    # None 仅在 WebSocket 连接关闭时（finally 块）才发送
                    logger.info("Response done, continuing to listen (session still alive)")
                elif msg_type == "error":
                    logger.error(f"Realtime API error: {data}")
                elif msg_type == "input_audio_buffer.speech_started":
                    logger.info("🎤 VAD detected: user started speaking")
                elif msg_type == "input_audio_buffer.speech_stopped":
                    logger.info("🎤 VAD detected: user stopped speaking")
        except Exception as e:
            logger.exception(f"Listen error: {e}")
        finally:
            # 确保队列收到结束标记
            logger.warning("Listen loop ended, sending None to queues")
            await self.audio_queue.put(None)
            await self.text_delta_queue.put(None)

    async def send_audio(self, pcm_16k_bytes: bytes):
        """发送音频给百炼"""
        # websockets 16.0: 使用 close_code 检查连接状态（None 表示未关闭）
        if self.ws and self.ws.close_code is None:
            event = {
                "event_id": "event_audio_" + base64.b64encode(pcm_16k_bytes[:16]).hex(),
                "type": "input_audio_buffer.append",
                "audio": base64.b64encode(pcm_16k_bytes).decode("utf-8")
            }
            await self.ws.send(json.dumps(event))
            # 每发送 10 次打印一次日志（避免日志过多）
            if not hasattr(self, '_send_count'):
                self._send_count = 0
            self._send_count += 1
            if self._send_count % 10 == 0:
                logger.debug(f"Sent {self._send_count} audio frames to 百炼, last size={len(pcm_16k_bytes)} bytes")
        else:
            logger.warning("Cannot send audio: WebSocket not connected")

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
        # websockets 16.0: 使用 close_code 检查连接状态
        if self.ws and self.ws.close_code is None:
            await self.ws.close()
            logger.info("Realtime API connection closed")
