"""
Voiceprint (Speaker Verification) Service using FunASR CAM++ model.

Extracts 192-dim speaker embeddings from audio and performs
1:1 verification and 1:N identification via cosine similarity.
"""

import json
import logging
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

# FunASR 延迟加载，避免启动时阻塞
_funasr_model = None


def _get_model():
    """延迟加载 FunASR CAM++ 模型（首次调用时加载，约 5-10 秒）"""
    global _funasr_model
    if _funasr_model is None:
        logger.info("Loading FunASR CAM++ speaker verification model...")
        try:
            from funasr import AutoModel
            _funasr_model = AutoModel(
                model="iic/speech_campplus_sv_zh_en_16k-common_advanced"
            )
            logger.info("FunASR CAM++ model loaded successfully")
        except ImportError:
            logger.error("funasr library not installed; voiceprint features unavailable")
            raise
        except Exception as e:
            logger.error("Failed to load FunASR model: %s", e)
            raise
    return _funasr_model


def _model_available() -> bool:
    """Check if FunASR is importable without loading the model."""
    try:
        import funasr  # noqa: F401
        return True
    except ImportError:
        return False


def extract_embedding(audio_path: str) -> Optional[List[float]]:
    """
    From audio file extract 192-dim speaker embedding vector.

    Args:
        audio_path: 16kHz WAV file path

    Returns:
        192-dim float list, or None on failure
    """
    if not _model_available():
        logger.warning("FunASR not available; cannot extract embedding")
        return None

    path = Path(audio_path)
    if not path.exists():
        logger.error("Audio file not found: %s", audio_path)
        return None

    # Log audio file info for debugging format mismatch issues
    file_size_kb = path.stat().st_size / 1024
    logger.info(
        "Extracting embedding from: %s (format=%s, size=%.1f KB)",
        path.name, path.suffix, file_size_kb,
    )

    try:
        model = _get_model()
        result = model.generate(input=str(path))
        if result and len(result) > 0 and "spk_embedding" in result[0]:
            emb = result[0]["spk_embedding"]
            # Convert to plain Python list regardless of source type
            # (FunASR may return np.ndarray, torch.Tensor, or list)
            if hasattr(emb, "tolist"):
                emb = emb.tolist()
            elif not isinstance(emb, list):
                emb = list(emb)
            # Flatten nested list if the model returns 2D output (e.g. [[0.1, ...]])
            if emb and isinstance(emb[0], (list,)):
                emb = [float(v) for sublist in emb for v in sublist]
            else:
                emb = [float(v) for v in emb]
            logger.info("Embedding extracted: %d dims from %s", len(emb), path.name)
            return emb
        logger.error("No embedding returned from FunASR for %s", audio_path)
        return None
    except Exception as e:
        logger.error("Error extracting embedding from %s: %s", audio_path, e)
        return None


def cosine_similarity(emb1: List[float], emb2: List[float]) -> float:
    """
    计算两个声纹嵌入向量的余弦相似度。

    Args:
        emb1, emb2: 192 维嵌入向量

    Returns:
        余弦相似度 (0.0 ~ 1.0)
    """
    a = np.array(emb1, dtype=np.float64)
    b = np.array(emb2, dtype=np.float64)
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))


def average_embeddings(embeddings: List[List[float]]) -> List[float]:
    """
    对多个嵌入向量求平均（取 L2 归一化后的均值）。

    Args:
        embeddings: 多个 192 维嵌入向量列表

    Returns:
        平均后的 192 维向量
    """
    arr = np.array(embeddings, dtype=np.float64)
    # L2 归一化后求平均，再归一化
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms[norms == 0] = 1.0  # 防止除零
    normalized = arr / norms
    avg = normalized.mean(axis=0)
    avg_norm = np.linalg.norm(avg)
    if avg_norm > 0:
        avg = avg / avg_norm
    return avg.tolist()


def verify_embedding(
    test_embedding: List[float],
    reference_embedding: List[float],
    threshold: float = 0.6,
) -> Tuple[bool, float]:
    """
    1:1 声纹验证：判断测试嵌入是否匹配参考嵌入。

    Args:
        test_embedding: 待验证的声纹嵌入
        reference_embedding: 参考声纹嵌入
        threshold: 余弦相似度阈值（默认 0.6）

    Returns:
        (match: bool, score: float)
    """
    score = cosine_similarity(test_embedding, reference_embedding)
    match = score >= threshold
    logger.info(
        "Voiceprint verify: score=%.4f threshold=%.2f match=%s",
        score, threshold, match,
    )
    return match, score


def identify_embedding(
    test_embedding: List[float],
    candidates: List[Tuple[int, str, List[float]]],
    threshold: float = 0.6,
) -> Optional[Tuple[int, str, float]]:
    """
    1:N 声纹识别：在所有候选中找到最高匹配。

    Args:
        test_embedding: 待识别的声纹嵌入
        candidates: [(profile_id, profile_name, embedding), ...] 列表
        threshold: 余弦相似度阈值

    Returns:
        (profile_id, profile_name, score) 或 None
    """
    best_id = None
    best_name = None
    best_score = 0.0

    for pid, pname, p_emb in candidates:
        score = cosine_similarity(test_embedding, p_emb)
        if score > best_score:
            best_score = score
            best_id = pid
            best_name = pname

    if best_score >= threshold - 1e-9 and best_id is not None:
        logger.info(
            "Voiceprint identify: matched profile=%s (id=%d) score=%.4f",
            best_name, best_id, best_score,
        )
        return best_id, best_name, best_score

    logger.info(
        "Voiceprint identify: no match above threshold (best=%.4f < %.2f)",
        best_score, threshold,
    )
    return None
