import base64
import struct
from collections.abc import AsyncIterator
from typing import Any

from openai import AsyncOpenAI

from app.config import settings
from app.services.session_store import StoredMessage


def _resample_pcm16_base64(audio_b64: str, src_rate: int, dst_rate: int) -> str:
    """将 base64 PCM16 音频从 src_rate 重采样到 dst_rate（线性插值）。"""
    raw = base64.b64decode(audio_b64)
    num_samples = len(raw) // 2
    src = struct.unpack(f"<{num_samples}h", raw)

    ratio = src_rate / dst_rate
    dst_len = int(num_samples / ratio)

    dst = [0] * dst_len
    for i in range(dst_len):
        pos = i * ratio
        idx = int(pos)
        frac = pos - idx
        if idx + 1 < num_samples:
            dst[i] = int(src[idx] + (src[idx + 1] - src[idx]) * frac)
        else:
            dst[i] = src[idx]

    resampled = struct.pack(f"<{dst_len}h", *dst)
    return base64.b64encode(resampled).decode("ascii")


class OmniClient:
    def __init__(self) -> None:
        self._client: AsyncOpenAI | None = None

    def _get_client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client = AsyncOpenAI(
                api_key=settings.dashscope_api_key,
                base_url=settings.dashscope_base_url,
            )
        return self._client

    def build_messages(
        self,
        history: list[StoredMessage],
        *,
        max_audio_turns: int | None = None,
    ) -> list[dict[str, Any]]:
        max_audio = max_audio_turns or settings.max_audio_history_turns
        user_with_audio = [m for m in history if m.role == "user" and m.audio_b64]
        audio_allow_ids = {m.id for m in user_with_audio[-max_audio:]}

        messages: list[dict[str, Any]] = []
        for msg in history:
            if msg.role == "system":
                messages.append({"role": "system", "content": msg.content})
            elif msg.role == "assistant":
                messages.append({"role": "assistant", "content": msg.content})
            elif msg.role == "user":
                if msg.audio_b64 and msg.id in audio_allow_ids:
                    # DashScope 要求 base64 数据加 data:;base64, 前缀
                    data_uri = f"data:;base64,{msg.audio_b64}"
                    # WebM 格式不被支持，统一映射到 wav
                    fmt = msg.audio_format if msg.audio_format != "webm" else "wav"
                    messages.append(
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "input_audio",
                                    "input_audio": {
                                        "data": data_uri,
                                        "format": fmt,
                                    },
                                }
                            ],
                        }
                    )
                else:
                    messages.append(
                        {"role": "user", "content": msg.content or "(语音消息)"}
                    )
        return messages

    async def stream_text(
        self, messages: list[dict[str, Any]]
    ) -> AsyncIterator[str]:
        client = self._get_client()
        stream = await client.chat.completions.create(
            model=settings.omni_model,
            messages=messages,
            modalities=["text"],
            stream=True,
            stream_options={"include_usage": True},
        )
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta.content:
                yield delta.content

    async def stream_call(
        self, messages: list[dict[str, Any]]
    ) -> AsyncIterator[tuple[str | None, str | None]]:
        client = self._get_client()
        stream = await client.chat.completions.create(
            model=settings.omni_model,
            messages=messages,
            modalities=["text", "audio"],
            audio={"voice": settings.omni_voice, "format": settings.omni_audio_format},
            stream=True,
            stream_options={"include_usage": True},
        )
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            text = delta.content if delta.content else None
            audio_b64 = None
            if hasattr(delta, "audio") and delta.audio:
                audio_b64 = (
                    delta.audio.get("data")
                    if isinstance(delta.audio, dict)
                    else None
                )
            if text or audio_b64:
                # 将 DashScope 原始采样率重采样到统一输出采样率
                if audio_b64:
                    audio_b64 = _resample_pcm16_base64(
                        audio_b64,
                        settings.dashscope_audio_sample_rate,
                        settings.output_sample_rate,
                    )
                yield text, audio_b64


omni_client = OmniClient()
