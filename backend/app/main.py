import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat, sessions, voice
from app.config import settings
from app.gateway import call_ws

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Omni Chat", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(chat.router)
app.include_router(voice.router)
app.include_router(call_ws.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
