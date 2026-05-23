import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.schemas.chat import ChatStreamRequest
from app.services.omni_client import omni_client
from app.services.session_store import session_store

router = APIRouter(prefix="/api/chat", tags=["chat"])


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    voice: str = "cherry"  # DashScope 音色名称，默认 cherry


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/stream")
async def chat_stream(body: ChatStreamRequest) -> StreamingResponse:
    session = session_store.get(body.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    user_msg = session_store.add_message(
        body.session_id,
        role="user",
        content=body.message,
        source="text",
    )

    async def generate():
        yield _sse(
            "user_message",
            {
                "id": user_msg.id,
                "content": user_msg.content,
                "role": "user",
                "source": "text",
            },
        )
        messages = omni_client.build_messages(session.messages)
        full: list[str] = []
        try:
            async for token in omni_client.stream_text(messages):
                full.append(token)
                yield _sse("token", {"delta": token})
            assistant = session_store.add_message(
                body.session_id,
                role="assistant",
                content="".join(full),
                source="text",
            )
            yield _sse("done", {"message_id": assistant.id})
        except Exception as e:
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/tts")
async def chat_tts(body: TtsRequest) -> StreamingResponse:
    """将文本合成为语音并流式返回 PCM16 base64 音频块（SSE）。

    与 /api/chat/voice 使用相同的 DashScope omni 模型，
    但只取音频部分，不依赖 session 上下文，可直接对任意文本合成。
    """

    async def generate():
        try:
            from openai import AsyncOpenAI
            from app.config import settings

            client = AsyncOpenAI(
                api_key=settings.dashscope_api_key,
                base_url=settings.dashscope_base_url,
            )
            # 构造单轮消息，让模型"朗读"这段文本
            messages = [
                {
                    "role": "system",
                    "content": "请用自然的口语朗读以下内容，不要添加额外解释。",
                },
                {"role": "user", "content": body.text},
            ]
            # DashScope 音频参数
            voice_name = body.voice or settings.omni_voice
            audio_param = {"voice": voice_name, "format": settings.omni_audio_format}
            stream = await client.chat.completions.create(
                model=settings.omni_model,
                messages=messages,
                modalities=["text", "audio"],
                audio=audio_param,
                stream=True,
            )
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                audio_b64 = None
                if hasattr(delta, "audio") and delta.audio:
                    audio_b64 = (
                        delta.audio.get("data")
                        if isinstance(delta.audio, dict)
                        else None
                    )
                if audio_b64:
                    from app.services.omni_client import _resample_pcm16_base64
                    audio_b64 = _resample_pcm16_base64(
                        audio_b64,
                        settings.dashscope_audio_sample_rate,
                        settings.output_sample_rate,
                    )
                    yield _sse("assistant_audio", {"data": audio_b64})
            yield _sse("done", {})
        except Exception as e:
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
