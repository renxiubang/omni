import base64
import json
import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.services.asr_client import asr_client
from app.services.omni_client import omni_client
from app.services.session_store import session_store
from app.services.voice_service import process_voice_turn
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["voice"])


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _guess_format(filename: str | None, content_type: str | None) -> str:
    if filename and "." in filename:
        return filename.rsplit(".", 1)[-1].lower()
    if content_type and "webm" in content_type:
        return "webm"
    if content_type and "wav" in content_type:
        return "wav"
    return "wav"


@router.post("/stt")
async def speech_to_text(
    audio: UploadFile = File(...),
) -> dict:
    """语音转文字：上传音频，返回识别文本"""
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio")

    fmt = _guess_format(audio.filename, audio.content_type)
    logger.info(f"STT request: filename={audio.filename}, format={fmt}, size={len(audio_bytes)} bytes")
    try:
        text = await asr_client.transcribe(audio_bytes, format_hint=fmt)
        logger.info(f"STT result: {repr(text)}")
        return {"text": text}
    except Exception as e:
        logger.error(f"STT failed: {e}")
        raise HTTPException(status_code=500, detail=f"STT failed: {str(e)}")


@router.post("/voice")
async def chat_voice(
    session_id: str = Form(...),
    audio: UploadFile = File(...),
    voice_enabled: bool = Form(default=True),
) -> StreamingResponse:
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio")

    fmt = _guess_format(audio.filename, audio.content_type)
    normalize_fmt = fmt if fmt in ("wav", "mp3", "webm") else "wav"

    async def generate():
        async for ev in process_voice_turn(
            session_id, audio_bytes, audio_format=normalize_fmt, source="voice",
            voice_enabled=voice_enabled,
        ):
            match ev.kind:
                case "user_final":
                    yield _sse("user_message", {
                        "content": ev.text, "role": "user", "source": "voice"
                    })
                case "token":
                    yield _sse("token", {"delta": ev.delta})
                case "audio":
                    yield _sse("assistant_audio", {
                        "data": ev.audio_b64, "sample_rate": ev.sample_rate
                    })
                case "turn_end":
                    yield _sse("done", {"message_id": ""})
                case "error":
                    yield _sse("error", {"message": ev.error})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
