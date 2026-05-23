import base64
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal


@dataclass
class StoredMessage:
    id: str
    role: Literal["user", "assistant", "system"]
    content: str
    source: Literal["text", "voice", "call"] = "text"
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    audio_b64: str | None = None
    audio_format: str = "wav"


@dataclass
class Session:
    id: str
    messages: list[StoredMessage] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def create(self) -> Session:
        session = Session(id=str(uuid.uuid4()))
        self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    def add_message(
        self,
        session_id: str,
        *,
        role: Literal["user", "assistant", "system"],
        content: str,
        source: Literal["text", "voice", "call"] = "text",
        audio_bytes: bytes | None = None,
        audio_format: str = "wav",
    ) -> StoredMessage:
        session = self._sessions[session_id]
        audio_b64 = base64.b64encode(audio_bytes).decode() if audio_bytes else None
        msg = StoredMessage(
            id=str(uuid.uuid4()),
            role=role,
            content=content,
            source=source,
            audio_b64=audio_b64,
            audio_format=audio_format,
        )
        session.messages.append(msg)
        return msg


session_store = SessionStore()
