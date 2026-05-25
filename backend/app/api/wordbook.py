"""Wordbook-related API routes for Omni Chat application."""

import json
import logging
import re
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import (
    add_word_to_wordbook,
    get_user_wordbook,
    delete_word_from_wordbook,
    check_word_in_wordbook,
    get_user_by_id,
)
from app.services.omni_client import omni_client
from app.config import settings

router = APIRouter(prefix="/api/wordbook", tags=["wordbook"])


class WordAddRequest(BaseModel):
    """Request model for adding a word to wordbook."""
    user_id: int
    word: str
    phonetic_uk: str = ""
    phonetic_us: str = ""
    explanation: str = ""
    example_sentence_en: str = ""
    example_sentence_zh: str = ""


class WordResponse(BaseModel):
    """Response model for word data."""
    id: int
    user_id: int
    word: str
    phonetic_uk: str = ""
    phonetic_us: str = ""
    explanation: str = ""
    example_sentence_en: str = ""
    example_sentence_zh: str = ""
    created_at: str


class WordExplainRequest(BaseModel):
    """Request model for word explanation."""
    word: str


class WordExplainResponse(BaseModel):
    """Response model for word explanation."""
    word: str
    phonetic_uk: str = ""
    phonetic_us: str = ""
    explanation: str = ""
    example_sentence_en: str = ""
    example_sentence_zh: str = ""


@router.post("/add", response_model=WordResponse)
async def add_word(request: WordAddRequest) -> dict:
    """
    Add a word to user's wordbook.
    
    If the word already exists in the user's wordbook,
    returns an error.
    """
    # Validate user exists
    user = get_user_by_id(request.user_id)
    if not user:
        raise HTTPException(
            status_code=404,
            detail=f"User with ID {request.user_id} not found"
        )
    
    # Validate word is not empty
    word = request.word.strip()
    if not word:
        raise HTTPException(status_code=400, detail="Word cannot be empty")
    
    # Check if word already exists in wordbook
    existing = check_word_in_wordbook(request.user_id, word)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Word '{word}' already exists in wordbook"
        )
    
    # Add word to wordbook
    try:
        result = add_word_to_wordbook(
            user_id=request.user_id,
            word=word,
            phonetic_uk=request.phonetic_uk,
            phonetic_us=request.phonetic_us,
            explanation=request.explanation,
            example_sentence_en=request.example_sentence_en,
            example_sentence_zh=request.example_sentence_zh
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        print(f"Error adding word to wordbook: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/list", response_model=list[WordResponse])
async def get_wordbook(
    user_id: int = Query(..., description="User ID to get wordbook for")
) -> list[dict]:
    """
    Get all words in user's wordbook.
    
    Returns words ordered by created_at descending (newest first).
    """
    # Validate user exists
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=404,
            detail=f"User with ID {user_id} not found"
        )
    
    # Get wordbook
    try:
        words = get_user_wordbook(user_id)
        return words
    except Exception as e:
        print(f"Error getting wordbook: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/{word_id}")
async def delete_word(word_id: int, user_id: int = Query(..., description="User ID")) -> dict:
    """
    Delete a word from user's wordbook.
    
    Requires user_id to ensure users can only delete their own words.
    """
    # Validate user exists
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=404,
            detail=f"User with ID {user_id} not found"
        )
    
    # Delete word
    try:
        deleted = delete_word_from_wordbook(word_id, user_id)
        if not deleted:
            raise HTTPException(
                status_code=404,
                detail=f"Word with ID {word_id} not found in your wordbook"
            )
        return {"success": True, "message": "Word deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error deleting word from wordbook: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/explain", response_model=WordExplainResponse)
async def explain_word(request: WordExplainRequest) -> dict:
    """
    Get detailed explanation of an English word/phrase.
    
    Uses the Omni LLM to generate:
    - Chinese explanation (with part of speech)
    - IPA phonetic symbols (UK and US)
    - Example sentences (English + Chinese translation)
    
    Returns structured data that can be used to add to wordbook.
    """
    word = request.word.strip()
    if not word:
        raise HTTPException(status_code=400, detail="Word cannot be empty")
    
    # Validate it's likely an English word/phrase
    if not re.match(r"^[a-zA-Z\s\-']+$", word):
        raise HTTPException(
            status_code=400,
            detail="Input must be an English word or phrase"
        )
    
    # Prepare prompt for LLM
    prompt = f"""Please explain the following English word/phrase in detail.

Provide the explanation in JSON format with the following structure:
{{
  "explanation": "Part of speech + Chinese meaning",
  "phonetic_uk": "UK IPA phonetic symbol",
  "phonetic_us": "US IPA phonetic symbol",
  "example_sentence_en": "Example sentence in English",
  "example_sentence_zh": "Chinese translation of the example sentence"
}}

Requirements:
1. explanation should include part of speech (n./v./adj./etc.) and detailed Chinese meaning
2. phonetic symbols should be in IPA format, e.g., /həˈləʊ/ (UK), /həˈloʊ/ (US)
3. Provide a natural example sentence that demonstrates the word's usage
4. If it's a phrase, provide explanation for the whole phrase
5. Return ONLY the JSON, no other text

Word/phrase: {word}"""
    
    try:
        # Call LLM to get explanation
        messages = [{"role": "user", "content": prompt}]
        
        # Collect streaming response
        full_response = ""
        async for chunk in omni_client.stream_text(messages):
            full_response += chunk
        
        # Try to parse JSON from response
        # The LLM might return markdown code block, so we need to extract JSON
        json_match = re.search(r"```json\s*(.*?)\s*```", full_response, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
        else:
            # Try to find JSON directly
            json_match = re.search(r"\{.*\}", full_response, re.DOTALL)
            if json_match:
                json_str = json_match.group(0)
            else:
                json_str = full_response
        
        # Parse JSON
        try:
            data = json.loads(json_str)
        except json.JSONDecodeError:
            # If JSON parsing fails, try to extract structured data from text
            print(f"Failed to parse JSON from LLM response: {full_response}")
            # Return a basic response
            return {
                "word": word,
                "explanation": full_response[:200] if full_response else "Unable to explain",
                "phonetic_uk": "",
                "phonetic_us": "",
                "example_sentence_en": "",
                "example_sentence_zh": ""
            }
        
        # Return structured response
        return {
            "word": word,
            "explanation": data.get("explanation", ""),
            "phonetic_uk": data.get("phonetic_uk", ""),
            "phonetic_us": data.get("phonetic_us", ""),
            "example_sentence_en": data.get("example_sentence_en", ""),
            "example_sentence_zh": data.get("example_sentence_zh", "")
        }
        
    except Exception as e:
        print(f"Error explaining word: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to generate word explanation"
        )


class WordPronounceRequest(BaseModel):
    """Request model for word pronunciation."""
    word: str
    voice: str = "longxiaochun"  # Default female voice


@router.post("/pronounce")
async def pronounce_word(request: WordPronounceRequest):
    """
    Generate word pronunciation audio using DashScope TTS API.
    
    Returns WAV audio file.
    Voice options:
    - longxiaochun (female, default)
    - longxiaoming (male)
    """
    word = request.word.strip()
    if not word:
        raise HTTPException(status_code=400, detail="Word cannot be empty")
    
    try:
        import dashscope
        from dashscope.audio.tts import SpeechSynthesizer
        from fastapi.responses import Response
        
        # 设置 DashScope API Key（.env 中 DASHSCOPE_API_KEY 已由 config 读取）
        dashscope.api_key = settings.dashscope_api_key
        
        # Call DashScope TTS API
        result = SpeechSynthesizer.call(
            model='cosyvoice-v1',
            text=word,
            voice=request.voice,
            sample_rate=16000
        )
        
        if result.get_audio_data():
            audio_data = result.get_audio_data()
            
            # Return audio as WAV file
            return Response(
                content=audio_data,
                media_type="audio/wav",
                headers={
                    "Content-Disposition": f"attachment; filename=\"{word}.wav\""
                }
            )
        else:
            raise HTTPException(
                status_code=500,
                detail="Failed to generate pronunciation audio"
            )
            
    except ImportError:
        # Fallback: if dashscope TTS is not available, return error
        logging.error("dashscope library not available for TTS")
        raise HTTPException(
            status_code=501,
            detail="TTS service not available"
        )
    except Exception as e:
        logging.error("Error generating pronunciation: %s", e)
        raise HTTPException(
            status_code=500,
            detail="Failed to generate pronunciation audio"
        )
