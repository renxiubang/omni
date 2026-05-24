"""语音通话 WebSocket 网关（DashScope Realtime VAD 模式）。

前端持续发送音频块 → 后端转发给 DashScope Realtime API → DashScope VAD
检测语音起止 → 实时返回文本/音频 → 后端转发给前端。
"""

import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.persona_loader import persona_store
from app.services.realtime_client import RealtimeClient
from app.services.session_store import session_store

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

    # 获取人格 system prompt
    persona = persona_store.get(session.persona or None)
    instructions = persona.system_prompt

    # 如果开启了单词本训练模式，追加约束指令（放在人格 prompt 前面，优先级更高）
    from app.services.wordbook_trainer import wordbook_trainer as wt
    training_msgs = [
        m for m in session.messages
        if m.role == "system" and "VOCABULARY TRAINING MODE" in m.content
    ]
    if training_msgs:
        instructions = training_msgs[-1].content + "\n\n" + instructions

    # 创建 RealtimeClient
    client = RealtimeClient(instructions=instructions)

    # ---- 设置 DashScope 事件回调 ----
    async def on_speech_started() -> None:
        await _send(ws, {"type": "speech_started"})

    async def on_speech_stopped() -> None:
        await _send(ws, {"type": "speech_stopped"})

    # 用户语音 ASR 转写
    async def on_user_transcript_delta(delta: str) -> None:
        await _send(ws, {"type": "user_transcript", "delta": delta})

    async def on_user_transcript_done(transcript: str) -> None:
        await _send(ws, {
            "type": "user_transcript_done",
            "transcript": transcript,
        })

    # AI 回复的文字转录
    async def on_transcript_delta(delta: str) -> None:
        await _send(ws, {"type": "assistant_transcript", "delta": delta})

    async def on_transcript_done(transcript: str) -> None:
        await _send(ws, {
            "type": "assistant_transcript_done",
            "transcript": transcript,
        })

    async def on_audio_delta(b64: str) -> None:
        await _send(ws, {
            "type": "assistant_audio",
            "data": b64,
            "sample_rate": 24000,
        })

    async def on_response_done() -> None:
        await _send(ws, {"type": "turn_end"})

    async def on_error(msg: str) -> None:
        await _send(ws, {"type": "error", "message": msg})

    client.on_speech_started = on_speech_started
    client.on_speech_stopped = on_speech_stopped
    client.on_user_transcript_delta = on_user_transcript_delta
    client.on_user_transcript_done = on_user_transcript_done
    client.on_transcript_delta = on_transcript_delta
    client.on_transcript_done = on_transcript_done
    client.on_audio_delta = on_audio_delta
    client.on_response_done = on_response_done
    client.on_error = on_error

    try:
        await client.connect()
    except Exception as e:
        logger.exception("RealtimeClient connect failed")
        await _send(ws, {"type": "error", "message": str(e)})
        await ws.close()
        return

    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type")

            if msg_type == "audio_chunk":
                b64 = data.get("data", "")
                if b64:
                    await client.send_audio(b64)

            elif msg_type == "hangup":
                break

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("call ws error")
    finally:
        await client.close()
