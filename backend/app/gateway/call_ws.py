"""语音通话 WebSocket 网关（DashScope Realtime VAD 模式）。

前端持续发送音频块 → 后端转发给 DashScope Realtime API → DashScope VAD
检测语音起止 → 实时返回文本/音频 → 后端转发给前端。
声纹识别：在 speech_stopped 时异步识别说话人身份。
"""

import asyncio
import json
import logging
import struct
import tempfile
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.config import settings
from app.persona_loader import persona_store
from app.services.realtime_client import RealtimeClient
from app.services.session_store import session_store

logger = logging.getLogger(__name__)
router = APIRouter()

# 声纹识别线程池（避免阻塞事件循环）
_voiceprint_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="voiceprint")


async def _send(ws: WebSocket, payload: dict) -> None:
    await ws.send_text(json.dumps(payload, ensure_ascii=False))


def _base64_chunks_to_wav(b64_chunks: list[str], sample_rate: int = 16000) -> str:
    """将 base64 PCM16 音频块拼接并写入临时 WAV 文件，返回文件路径。"""
    import base64
    all_bytes = bytearray()
    for chunk in b64_chunks:
        all_bytes.extend(base64.b64decode(chunk))

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    try:
        with wave.open(tmp, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(bytes(all_bytes))
        return tmp.name
    except Exception:
        try:
            Path(tmp.name).unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _run_voiceprint_identify(wav_path: str, user_id: int) -> dict | None:
    """在线程池中运行的声纹识别（同步函数）。"""
    try:
        from app.services.voiceprint_service import extract_embedding, identify_embedding
        from app.db import database
    except ImportError:
        return None

    # 提取嵌入
    test_emb = extract_embedding(wav_path)
    if test_emb is None:
        return None

    # 获取候选嵌入
    candidates = database.get_all_embeddings_for_user(user_id)
    if not candidates:
        return None

    # 识别
    cand_list = [(c["id"], c["name"], c["embedding"]) for c in candidates]
    result = identify_embedding(
        test_emb, cand_list,
        threshold=settings.voiceprint_threshold,
    )
    if result:
        return {
            "profile_id": result[0],
            "profile_name": result[1],
            "score": round(result[2], 4),
        }
    return None


@router.websocket("/api/call")
async def call_ws(ws: WebSocket, session_id: str = Query(...), video: bool = Query(False)) -> None:
    await ws.accept()
    session = session_store.get(session_id)
    if not session:
        await _send(ws, {"type": "error", "message": "Session not found"})
        await ws.close()
        return

    # 获取人格 system prompt
    persona = persona_store.get(session.persona or None)
    instructions = persona.system_prompt

    # 视频通话：追加视觉注意力判断指令（来自配置文件 call_prompts.video_attention）
    if video:
        video_prompt = persona_store.get_call_prompt("video_attention")
        if video_prompt:
            instructions += "\n\n" + video_prompt

    # 如果开启了单词本训练模式，追加约束指令（放在人格 prompt 前面，优先级更高）
    from app.services.wordbook_trainer import wordbook_trainer as wt
    training_msgs = [
        m for m in session.messages
        if m.role == "system" and "VOCABULARY TRAINING MODE" in m.content
    ]
    if training_msgs:
        instructions = training_msgs[-1].content + "\n\n" + instructions

    # 创建 RealtimeClient
    client = RealtimeClient(instructions=instructions)

    # ---- 设置 DashScope 事件回调 ----
    async def on_speech_started() -> None:
        # 清空上一轮音频（开始新轮次）
        if voiceprint_enabled:
            current_turn_chunks.clear()
        await _send(ws, {"type": "speech_started"})

    async def on_speech_stopped() -> None:
        await _send(ws, {"type": "speech_stopped"})
        # 声纹识别：异步识别当前轮次说话人
        if voiceprint_enabled and current_turn_chunks and session and session.user_id:
            chunks_snapshot = list(current_turn_chunks)
            current_turn_chunks.clear()
            user_id = session.user_id
            loop = asyncio.get_running_loop()

            async def _identify_and_send():
                try:
                    wav_path = await loop.run_in_executor(
                        None, _base64_chunks_to_wav, chunks_snapshot, 16000
                    )
                    result = await loop.run_in_executor(
                        _voiceprint_executor, _run_voiceprint_identify, wav_path, user_id
                    )
                    # 清理临时文件
                    try:
                        Path(wav_path).unlink(missing_ok=True)
                    except OSError:
                        pass
                    if result:
                        await _send(ws, {"type": "speaker_identified", **result})
                        logger.info(
                            "Speaker identified: %s (score=%.4f)",
                            result.get("profile_name"), result.get("score"),
                        )
                    else:
                        # 声纹验证模式：未匹配则拒绝，取消助手回复
                        await _send(ws, {"type": "speaker_rejected", "message": "说话人未识别，对话已中断"})
                        await client.cancel_response()
                        logger.warning("Speaker rejected: no matching voiceprint")
                except Exception:
                    logger.exception("Voiceprint identification failed")

            asyncio.create_task(_identify_and_send())

    # 用户语音 ASR 转写
    async def on_user_transcript_delta(delta: str) -> None:
        await _send(ws, {"type": "user_transcript", "delta": delta})

    async def on_user_transcript_done(transcript: str) -> None:
        await _send(ws, {
            "type": "user_transcript_done",
            "transcript": transcript,
        })

    # AI 回复的文字转录
    async def on_transcript_delta(delta: str) -> None:
        await _send(ws, {"type": "assistant_transcript", "delta": delta})

    async def on_transcript_done(transcript: str) -> None:
        await _send(ws, {
            "type": "assistant_transcript_done",
            "transcript": transcript,
        })

    async def on_audio_delta(b64: str) -> None:
        await _send(ws, {
            "type": "assistant_audio",
            "data": b64,
            "sample_rate": 24000,
        })

    async def on_response_done() -> None:
        await _send(ws, {"type": "turn_end"})

    async def on_error(msg: str) -> None:
        await _send(ws, {"type": "error", "message": msg})

    client.on_speech_started = on_speech_started
    client.on_speech_stopped = on_speech_stopped
    client.on_user_transcript_delta = on_user_transcript_delta
    client.on_user_transcript_done = on_user_transcript_done
    client.on_transcript_delta = on_transcript_delta
    client.on_transcript_done = on_transcript_done
    client.on_audio_delta = on_audio_delta
    client.on_response_done = on_response_done
    client.on_error = on_error

    try:
        await client.connect()
    except Exception as e:
        logger.exception("RealtimeClient connect failed")
        await _send(ws, {"type": "error", "message": str(e)})
        await ws.close()
        return

    # 声纹识别：收集当前轮次的用户音频
    current_turn_chunks: list[str] = []
    voiceprint_enabled = session.voiceprint_verification

    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type")

            if msg_type == "audio_chunk":
                b64 = data.get("data", "")
                if b64:
                    await client.send_audio(b64)
                    # 声纹识别：收集音频块
                    if voiceprint_enabled:
                        current_turn_chunks.append(b64)

            elif msg_type == "image_chunk":
                jpeg_b64 = data.get("data", "")
                if jpeg_b64:
                    await client.send_image(jpeg_b64)

            elif msg_type == "hangup":
                break

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("call ws error")
    finally:
        await client.close()
