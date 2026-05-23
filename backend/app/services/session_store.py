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
    persona: str = ""
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def create(self, persona: str | None = None) -> Session:
        """创建新会话，可选注入人格 system prompt。"""
        from app.config import settings
        from app.persona_loader import persona_store as ps

        session = Session(id=str(uuid.uuid4()))
        self._sessions[session.id] = session

        # 根据人格标识注入 system 消息
        persona_key = persona or settings.default_persona
        try:
            p = ps.get(persona_key)
            session.persona = p.key
            msg = StoredMessage(
                id=str(uuid.uuid4()),
                role="system",
                content=p.system_prompt,
                source="text",
            )
            session.messages.append(msg)
        except Exception:
            session.persona = ""

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
