"""语音对话公共逻辑：call_ws 和 voice.py 的共享服务"""

from collections.abc import AsyncIterator
from dataclasses import dataclass

from app.config import settings
from app.services.omni_client import omni_client
from app.services.session_store import session_store


@dataclass
class VoiceEvent:
    """语音轮次中的事件（调用方按需格式化）"""
    kind: str  # "user_final" | "token" | "audio" | "turn_end" | "error"
    delta: str | None = None
    audio_b64: str | None = None
    sample_rate: int | None = None
    text: str | None = None
    error: str | None = None


async def process_voice_turn(
    session_id: str,
    audio_bytes: bytes,
    audio_format: str = "wav",
    source: str = "call",
) -> AsyncIterator[VoiceEvent]:
    """处理一个语音轮次，流式返回 VoiceEvent。

    自动完成：存储用户消息 → 调用 Omni → 流式返回文本/音频 → 存储助手消息。
    """
    # 1. 存储用户消息（语音输入，无文字，由 Omni 多模态直接理解）
    normalize_fmt = audio_format if audio_format in ("wav", "mp3", "webm") else "wav"
    session_store.add_message(
        session_id,
        role="user",
        content="",
        source=source,
        audio_bytes=audio_bytes,
        audio_format=normalize_fmt,
    )
    yield VoiceEvent(kind="user_final", text="[语音]")

    # 2. 构建消息并流式调用 Omni
    session = session_store.get(session_id)
    if not session:
        yield VoiceEvent(kind="error", error="Session not found")
        return

    messages = omni_client.build_messages(session.messages)
    full_text: list[str] = []

    try:
        async for text_delta, audio_b64 in omni_client.stream_call(messages):
            if text_delta:
                full_text.append(text_delta)
                yield VoiceEvent(kind="token", delta=text_delta)
            if audio_b64:
                yield VoiceEvent(
                    kind="audio",
                    audio_b64=audio_b64,
                    sample_rate=settings.output_sample_rate,
                )
    except Exception as e:
        yield VoiceEvent(kind="error", error=str(e))
        return

    # 3. 存储助手消息
    session_store.add_message(
        session_id,
        role="assistant",
        content="".join(full_text),
        source=source,
    )
    yield VoiceEvent(kind="turn_end")
