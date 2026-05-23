import asyncio
import logging
import subprocess
import tempfile
from pathlib import Path

import dashscope
from dashscope.audio.asr import Recognition

from app.config import settings

logger = logging.getLogger(__name__)


class AsrClient:
    async def transcribe(self, audio_bytes: bytes, format_hint: str = "wav") -> str:
        return await asyncio.to_thread(self._transcribe_sync, audio_bytes, format_hint)

    def _convert_for_asr(self, input_path: str, input_format: str) -> tuple[str, str]:
        """将浏览器录音转换为阿里云 ASR 支持的格式（16kHz mono WAV）。
        浏览器 MediaRecorder 默认录制 webm/opus，采样率 ~48kHz，
        与 paraformer-v2 要求的 16kHz WAV/PCM 不兼容，需用 ffmpeg 转换。
        """
        if input_format in ("wav", "pcm"):
            return input_path, input_format

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            output_path = tmp.name

        cmd = [
            "ffmpeg", "-y",
            "-i", input_path,
            "-ar", str(settings.asr_sample_rate),
            "-ac", "1",
            "-sample_fmt", "s16",
            output_path,
        ]
        try:
            subprocess.run(cmd, capture_output=True, check=True, timeout=30)
            return output_path, "wav"
        except FileNotFoundError:
            Path(output_path).unlink(missing_ok=True)
            raise RuntimeError(
                "语音转文字需要安装 ffmpeg：brew install ffmpeg (macOS) "
                "或 apt install ffmpeg (Linux)"
            )
        except subprocess.CalledProcessError as e:
            Path(output_path).unlink(missing_ok=True)
            err = e.stderr.decode(errors="replace")[:200] if e.stderr else "unknown error"
            raise RuntimeError(f"音频转换失败: {err}")

    def _transcribe_sync(self, audio_bytes: bytes, format_hint: str) -> str:
        dashscope.api_key = settings.dashscope_api_key
        suffix = f".{format_hint}" if format_hint else ".wav"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        # 将浏览器录音转换为 16kHz mono WAV
        asr_path = tmp_path
        try:
            asr_path, asr_format = self._convert_for_asr(tmp_path, format_hint)
        except RuntimeError as e:
            Path(tmp_path).unlink(missing_ok=True)
            raise e

        try:
            recognition = Recognition(
                model=settings.asr_model,
                format=asr_format,
                sample_rate=settings.asr_sample_rate,
                callback=None,
            )
            result = recognition.call(asr_path)
            logger.info(f"ASR raw response: status_code={result.status_code}, "
                        f"output={result.output}")
            if result.status_code != 200:
                raise RuntimeError(f"语音识别失败: {result.message}")
            sentence = result.get_sentence()
            logger.info(f"ASR get_sentence() raw: {repr(sentence)}")
            if isinstance(sentence, list):
                parts = []
                for s in sentence:
                    if isinstance(s, dict) and "text" in s:
                        parts.append(s["text"])
                    elif isinstance(s, str):
                        parts.append(s)
                text = "".join(parts).strip()
                logger.info(f"ASR final text (list): {repr(text)}")
                return text
            if isinstance(sentence, dict):
                text = str(sentence.get("text", "")).strip()
                logger.info(f"ASR final text (dict): {repr(text)}")
                return text
            text = str(sentence or "").strip()
            logger.info(f"ASR final text (str): {repr(text)}")
            return text
        finally:
            Path(tmp_path).unlink(missing_ok=True)
            if asr_path != tmp_path:
                Path(asr_path).unlink(missing_ok=True)


asr_client = AsrClient()
