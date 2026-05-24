import asyncio
import base64
import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.services.session_store import session_store
from app.services.voice_service import process_voice_turn

logger = logging.getLogger(__name__)
router = APIRouter()


async def _send(ws: WebSocket, payload: dict) -> None:
    await ws.send_text(json.dumps(payload, ensure_ascii=False))


@router.websocket("/api/call")
async def call_ws(ws: WebSocket, session_id: str = Query(...)) -> None:
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
            async for ev in process_voice_turn(session_id, pcm_bytes, source="call"):
                match ev.kind:
                    case "user_final":
                        await _send(ws, {"type": "user_final", "text": ev.text})
                    case "token":
                        await _send(ws, {"type": "assistant_token", "delta": ev.delta})
                    case "audio":
                        await _send(ws, {
                            "type": "assistant_audio",
                            "data": ev.audio_b64,
                            "sample_rate": ev.sample_rate,
                        })
                    case "turn_end":
                        await _send(ws, {"type": "turn_end"})
                    case "error":
                        await _send(ws, {"type": "error", "message": ev.error})

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
    except Exception:
        logger.exception("call ws error")
        await _send(ws, {"type": "error", "message": "Internal error"})
