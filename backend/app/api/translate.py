from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.omni_client import omni_client
from app.config import settings

router = APIRouter(prefix="/api/translate", tags=["translate"])


class TranslateRequest(BaseModel):
    text: str


class TranslateResponse(BaseModel):
    text: str
    translation: str
    source: str
    target: str


SYSTEM_PROMPT = """You are a professional English-to-Chinese translator.
Given an English sentence, translate it into natural, colloquial Chinese.
Only output the Chinese translation, nothing else. Do NOT add any explanations or notes.
Keep the translation natural and conversational, suitable for spoken Chinese."""


@router.post("/to-zh", response_model=TranslateResponse)
async def translate_to_zh(body: TranslateRequest) -> TranslateResponse:
    """使用多模态大模型将英文翻译为中文"""
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    try:
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": body.text},
        ]

        client = omni_client._get_client()
        response = await client.chat.completions.create(
            model=settings.omni_model,
            messages=messages,
            modalities=["text"],
            stream=False,
        )

        translation = response.choices[0].message.content or ""
        return TranslateResponse(
            text=body.text,
            translation=translation.strip(),
            source="en",
            target="zh",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
