import asyncio
import tempfile
from pathlib import Path

import dashscope
from dashscope.audio.asr import Recognition

from app.config import settings


class AsrClient:
    async def transcribe(self, audio_bytes: bytes, format_hint: str = "wav") -> str:
        return await asyncio.to_thread(self._transcribe_sync, audio_bytes, format_hint)

    def _transcribe_sync(self, audio_bytes: bytes, format_hint: str) -> str:
        dashscope.api_key = settings.dashscope_api_key
        suffix = f".{format_hint}" if format_hint else ".wav"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        try:
            recognition = Recognition(
                model=settings.asr_model,
                format=format_hint or "wav",
                sample_rate=16000,
                callback=None,
            )
            result = recognition.call(tmp_path)
            if result.status_code != 200:
                raise RuntimeError(f"ASR failed: {result.message}")
            sentence = result.get_sentence()
            if isinstance(sentence, list):
                parts = []
                for s in sentence:
                    if isinstance(s, dict) and "text" in s:
                        parts.append(s["text"])
                    elif isinstance(s, str):
                        parts.append(s)
                return "".join(parts).strip()
            if isinstance(sentence, dict):
                return str(sentence.get("text", "")).strip()
            return str(sentence or "").strip()
        finally:
            Path(tmp_path).unlink(missing_ok=True)


asr_client = AsrClient()
