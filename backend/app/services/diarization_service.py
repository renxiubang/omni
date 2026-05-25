"""
Speaker Diarization Service using FunASR.

Segments an audio file into speaker-homogeneous regions,
returning who spoke when (speaker labels with time ranges).
"""

import logging
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# 延迟加载
_diarization_model = None


def _get_model():
    """延迟加载 FunASR 说话人分割模型"""
    global _diarization_model
    if _diarization_model is None:
        logger.info("Loading FunASR speaker diarization model...")
        try:
            from funasr import AutoModel
            _diarization_model = AutoModel(
                model="iic/speech_campplus_speaker-diarization_common"
            )
            logger.info("FunASR diarization model loaded successfully")
        except ImportError:
            logger.error("funasr library not installed")
            raise
        except Exception as e:
            logger.error("Failed to load diarization model: %s", e)
            raise
    return _diarization_model


def _available() -> bool:
    try:
        import funasr  # noqa: F401
        return True
    except ImportError:
        return False


def diarize(audio_path: str) -> List[Dict]:
    """
    对音频文件进行说话人分割。

    Args:
        audio_path: 16kHz WAV 文件路径

    Returns:
        [{"start": 0.0, "end": 2.5, "speaker": "spk0"}, ...]
        失败时返回空列表
    """
    if not _available():
        logger.warning("FunASR not available; cannot diarize")
        return []

    path = Path(audio_path)
    if not path.exists():
        logger.error("Audio file not found: %s", audio_path)
        return []

    try:
        model = _get_model()
        result = model.generate(input=str(path))
        logger.info("Diarization result: %s", result)

        if not result or len(result) == 0:
            logger.warning("No diarization result for %s", audio_path)
            return []

        segments = []
        for item in result:
            if "sentence_info" in item:
                for seg in item["sentence_info"]:
                    segments.append({
                        "start": float(seg.get("start", 0)),
                        "end": float(seg.get("end", 0)),
                        "speaker": str(seg.get("spk", "unknown")),
                    })
            elif "segments" in item:
                for seg in item["segments"]:
                    segments.append({
                        "start": float(seg.get("start", 0)),
                        "end": float(seg.get("end", 0)),
                        "speaker": str(seg.get("speaker", "unknown")),
                    })
        return segments
    except Exception as e:
        logger.error("Error during diarization of %s: %s", audio_path, e)
        return []


def get_speaker_segments(
    audio_path: str,
    target_speaker_label: Optional[str] = None,
) -> List[Dict]:
    """
    获取说话人片段，可按指定标签过滤。

    Args:
        audio_path: WAV 文件路径
        target_speaker_label: 目标说话人标签（如 "spk0"），不指定则返回所有

    Returns:
        说话人片段列表
    """
    segments = diarize(audio_path)
    if target_speaker_label is not None:
        segments = [s for s in segments if s["speaker"] == target_speaker_label]
    return segments
