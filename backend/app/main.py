import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat, sessions, translate, users, voice, voice_print, wordbook
from app.config import settings
from app.db import init_db
from app.gateway import call_ws, stt_ws
from app.persona_loader import persona_store

logging.basicConfig(level=logging.INFO)

# 启动时加载人格配置
_personas_path = settings.personas_path or str(
    Path(__file__).parent / "personas.yaml"
)
try:
    persona_store.load(_personas_path)
    logging.info("Loaded %d personas from %s", len(persona_store.list_all()), _personas_path)
except Exception as e:
    logging.warning("Failed to load personas: %s", e)

# 初始化数据库
try:
    init_db()
    logging.info("Database initialized successfully")
except Exception as e:
    logging.warning("Failed to initialize database: %s", e)

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
app.include_router(translate.router)
app.include_router(users.router)
app.include_router(voice.router)
app.include_router(voice_print.router)
app.include_router(wordbook.router)
app.include_router(call_ws.router)
app.include_router(stt_ws.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
def get_config() -> dict:
    return {
        "output_sample_rate": settings.output_sample_rate,
    }
