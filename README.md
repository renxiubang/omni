# Omni Web Chat

微信风格 Web 智能体对话：文字、语音消息、语音通话。后端 Python + FastAPI，多模态推理使用 **Qwen3.5-Omni**（DashScope API）。

## 功能

- **文字聊天**：SSE 流式回复
- **语音消息**：按住说话 → DashScope ASR 展示字幕 → `input_audio` 送入 Omni 推理
- **打电话**：WebSocket 双工，Omni 同时流式输出文字与语音（pcm16 @ 24kHz）

## 环境要求

- Python 3.11+
- Node.js 18+
- [DashScope API Key](https://help.aliyun.com/zh/model-studio/get-api-key)

## 快速开始

### 1. 后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# 编辑 .env，填入 DASHSCOPE_API_KEY
uvicorn app.main:app --reload --port 8000
```

### 2. 前端

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 http://localhost:5173（Vite 已将 `/api` 代理到后端）。

### 环境变量

| 变量 | 说明 |
|------|------|
| `DASHSCOPE_API_KEY` | 必填 |
| `DASHSCOPE_BASE_URL` | 默认国内 compatible-mode |
| `OMNI_MODEL` | 默认 `qwen3.5-omni-flash` |
| `OMNI_VOICE` | 通话音色，默认 `Tina` |
| `ASR_MODEL` | 默认 `paraformer-v2` |

## 项目结构

```
omni/
├── backend/app/     # FastAPI、OmniClient、ASR、WebSocket 通话
└── frontend/src/    # React 聊天 UI
```

## API 摘要

- `POST /api/sessions` — 创建会话
- `POST /api/chat/stream` — 文字 SSE
- `POST /api/chat/voice` — 语音 multipart SSE
- `WS /api/call?session_id=` — 语音通话
