import asyncio
import base64
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.omni_client import omni_client
from app.services.session_store import session_store

logger = logging.getLogger(__name__)
router = APIRouter()


async def _send(ws: WebSocket, payload: dict) -> None:
    await ws.send_text(json.dumps(payload, ensure_ascii=False))


@router.websocket("/api/call")
async def call_ws(ws: WebSocket, session_id: str) -> None:
    await ws.accept()
    session = session_store.get(session_id)
    if not session:
        await _send(ws, {"type": "error", "message": "Session not found"})
        await ws.close()
        return

    current_task: asyncio.Task | None = None

    async def cancel_current() -> None:
        nonlocal current_task
        if current_task and not current_task.done():
            current_task.cancel()
            try:
                await current_task
            except asyncio.CancelledError:
                pass
        current_task = None

    async def handle_utterance(pcm_bytes: bytes) -> None:
        await cancel_current()

        async def run() -> None:
            # 直接将音频存入 session，不调用 ASR
            # build_messages() 会自动将带 audio_b64 的用户消息编码为 input_audio 格式
            session_store.add_message(
                session_id,
                role="user",
                content="",  # 语音输入无文字，由 Omni 多模态直接理解
                source="call",
                audio_bytes=pcm_bytes,
                audio_format="wav",
            )

            await _send(ws, {"type": "user_final", "text": "[语音]"})

            sess = session_store.get(session_id)
            if not sess:
                return
            messages = omni_client.build_messages(sess.messages)
            full_text: list[str] = []

            try:
                async for text_delta, audio_b64 in omni_client.stream_call(messages):
                    if text_delta:
                        full_text.append(text_delta)
                        await _send(
                            ws, {"type": "assistant_token", "delta": text_delta}
                        )
                    if audio_b64:
                        await _send(
                            ws,
                            {
                                "type": "assistant_audio",
                                "data": audio_b64,
                                "sample_rate": 24000,
                            },
                        )
            except asyncio.CancelledError:
                await _send(ws, {"type": "turn_cancelled"})
                raise

            session_store.add_message(
                session_id,
                role="assistant",
                content="".join(full_text),
                source="call",
            )
            await _send(ws, {"type": "turn_end"})

        nonlocal current_task
        current_task = asyncio.create_task(run())
        try:
            await current_task
        except asyncio.CancelledError:
            pass

    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type")

            if msg_type == "hangup":
                await cancel_current()
                break

            if msg_type == "utterance_end":
                b64 = data.get("data", "")
                if not b64:
                    continue
                pcm = base64.b64decode(b64)
                if current_task and not current_task.done():
                    await _send(ws, {"type": "turn_cancelled"})
                await handle_utterance(pcm)

    except WebSocketDisconnect:
        await cancel_current()
    except Exception as e:
        logger.exception("call ws error")
        await _send(ws, {"type": "error", "message": str(e)})
