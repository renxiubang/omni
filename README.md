# Omni Chat

基于多模态大模型的英语口语练习应用。支持文字聊天、语音消息、实时语音通话，后端 Python + FastAPI，多模态推理使用 **Qwen3.5-Omni**（DashScope API）。

## 功能

- **文字聊天**：SSE 流式回复，同时返回文字和语音（PCM16 音频）
- **语音消息**：按住说话 → 多模态 Omni 模型直接理解语音内容并回复
- **实时通话**：WebRTC 方案，浏览器与百炼 Realtime API 建立双向音频流
- **单词本**：LLM 解释单词 + DashScope CosyVoice TTS 发音
- **声纹管理**：录入和管理声纹音频档案
- **多人格切换**：英语老师 / 闲聊语伴 / 面试教练 / 旅行伙伴 / 雅思考官
- **划词翻译**：选中英文单词弹出 LLM 解释
- **流式语音转文字**：WebSocket 实时 ASR 识别

## 环境要求

- Python 3.11+
- Node.js 18+
- [DashScope API Key](https://help.aliyun.com/zh/model-studio/get-api-key)
- ffmpeg（ASR 音频转换需要）

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

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DASHSCOPE_API_KEY` | 必填，阿里云 DashScope API Key | - |
| `DASHSCOPE_BASE_URL` | API 地址 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `OMNI_MODEL` | 多模态模型 | `qwen3.5-omni-flash` |
| `OMNI_VOICE` | 通话音色 | `Tina` |
| `OMNI_AUDIO_FORMAT` | 音频输出格式 | `pcm16` |
| `ASR_MODEL` | ASR 识别模型 | `paraformer-realtime-v2` |
| `ASR_SAMPLE_RATE` | ASR 采样率 (Hz) | `16000` |
| `CORS_ORIGINS` | 允许的前端域名（逗号分隔） | `http://localhost:5173` |
| `MAX_AUDIO_HISTORY_TURNS` | 携带音频的历史轮次上限 | `3` |
| `DEFAULT_PERSONA` | 默认人格标识 | `english_teacher` |
| `OUTPUT_SAMPLE_RATE` | 统一输出音频采样率 (Hz) | `24000` |
| `DASHSCOPE_REALTIME_URL` | Realtime API WebSocket 地址 | `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-omni-flash-realtime` |

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                       Frontend (React)                   │
│  ChatPage │ LoginPage │ WordbookPage │ CallScreenWebRTC │
│  Composer │ MessageBubble │ VoiceHoldButton │ PCMPlayer │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP/SSE │ WebSocket │ WebRTC
┌──────────────────────┴──────────────────────────────────┐
│                   Backend (FastAPI)                       │
│                                                          │
│  ┌──────────────┐  ┌──────────────────────────────────┐ │
│  │  REST API    │  │  Gateway (WebSocket/WebRTC)       │ │
│  │  /api/chat   │  │  /api/call (语音通话 WS)          │ │
│  │  /api/sessions│  │  /api/chat/stt-stream (STT WS)  │ │
│  │  /api/users  │  │  /api/webrtc/offer (WebRTC SDP)  │ │
│  │  /api/wordbook│ │                                    │ │
│  │  /api/voice-print│                                │ │
│  │  /api/translate│ │                                  │ │
│  └──────┬───────┘  └──────────────┬───────────────────┘ │
│         │                         │                      │
│  ┌──────┴─────────────────────────┴───────────────────┐ │
│  │                   Services                          │ │
│  │  OmniClient │ AsrClient │ RealtimeAPIClient         │ │
│  │  SessionStore (内存会话管理)                         │ │
│  └──────────────────────┬─────────────────────────────┘ │
│                         │                                │
│  ┌──────────────────────┴─────────────────────────────┐ │
│  │               External APIs                         │ │
│  │  DashScope Omni (LLM+Audio) │ DashScope ASR          │ │
│  │  DashScope CosyVoice (TTS) │ 百炼 Realtime API       │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Storage: SQLite (omni.db) │ SessionStore (内存)     │ │
│  │  表: users │ wordbook │ voice_profiles              │ │
│  └────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 数据流

**文字聊天 (SSE)**：
```
POST /api/chat/stream → SessionStore(存储消息) → OmniClient.stream_call()
→ DashScope Omni API → SSE 流: token(文字) + assistant_audio(PCM16 base64)
```

**语音消息 (SSE)**：
```
POST /api/chat/voice → 音频存入 SessionStore → OmniClient 将音频编码为 input_audio
→ 多模态理解语音 → SSE 流: token + assistant_audio
```

**WebRTC 实时通话**：
```
POST /api/webrtc/offer (SDP 握手)
→ 浏览器麦克风 (48kHz) → 重采样 16kHz → RealtimeAPIClient (百炼 WS)
→ 百炼返回 PCM 音频 (24kHz) → 重采样 48kHz → 浏览器 audio 播放
```

### 人格系统

`personas.yaml` 定义 5 种英语对话人格，创建会话时自动注入对应 system prompt：

| 标识 | 名称 | 难度 | 说明 |
|------|------|------|------|
| `english_teacher` | 耐心英语老师 | 初中级 | 温和纠正语法和用词错误 |
| `language_partner` | 闲聊语伴 | 中高级 | 像朋友一样轻松聊天 |
| `interview_coach` | 面试教练 | 中高级 | 模拟英文工作面试 |
| `travel_buddy` | 旅行伙伴 | 初中级 | 模拟旅行场景对话 |
| `ielts_examiner` | 雅思口语考官 | 高级 | 严格按雅思口语格式模拟考试 |

## 项目结构

```
omni/
├── backend/
│   ├── app/
│   │   ├── main.py                # FastAPI 应用入口，路由注册
│   │   ├── config.py              # 配置管理（pydantic-settings）
│   │   ├── persona_loader.py      # 人格配置加载器
│   │   ├── personas.yaml          # 人格定义文件
│   │   ├── api/                   # REST API 路由
│   │   │   ├── chat.py            # 文字/语音聊天（SSE）
│   │   │   ├── sessions.py        # 会话管理
│   │   │   ├── translate.py       # 英文翻译
│   │   │   ├── users.py           # 用户登录/查询
│   │   │   ├── voice.py           # 语音消息聊天
│   │   │   ├── voice_print.py     # 声纹管理
│   │   │   └── wordbook.py        # 单词本 + LLM解释 + TTS发音
│   │   ├── gateway/               # WebSocket / WebRTC 网关
│   │   │   ├── call_ws.py         # 语音通话 WebSocket
│   │   │   ├── stt_ws.py          # 流式语音转文字 WebSocket
│   │   │   └── webrtc_gateway.py  # WebRTC SDP 协商 + 音频流转发
│   │   ├── services/              # 核心服务
│   │   │   ├── omni_client.py     # Omni 多模态 LLM 客户端
│   │   │   ├── asr_client.py      # 语音识别客户端
│   │   │   ├── realtime_client.py # 百炼 Realtime API 客户端
│   │   │   └── session_store.py   # 会话内存存储
│   │   ├── schemas/               # Pydantic 数据模型
│   │   │   └── chat.py            # SessionOut, ChatStreamRequest, MessageOut
│   │   └── db/                    # 数据库模块
│   │       └── database.py        # SQLite 操作（users/wordbook/voice_profiles）
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── api/                   # API 客户端
│   │   │   ├── client.ts          # 核心 API（SSE/WebSocket/STT）
│   │   │   ├── wordbookApi.ts     # 单词本 API
│   │   │   └── voicePrintApi.ts   # 声纹 API
│   │   ├── audio/                 # 音频处理
│   │   │   ├── pcmPlayer.ts       # PCM16 流式播放器（Web Audio API）
│   │   │   └── pcmToWav.ts        # PCM→WAV 转换
│   │   ├── components/            # UI 组件
│   │   │   ├── Composer.tsx       # 底部输入栏（文字+录音+通话）
│   │   │   ├── MessageBubble.tsx  # 消息气泡（文字/语音）
│   │   │   ├── MessageList.tsx    # 消息列表容器
│   │   │   ├── VoiceHoldButton.tsx# 按住录音按钮
│   │   │   ├── VoicePrintEnroll.tsx# 声纹录入组件
│   │   │   ├── WordExplanationPopup.tsx # 单词解释浮窗
│   │   │   ├── WordbookDrawer.tsx # 单词本侧滑抽屉
│   │   │   └── CallScreenWebRTC.tsx# WebRTC 通话页面
│   │   ├── pages/                 # 页面
│   │   │   ├── ChatPage.tsx       # 主聊天页
│   │   │   ├── LoginPage.tsx      # 登录页
│   │   │   ├── SettingsPage.tsx   # 设置抽屉
│   │   │   └── WordbookPage.tsx   # 独立单词本页
│   │   ├── context/
│   │   │   └── AuthContext.tsx     # 认证上下文
│   │   ├── hooks/
│   │   │   └── useVoicePrint.ts   # 声纹管理 Hook
│   │   └── types/
│   │       └── chat.ts            # TypeScript 类型定义
│   └── package.json
└── README.md
```

## API 摘要

### REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/config` | 获取前端配置（输出采样率） |
| POST | `/api/sessions` | 创建会话，支持 `?persona=` 指定人格 |
| GET | `/api/sessions/{session_id}/messages` | 获取会话历史消息 |
| GET | `/api/sessions/personas` | 获取可用人格列表 |
| POST | `/api/chat/stream` | 文字流式对话（SSE） |
| POST | `/api/chat/voice` | 语音流式对话（SSE，multipart) |
| POST | `/api/chat/stt` | 语音转文字（上传音频文件） |
| POST | `/api/translate/to-zh` | 英文翻译为中文 |
| POST | `/api/users/login` | 模拟登录（自动注册） |
| GET | `/api/users/me` | 查询用户信息 |
| POST | `/api/wordbook/add` | 添加单词 |
| GET | `/api/wordbook/list` | 获取单词本列表 |
| DELETE | `/api/wordbook/{word_id}` | 删除单词 |
| POST | `/api/wordbook/explain` | LLM 解释单词 |
| POST | `/api/wordbook/pronounce` | TTS 单词发音（返回 WAV） |
| POST | `/api/voice-print/enroll` | 录入声纹 |
| GET | `/api/voice-print/list` | 声纹列表 |
| GET | `/api/voice-print/{profile_id}` | 声纹详情 |
| DELETE | `/api/voice-print/{profile_id}` | 删除声纹 |
| GET | `/api/voice-print/audio/{profile_id}/{sample_index}` | 下载声纹音频样本 |
| POST | `/api/webrtc/offer` | WebRTC SDP 握手 |

### WebSocket

| 路径 | 说明 |
|------|------|
| `ws://host/api/call?session_id=` | 语音通话（双向文字+音频） |
| `ws://host/api/chat/stt-stream` | 流式语音转文字（实时 ASR） |

### SSE 事件类型

| 事件 | 说明 |
|------|------|
| `user_message` | 服务端确认收到用户消息 |
| `token` | AI 回复的文字增量 |
| `assistant_audio` | AI 回复的语音（base64 PCM16） |
| `done` | 对话完成 |
| `error` | 错误信息 |

## 技术栈

**后端**：
- Python 3.11+ / FastAPI
- DashScope API（Omni 多模态 / ASR / CosyVoice TTS）
- 百炼 Realtime API（WebRTC 实时通话）
- SQLite（用户/单词本/声纹持久化）
- aiortc（WebRTC）
- PyYAML（人格配置）

**前端**：
- React 18 / TypeScript
- React Router v6
- Web Audio API（PCM 流式播放）
- WebRTC（实时通话）
- Vite 构建
