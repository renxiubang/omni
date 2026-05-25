import logging
import logging.handlers
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat, sessions, translate, users, voice, voice_print, wordbook
from app.config import settings
from app.db import init_db
from app.gateway import call_ws, stt_ws
from app.persona_loader import persona_store

# ── 日志配置：控制台 + 按天分隔的文件 ──
_log_dir = Path(__file__).parent.parent / "logs"
_log_dir.mkdir(exist_ok=True)

_root_logger = logging.getLogger()
_root_logger.setLevel(logging.INFO)

# 移除默认的 Handler，避免重复
_root_logger.handlers.clear()

# 控制台 Handler
_console = logging.StreamHandler()
_console.setLevel(logging.INFO)
_console.setFormatter(logging.Formatter("%(levelname)s:%(name)s:%(message)s"))
_root_logger.addHandler(_console)

# 按天分隔的文件 Handler（保留 30 天）
_file_handler = logging.handlers.TimedRotatingFileHandler(
    filename=_log_dir / "app.log",
    when="midnight",
    interval=1,
    backupCount=30,
    encoding="utf-8",
)
_file_handler.setLevel(logging.INFO)
_file_handler.setFormatter(
    logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
)
_root_logger.addHandler(_file_handler)

# 将 uvicorn 的 access/error 日志也写入文件
for _name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
    _uv_logger = logging.getLogger(_name)
    _uv_logger.handlers.clear()
    _uv_logger.addHandler(_file_handler)
    _uv_logger.propagate = False  # 避免重复输出到根 logger

logging.info("Log directory: %s", _log_dir)

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



@app.on_event("shutdown")
async def shutdown_event():
    pass


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
def get_config() -> dict:
    return {
        "output_sample_rate": settings.output_sample_rate,
    }
