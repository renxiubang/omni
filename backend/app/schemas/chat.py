from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SessionOut(BaseModel):
    session_id: str


class ChatStreamRequest(BaseModel):
    session_id: str
    message: str = Field(min_length=1, max_length=8000)


class MessageOut(BaseModel):
    id: str
    role: Literal["user", "assistant", "system"]
    content: str
    source: Literal["text", "voice", "call"] = "text"
    created_at: datetime
    audio_ref: str | None = None
