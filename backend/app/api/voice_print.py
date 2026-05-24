"""
Voice Print API module.

This module provides API endpoints for voice print enrollment and management.
"""
import json
import os
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.db import database
from app.config import settings

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

    # Save audio files
    saved_paths = []
    for i, audio_file in enumerate(audio_samples):
        # Generate unique filename
        filename = f"user_{user_id}_{name}_{i}_{audio_file.filename}"
        file_path = VOICE_PRINT_DIR / filename

        # Save file
        try:
            with open(file_path, "wb") as f:
                content = await audio_file.read()
                f.write(content)
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

    # Create voice profile in database
    try:
        profile = database.create_voice_profile(
            user_id=user_id,
            name=name,
            audio_samples=saved_paths,
            enrollment_text=enrollment_text,
        )
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
