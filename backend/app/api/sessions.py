from fastapi import APIRouter, HTTPException

from app.schemas.chat import MessageOut, SessionOut
from app.services.session_store import session_store

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=SessionOut)
def create_session() -> SessionOut:
    session = session_store.create()
    return SessionOut(session_id=session.id)


@router.get("/{session_id}/messages", response_model=list[MessageOut])
def list_messages(session_id: str) -> list[MessageOut]:
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return [
        MessageOut(
            id=m.id,
            role=m.role,
            content=m.content,
            source=m.source,
            created_at=m.created_at,
            audio_ref=m.audio_b64[:32] + "..." if m.audio_b64 else None,
        )
        for m in session.messages
    ]
