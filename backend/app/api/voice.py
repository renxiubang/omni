import base64
import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.services.omni_client import omni_client
from app.services.session_store import session_store

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


@router.post("/voice")
async def chat_voice(
    session_id: str = Form(...),
    audio: UploadFile = File(...),
) -> StreamingResponse:
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio")

    fmt = _guess_format(audio.filename, audio.content_type)

    async def generate():
        # 直接将音频存入 session，不调用 ASR
        user_msg = session_store.add_message(
            session_id,
            role="user",
            content="",  # 语音输入无文字，由 Omni 多模态直接理解
            source="voice",
            audio_bytes=audio_bytes,
            audio_format=fmt if fmt in ("wav", "mp3", "webm") else "wav",
        )
        yield _sse(
            "user_message",
            {
                "id": user_msg.id,
                "content": "[语音]",
                "role": "user",
                "source": "voice",
            },
        )

        session = session_store.get(session_id)
        assert session
        # build_messages 会自动将带 audio_b64 的用户消息编码为 input_audio 格式
        messages = omni_client.build_messages(session.messages)
        full: list[str] = []
        try:
            # 使用 stream_call 同时获取文字和音频输出
            async for text_delta, audio_b64 in omni_client.stream_call(messages):
                if text_delta:
                    full.append(text_delta)
                    yield _sse("token", {"delta": text_delta})
                if audio_b64:
                    yield _sse("assistant_audio", {"data": audio_b64, "sample_rate": 24000})
            assistant = session_store.add_message(
                session_id,
                role="assistant",
                content="".join(full),
                source="voice",
            )
            yield _sse("done", {"message_id": assistant.id})
        except Exception as e:
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
