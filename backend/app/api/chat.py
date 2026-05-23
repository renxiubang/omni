import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.schemas.chat import ChatStreamRequest
from app.services.omni_client import omni_client
from app.services.session_store import session_store

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/stream")
async def chat_stream(body: ChatStreamRequest) -> StreamingResponse:
    session = session_store.get(body.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    user_msg = session_store.add_message(
        body.session_id,
        role="user",
        content=body.message,
        source="text",
    )

    async def generate():
        yield _sse(
            "user_message",
            {
                "id": user_msg.id,
                "content": user_msg.content,
                "role": "user",
                "source": "text",
            },
        )
        messages = omni_client.build_messages(session.messages)
        full: list[str] = []
        try:
            async for token in omni_client.stream_text(messages):
                full.append(token)
                yield _sse("token", {"delta": token})
            assistant = session_store.add_message(
                body.session_id,
                role="assistant",
                content="".join(full),
                source="text",
            )
            yield _sse("done", {"message_id": assistant.id})
        except Exception as e:
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
