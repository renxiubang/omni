import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.asr_client import asr_client

logger = logging.getLogger(__name__)
router = APIRouter()


async def _send_json(ws: WebSocket, payload: dict) -> None:
    await ws.send_text(json.dumps(payload, ensure_ascii=False))


@router.websocket("/api/chat/stt-stream")
async def stt_stream_ws(ws: WebSocket) -> None:
    """流式语音转文字 WebSocket。

    客户端行为：
    - 发送二进制帧 = 音频 chunk（webm）
    - 发送文本帧 {"type": "stop"} = 结束录音

    服务端行为：
    - {"type": "partial", "text": "..."} = 中间识别结果（增量更新）
    - {"type": "final", "text": "..."}   = 最终识别结果
    - {"type": "error", "message": "..."}
    """
    await ws.accept()
    logger.info("[STT-WS] Client connected")

    chunks: list[bytes] = []
    latest_text = ""
    task: asyncio.Task | None = None
    running = True

    async def periodic_asr() -> None:
        """每 600ms 运行一次 ASR，发送增量结果。"""
        nonlocal latest_text
        while running:
            await asyncio.sleep(0.6)
            if not running:
                break
            if not chunks:
                continue
            try:
                all_audio = b"".join(chunks)
                if len(all_audio) < 2000:  # 音频太短，跳过
                    continue
                text = await asr_client.transcribe(all_audio, format_hint="webm")
                if text and text != latest_text:
                    latest_text = text
                    await _send_json(ws, {"type": "partial", "text": text})
                    logger.info(f"[STT-WS] Partial: {repr(text)}")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"[STT-WS] Periodic ASR error: {e}")

    task = asyncio.create_task(periodic_asr())

    try:
        while True:
            data = await ws.receive()

            if "text" in data:
                msg = json.loads(data["text"])
                if msg.get("type") == "stop":
                    logger.info("[STT-WS] Received stop")
                    break

            elif "bytes" in data:
                chunks.append(data["bytes"])

    except WebSocketDisconnect:
        logger.info("[STT-WS] Client disconnected")
    except Exception as e:
        logger.exception("[STT-WS] Unexpected error")
        await _send_json(ws, {"type": "error", "message": str(e)})
    finally:
        running = False
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        # 最终 ASR
        if chunks:
            try:
                all_audio = b"".join(chunks)
                final_text = await asr_client.transcribe(all_audio, format_hint="webm")
                logger.info(f"[STT-WS] Final: {repr(final_text)}")
                await _send_json(ws, {"type": "final", "text": final_text or ""})
            except Exception as e:
                logger.error(f"[STT-WS] Final ASR error: {e}")
                await _send_json(ws, {"type": "error", "message": str(e)})

        try:
            await ws.close()
        except Exception:
            pass
        logger.info("[STT-WS] Connection closed")
