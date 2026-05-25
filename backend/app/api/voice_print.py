"""
Voice Print API module.

This module provides API endpoints for voice print enrollment, verification,
identification, diarization and management.
"""
import json
import os
import subprocess
import logging
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.db import database
from app.config import settings

logger = logging.getLogger(__name__)


def _convert_to_wav(input_path: str) -> str:
    """将任意音频文件转为 16kHz mono 16-bit WAV，返回 WAV 路径。
    
    浏览器 MediaRecorder 在 Safari 产生 audio/mp4，在 Chrome 产生 audio/webm。
    FunASR CAM++ 模型需要 16kHz WAV 输入才有一致的 embedding 质量。
    这里统一转为 WAV，与通话音频（PCM16→WAV）保持一致。
    """
    wav_path = Path(input_path).with_suffix(".wav")
    if wav_path.exists():
        return str(wav_path)
    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-ar", "16000",
        "-ac", "1",
        "-sample_fmt", "s16",
        str(wav_path),
    ]
    try:
        subprocess.run(cmd, capture_output=True, check=True, timeout=30)
        return str(wav_path)
    except subprocess.CalledProcessError as e:
        logger.error("ffmpeg convert failed: %s", e.stderr.decode(errors="replace")[:500])
        return input_path  # fallback to original
    except FileNotFoundError:
        logger.warning("ffmpeg not found; falling back to original format")
        return input_path

router = APIRouter(prefix="/api/voice-print", tags=["voice-print"])

# Create upload directory for voice prints
VOICE_PRINT_DIR = Path(__file__).parent.parent / "uploads" / "voice_prints"
VOICE_PRINT_DIR.mkdir(parents=True, exist_ok=True)


class VoiceProfileResponse(BaseModel):
    id: int
    user_id: int
    name: str
    audio_samples: List[str]
    enrollment_text: str
    has_embedding: bool = False
    embedding: Optional[List[float]] = None
    created_at: str
    updated_at: str


class VoiceProfileListResponse(BaseModel):
    profiles: List[VoiceProfileResponse]


@router.post("/enroll", response_model=VoiceProfileResponse)
async def enroll_voice_print(
    user_id: int = Form(...),
    name: str = Form(...),
    enrollment_text: str = Form(...),
    audio_samples: List[UploadFile] = File(...),
):
    """
    Enroll a new voice print profile.

    Args:
        user_id: User ID
        name: Voice profile name
        enrollment_text: Text read during enrollment
        audio_samples: Audio sample files (3-5 samples recommended)

    Returns:
        Voice profile information
    """
    # Validate audio samples
    if len(audio_samples) < 3:
        raise HTTPException(
            status_code=400,
            detail="At least 3 audio samples are required for enrollment"
        )

    if len(audio_samples) > 5:
        raise HTTPException(
            status_code=400,
            detail="Maximum 5 audio samples allowed"
        )

    # Save audio files (convert to 16kHz WAV for consistent embedding quality)
    saved_paths = []
    for i, audio_file in enumerate(audio_samples):
        # Generate unique filename
        original_name = audio_file.filename or f"sample_{i}.webm"
        filename = f"user_{user_id}_{name}_{i}_{original_name}"
        file_path = VOICE_PRINT_DIR / filename

        # Save file
        try:
            with open(file_path, "wb") as f:
                content = await audio_file.read()
                f.write(content)
            # Convert to 16kHz mono WAV for consistent embedding quality
            wav_path = _convert_to_wav(str(file_path))
            if wav_path != str(file_path):
                # Remove original compressed file, keep only WAV
                try:
                    os.remove(str(file_path))
                except OSError:
                    pass
                saved_paths.append(wav_path)
                logger.info("Converted audio to WAV: %s -> %s", filename, Path(wav_path).name)
            else:
                saved_paths.append(str(file_path))
        except Exception as e:
            # Clean up already saved files
            for path in saved_paths:
                try:
                    os.remove(path)
                except:
                    pass
            raise HTTPException(
                status_code=500,
                detail=f"Failed to save audio file: {str(e)}"
            )

    # 使用 FunASR 提取声纹嵌入
    embedding_json = None
    has_embedding = False
    try:
        from app.services.voiceprint_service import extract_embedding, average_embeddings
        embeddings = []
        for path in saved_paths:
            emb = extract_embedding(path)
            if emb is not None:
                embeddings.append(emb)
        if len(embeddings) >= 2:
            avg_emb = average_embeddings(embeddings)
            embedding_json = json.dumps(avg_emb)
            has_embedding = True
            logger.info("Voiceprint embedding extracted for user %d profile '%s'", user_id, name)
        else:
            logger.warning(
                "Only %d/%d embeddings extracted for user %d profile '%s'",
                len(embeddings), len(saved_paths), user_id, name,
            )
    except ImportError:
        logger.warning("FunASR not available; voiceprint embedding skipped")
    except Exception as e:
        logger.error("Failed to extract voiceprint embedding: %s", e)

    # Create voice profile in database
    try:
        profile = database.create_voice_profile(
            user_id=user_id,
            name=name,
            audio_samples=saved_paths,
            enrollment_text=enrollment_text,
            embedding=embedding_json,
        )
        profile["has_embedding"] = has_embedding
        if has_embedding and embedding_json:
            profile["embedding"] = [float(v) for v in json.loads(embedding_json)]
        return profile
    except ValueError as e:
        # Clean up saved files if database operation fails
        for path in saved_paths:
            try:
                os.remove(path)
            except:
                pass
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # Clean up saved files if database operation fails
        for path in saved_paths:
            try:
                os.remove(path)
            except:
                pass
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create voice profile: {str(e)}"
        )


@router.get("/list", response_model=VoiceProfileListResponse)
async def list_voice_profiles(
    user_id: int = Query(...),
):
    """
    Get all voice profiles for a user.

    Args:
        user_id: User ID

    Returns:
        List of voice profiles
    """
    try:
        profiles = database.get_user_voice_profiles(user_id)
        return {"profiles": profiles}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get voice profiles: {str(e)}"
        )


@router.get("/{profile_id}", response_model=VoiceProfileResponse)
async def get_voice_profile(
    profile_id: int,
    user_id: int = Query(...),
):
    """
    Get a specific voice profile by ID.

    Args:
        profile_id: Voice profile ID
        user_id: User ID (for authorization)

    Returns:
        Voice profile information
    """
    try:
        profile = database.get_voice_profile_by_id(profile_id, user_id)
        if not profile:
            raise HTTPException(
                status_code=404,
                detail="Voice profile not found"
            )
        return profile
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get voice profile: {str(e)}"
        )


@router.delete("/{profile_id}")
async def delete_voice_profile(
    profile_id: int,
    user_id: int = Query(...),
):
    """
    Delete a voice profile.

    Args:
        profile_id: Voice profile ID
        user_id: User ID (for authorization)

    Returns:
        Success message
    """
    try:
        # Get profile first to get audio file paths
        profile = database.get_voice_profile_by_id(profile_id, user_id)
        if not profile:
            raise HTTPException(
                status_code=404,
                detail="Voice profile not found"
            )

        # Delete audio files
        for audio_path in profile["audio_samples"]:
            try:
                if os.path.exists(audio_path):
                    os.remove(audio_path)
            except Exception as e:
                print(f"Warning: Failed to delete audio file {audio_path}: {e}")

        # Delete from database
        success = database.delete_voice_profile(profile_id, user_id)
        if not success:
            raise HTTPException(
                status_code=500,
                detail="Failed to delete voice profile"
            )

        return {"message": "Voice profile deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete voice profile: {str(e)}"
        )


@router.get("/audio/{profile_id}/{sample_index}")
async def get_audio_sample(
    profile_id: int,
    sample_index: int,
    user_id: int = Query(...),
):
    """
    Get a specific audio sample from a voice profile.

    Args:
        profile_id: Voice profile ID
        sample_index: Audio sample index (0-based)
        user_id: User ID (for authorization)

    Returns:
        Audio file
    """
    try:
        profile = database.get_voice_profile_by_id(profile_id, user_id)
        if not profile:
            raise HTTPException(
                status_code=404,
                detail="Voice profile not found"
            )

        if sample_index < 0 or sample_index >= len(profile["audio_samples"]):
            raise HTTPException(
                status_code=400,
                detail="Invalid sample index"
            )

        audio_path = profile["audio_samples"][sample_index]
        if not os.path.exists(audio_path):
            raise HTTPException(
                status_code=404,
                detail="Audio file not found"
            )

        return FileResponse(
            audio_path,
            media_type="audio/wav",
            filename=os.path.basename(audio_path)
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get audio sample: {str(e)}"
        )


# --- Voiceprint Verification / Identification / Diarization ---

class VerifyRequest(BaseModel):
    user_id: int
    profile_id: int


class VerifyResponse(BaseModel):
    match: bool
    score: float
    profile_name: str


@router.post("/verify", response_model=VerifyResponse)
async def verify_voice_print(
    user_id: int = Form(...),
    profile_id: int = Form(...),
    audio: UploadFile = File(...),
):
    """
    1:1 声纹验证：判断上传语音是否匹配指定声纹档案。

    Args:
        user_id: 用户 ID
        profile_id: 目标声纹档案 ID
        audio: 待验证的音频文件 (WAV, 16kHz)
    """
    try:
        from app.services.voiceprint_service import extract_embedding, verify_embedding
    except ImportError:
        raise HTTPException(status_code=501, detail="Voiceprint service not available")

    # 获取目标声纹档案
    profile = database.get_voice_profile_by_id(profile_id, user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Voice profile not found")
    if not profile.get("embedding"):
        raise HTTPException(
            status_code=400,
            detail="Voice profile has no embedding; re-enroll required",
        )

    # 保存临时音频文件
    tmp_path = VOICE_PRINT_DIR / f"verify_{user_id}_{profile_id}.wav"
    try:
        content = await audio.read()
        with open(tmp_path, "wb") as f:
            f.write(content)

        # 提取验证音频的嵌入
        test_emb = extract_embedding(str(tmp_path))
        if test_emb is None:
            raise HTTPException(status_code=422, detail="Failed to extract embedding from audio")

        # 比对
        match, score = verify_embedding(
            test_emb,
            profile["embedding"],
            threshold=settings.voiceprint_threshold,
        )
        return VerifyResponse(
            match=match,
            score=round(score, 4),
            profile_name=profile["name"],
        )
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


class IdentifyResponse(BaseModel):
    matched_profile_id: Optional[int] = None
    matched_profile_name: Optional[str] = None
    score: float = 0.0
    candidates: List[dict] = []


@router.post("/identify", response_model=IdentifyResponse)
async def identify_voice_print(
    user_id: int = Form(...),
    audio: UploadFile = File(...),
):
    """
    1:N 声纹识别：在用户所有已录入声纹中查找最匹配的。

    Args:
        user_id: 用户 ID
        audio: 待识别的音频文件 (WAV, 16kHz)
    """
    try:
        from app.services.voiceprint_service import (
            extract_embedding,
            identify_embedding,
            cosine_similarity,
        )
    except ImportError:
        raise HTTPException(status_code=501, detail="Voiceprint service not available")

    # 获取用户所有有声纹嵌入的档案
    candidates = database.get_all_embeddings_for_user(user_id)
    if not candidates:
        raise HTTPException(status_code=404, detail="No voice profiles with embeddings found")

    # 保存临时音频文件
    tmp_path = VOICE_PRINT_DIR / f"identify_{user_id}.wav"
    try:
        content = await audio.read()
        with open(tmp_path, "wb") as f:
            f.write(content)

        # 提取嵌入
        test_emb = extract_embedding(str(tmp_path))
        if test_emb is None:
            raise HTTPException(status_code=422, detail="Failed to extract embedding from audio")

        # 识别
        cand_list = [(c["id"], c["name"], c["embedding"]) for c in candidates]
        result = identify_embedding(
            test_emb, cand_list,
            threshold=settings.voiceprint_threshold,
        )

        # 计算所有候选的分数（用于调试）
        all_candidates = []
        for pid, pname, p_emb in cand_list:
            s = cosine_similarity(test_emb, p_emb)
            all_candidates.append({
                "profile_id": pid,
                "profile_name": pname,
                "score": round(s, 4),
            })
        all_candidates.sort(key=lambda x: x["score"], reverse=True)

        if result:
            return IdentifyResponse(
                matched_profile_id=result[0],
                matched_profile_name=result[1],
                score=round(result[2], 4),
                candidates=all_candidates,
            )
        return IdentifyResponse(candidates=all_candidates)
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


class DiarizeSegment(BaseModel):
    start: float
    end: float
    speaker: str


class DiarizeResponse(BaseModel):
    segments: List[DiarizeSegment]


@router.post("/diarize", response_model=DiarizeResponse)
async def diarize_audio(
    user_id: int = Form(...),
    audio: UploadFile = File(...),
):
    """
    说话人分割：标注音频中"谁在什么时候说话"。

    Args:
        user_id: 用户 ID
        audio: 待分割的音频文件 (WAV, 16kHz)
    """
    try:
        from app.services.diarization_service import diarize as do_diarize
    except ImportError:
        raise HTTPException(status_code=501, detail="Diarization service not available")

    tmp_path = VOICE_PRINT_DIR / f"diarize_{user_id}.wav"
    try:
        content = await audio.read()
        with open(tmp_path, "wb") as f:
            f.write(content)

        segments = do_diarize(str(tmp_path))
        return DiarizeResponse(
            segments=[DiarizeSegment(**s) for s in segments]
        )
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
