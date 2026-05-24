---
name: WebRTC 回声消除改造（aiortc 方案）
overview: 通过 aiortc 在自己的后端搭建 WebRTC 媒体服务器，前端通过 WebRTC 发送音频（浏览器原生 AEC 生效），后端将音频通过 WebSocket 转发给百炼 Realtime API，再将返回的音频通过 WebRTC 发回前端，彻底消除回声。无需申请百炼 WebRTC 白名单。
todos:
  - id: install-deps
    content: 安装 aiortc、av、websockets 依赖到 backend/requirements.txt
    status: pending
  - id: update-config
    content: 更新 backend/app/config.py 添加百炼 Realtime API 配置
    status: pending
    dependencies:
      - install-deps
  - id: create-realtime-client
    content: 创建 backend/app/services/realtime_client.py 百炼 Realtime API 客户端
    status: pending
    dependencies:
      - update-config
  - id: create-webrtc-gateway
    content: 创建 backend/app/gateway/webrtc_gateway.py WebRTC 网关
    status: pending
    dependencies:
      - create-realtime-client
  - id: register-router
    content: 修改 backend/app/main.py 注册 WebRTC 路由和关闭事件
    status: pending
    dependencies:
      - create-webrtc-gateway
  - id: update-frontend
    content: 修改 frontend/src/components/CallScreen.tsx 改为 WebRTC 接入
    status: pending
    dependencies:
      - register-router
  - id: test-webrtc
    content: 集成测试：验证 WebRTC 连接、音频传输、回声消除效果
    status: pending
    dependencies:
      - update-frontend
---

## 用户需求

将现有 Omni 通话系统从 WebSocket + HTTP streaming 架构改为 WebRTC 接入，根治智能体播放声音被麦克风捕获的回声问题。

## 核心功能

1. **WebRTC 接入自己的 Python 后端**：前端通过 RTCPeerConnection 连接自己的后端，音频通过 RTP 轨道传输，浏览器原生 AEC 自动生效
2. **后端 aiortc 接收 WebRTC 音频流**：使用 aiortc 库接收前端传来的纯净 WebRTC 音频流
3. **音频重采样**：利用 PyAV 进行重采样（48kHz → 16kHz），然后通过 WebSocket 发送给百炼 Realtime API
4. **百炼 Realtime API 交互**：后端通过 WebSocket 连接百炼 Realtime API，发送音频并接收 AI 响应
5. **音频回传**：接收百炼返回的 16kHz PCM 音频，重采样（16kHz → 48kHz）通过 WebRTC 发回前端
6. **前端 ontrack 音频播放**：通过 ontrack 事件接收音频，用 `<audio>` 标签播放（浏览器 AEC 自动生效）

## 功能边界

- 音频输入：通过 WebRTC 音频轨道自动传输到自己的后端，再转发到百炼
- 音频输出：通过 ontrack 事件接收并播放（浏览器 AEC 自动生效）
- 文本接收：通过百炼 Realtime API 的 WebSocket 接收文本事件
- VAD 模式：使用服务端 VAD（server_vad），前端无需手动控制语音起止
- 不需要申请百炼 WebRTC 白名单（通过自己的后端做协议转换）

## 技术限制

- 浏览器 WebRTC 底层强制使用 48kHz / 16-bit / Mono
- 百炼 qwen3.5-omni-flash-realtime 要求 16kHz / 16-bit / Mono
- 必须使用 `av.AudioResampler` 进行重采样（C 语言底层实现，延迟极低），不能用 Python 的 for 循环抽点降采样
- 网络环境需要开放 UDP 端口（WebRTC 依赖 UDP）

## 技术栈选择

- **前端**：WebRTC API（RTCPeerConnection、MediaStreamTrack、DataChannel）
- **后端**：FastAPI + aiortc（WebRTC 媒体服务器）+ websockets（百炼 Realtime API 客户端）+ PyAV（音频重采样）
- **百炼 API**：Qwen-Omni Realtime（WebSocket 模式，无需白名单）

## 实现方案

### 架构变化对比

**现有架构**：

```
前端 → WebSocket → 后端 → DashScope HTTP streaming → 后端 → WebSocket → 前端
                                              ↓
                                        PcmPlayer (AudioContext) 播放
                                              ↓
                                        浏览器 AEC 无参考信号 → 回声问题
```

**改造后架构**：

```
前端 ←WebRTC→ 后端（aiortc + 协议转换）←WebSocket→ 百炼 Realtime API
  ↓                                           ↓
  ├─ 音频轨道 (RTP) ─────────────→ 发送用户语音（已 AEC 净化）
  ├─ 音频轨道 (RTP) ←───────────── 接收 AI 语音（AEC 自动生效）
  └─ DataChannel ←────────────────── 接收文本/事件
```

### 后端改造

#### 1. 新增依赖（backend/requirements.txt）

```
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
openai>=1.52.0
pydantic-settings>=2.6.0
python-multipart>=0.0.12
dashscope>=1.20.0
aiofiles>=24.1.0
pyyaml>=6.0
aiortc>=1.9.0
av>=13.0.0
websockets>=12.0
```

#### 2. 新增配置（backend/app/config.py）

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    dashscope_api_key: str = ""
    dashscope_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    omni_model: str = "qwen3.5-omni-flash"
    omni_voice: str = "Ethan"
    omni_audio_format: str = "pcm"
    dashscope_realtime_url: str = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-omni-flash-realtime"
    cors_origins: str = "http://localhost:5173"
    max_audio_history_turns: int = 3
    default_persona: str = "english_teacher"
    personas_path: str = ""
    output_sample_rate: int = 24000

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
```

#### 3. 新增百炼 Realtime API 客户端（backend/app/services/realtime_client.py）

```python
import asyncio
import base64
import json
import logging
from asyncio import Queue

import websockets
from av import AudioFrame, AudioResampler

logger = logging.getLogger(__name__)

# 音频重采样器
resampler_to_16k = AudioResampler(format='s16', layout='mono', rate=16000)
resampler_to_48k = AudioResampler(format='s16', layout='mono', rate=48000)


class RealtimeAPIClient:
    """百炼 Realtime API WebSocket 客户端"""

    def __init__(self, api_key: str, url: str):
        self.api_key = api_key
        self.url = url
        self.ws = None
        self.audio_queue = Queue()
        self.text_delta_queue = Queue()
        self._listen_task = None

    async def connect(self):
        """连接百炼 Realtime API 并发送会话配置"""
        headers = {"Authorization": f"Bearer {self.api_key}"}
        self.ws = await websockets.connect(self.url, extra_headers=headers)

        # 发送会话配置
        session_update = {
            "event_id": "event_init_001",
            "type": "session.update",
            "session": {
                "modalities": ["text", "audio"],
                "voice": "Ethan",
                "input_audio_format": "pcm",
                "output_audio_format": "pcm",
                "turn_detection": {"type": "server_vad", "threshold": 0.5}
            }
        }
        await self.ws.send(json.dumps(session_update))
        logger.info("Realtime API session updated")

        # 启动监听任务
        self._listen_task = asyncio.create_task(self._listen())

    async def _listen(self):
        """监听百炼返回的事件"""
        async for message in self.ws:
            data = json.loads(message)
            if data.get("type") == "response.audio.delta":
                # 解析 Base64 PCM 音频并推送到队列
                pcm_bytes = base64.b64decode(data["delta"])
                await self.audio_queue.put(pcm_bytes)
            elif data.get("type") == "response.text.delta":
                # 文本增量
                delta = data.get("delta", "")
                await self.text_delta_queue.put(delta)
            elif data.get("type") == "response.done":
                # 响应完成
                await self.audio_queue.put(None)  # 结束标记
                await self.text_delta_queue.put(None)

    async def send_audio(self, pcm_16k_bytes: bytes):
        """发送音频给百炼"""
        if self.ws and self.ws.open:
            event = {
                "type": "input_audio_buffer.append",
                "audio": base64.b64encode(pcm_16k_bytes).decode("utf-8")
            }
            await self.ws.send(json.dumps(event))

    async def receive_audio(self) -> bytes | None:
        """接收百炼返回的音频（16kHz PCM）"""
        return await self.audio_queue.get()

    async def receive_text_delta(self) -> str | None:
        """接收百炼返回的文本增量"""
        return await self.text_delta_queue.get()

    async def close(self):
        """关闭连接"""
        if self._listen_task:
            self._listen_task.cancel()
            try:
                await self._listen_task
            except asyncio.CancelledError:
                pass
        if self.ws:
            await self.ws.close()
```

#### 4. 新增 WebRTC 网关（backend/app/gateway/webrtc_gateway.py）

```python
import asyncio
import json
import logging
from pathlib import Path

import numpy as np
from aiortc import RTCPeerConnection, RTCSessionDescription, MediaStreamTrack
from av import AudioFrame, AudioResampler
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.config import settings
from app.services.realtime_client import RealtimeAPIClient

logger = logging.getLogger(__name__)
router = APIRouter()

# 音频重采样器
resampler_to_16k = AudioResampler(format='s16', layout='mono', rate=16000)
resampler_to_48k = AudioResampler(format='s16', layout='mono', rate=48000)

# 存储活跃的 PeerConnection
pcs = set()


class QwenAudioTrack(MediaStreamTrack):
    """自定义音频轨道，用于发送 AI 音频给前端"""
    kind = "audio"

    def __init__(self):
        super().__init__()
        self.queue = asyncio.Queue()

    async def recv(self):
        """接收从百炼来的音频数据，重采样后发送给前端"""
        pcm_16k_data = await self.queue.get()
        if pcm_16k_data is None:
            # 结束标记
            return None

        # 转换为 AV AudioFrame (16kHz)
        pcm_int16 = np.frombuffer(pcm_16k_data, dtype=np.int16)
        frame_16k = AudioFrame.from_ndarray(
            pcm_int16.reshape(1, -1),
            layout='mono',
            rate=16000
        )

        # 重采样为 48kHz 以适配 WebRTC
        frames_48k = resampler_to_48k.resample(frame_16k)
        return frames_48k[0] if frames_48k else frame_16k


@router.post("/api/webrtc/offer")
async def offer(request: Request):
    """处理 WebRTC SDP offer，返回 answer"""
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

    pc = RTCPeerConnection()
    pcs.add(pc)

    # 初始化发往浏览器的音频轨道和百炼客户端
    qwen_track = QwenAudioTrack()
    qwen_client = RealtimeAPIClient(
        api_key=settings.dashscope_api_key,
        url=settings.dashscope_realtime_url
    )

    # 添加音频轨道到 PeerConnection（发给前端）
    pc.addTrack(qwen_track)

    @pc.on("track")
    def on_track(track):
        if track.kind == "audio":
            logger.info("接收到浏览器麦克风音频流（已 AEC 净化）")

            async def process_audio():
                await qwen_client.connect()  # 连接百炼

                # 启动音频接收任务
                async def relay_audio():
                    while True:
                        pcm_16k = await qwen_client.receive_audio()
                        if pcm_16k is None:
                            break
                        await qwen_track.queue.put(pcm_16k)

                asyncio.create_task(relay_audio())

                while True:
                    try:
                        frame = await track.recv()
                        # 将 48kHz 重采样为 16kHz
                        frames_16k = resampler_to_16k.resample(frame)
                        for f in frames_16k:
                            pcm_bytes = f.to_ndarray().tobytes()
                            await qwen_client.send_audio(pcm_bytes)
                    except Exception as e:
                        logger.error(f"Audio processing error: {e}")
                        break

            asyncio.create_task(process_audio())

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        logger.info(f"Connection state change: {pc.connectionState}")
        if pc.connectionState in ["failed", "closed"]:
            await qwen_client.close()
            pcs.discard(pc)

    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return JSONResponse({
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type
    })


async def on_shutdown(app):
    """应用关闭时清理所有 PeerConnection"""
    coros = [pc.close() for pc in pcs]
    await asyncio.gather(*coros)
    pcs.clear()
```

#### 5. 注册路由（backend/app/main.py）

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat, sessions, translate, users, voice, voice_print, wordbook
from app.gateway import call_ws, stt_ws, webrtc_gateway
from app.config import settings

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
app.include_router(webrtc_gateway.router)  # 新增 WebRTC 路由


@app.on_event("shutdown")
async def shutdown_event():
    await webrtc_gateway.on_shutdown(app)
```

### 前端改造（CallScreen.tsx）

#### 1. 创建 WebRTC 连接

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function CallScreen() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [callDuration, setCallDuration] = useState(0);
  const [userLine, setUserLine] = useState("");
  const [assistantLine, setAssistantLine] = useState("");
  const [subtitleList, setSubtitleList] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subtitleRef = useRef<HTMLDivElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // 字幕区域自动滚动到底部
  useEffect(() => {
    if (subtitleRef.current) {
      subtitleRef.current.scrollTop = subtitleRef.current.scrollHeight;
    }
  }, [subtitleList]);

  useEffect(() => {
    if (!sessionId) {
      setStatus("错误：会话ID为空");
      return;
    }

    const startCall = async () => {
      try {
        // 1. 获取麦克风，强制开启回声消除和降噪
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: { ideal: 48000 }
          },
          video: false
        });

        // 2. 创建 RTCPeerConnection
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        pcRef.current = pc;

        // 3. 将麦克风音频流发送给后端
        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        // 4. 接收后端返回的 AI 音频流并播放
        pc.ontrack = (event) => {
          console.log("[CallScreen] Received remote audio track");
          if (!remoteAudioRef.current) {
            const audio = document.createElement('audio');
            audio.autoplay = true;
            audio.playsInline = true;
            document.body.appendChild(audio);
            remoteAudioRef.current = audio;
          }
          remoteAudioRef.current.srcObject = event.streams[0];
          remoteAudioRef.current.play().catch(e => console.error("Audio play error:", e));
        };

        // 5. 生成 Offer 并发送给 Python 后端
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const response = await fetch('/api/webrtc/offer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sdp: pc.localDescription!.sdp,
            type: pc.localDescription!.type
          })
        });

        if (!response.ok) {
          throw new Error(`SDP exchange failed: ${response.statusText}`);
        }

        const answer = await response.json();
        await pc.setRemoteDescription(new RTCSessionDescription(answer));

        setStatus("通话中 — 请说话");
        
        // 开始计时
        timerRef.current = setInterval(() => {
          setCallDuration((prev) => prev + 1);
        }, 1000);

        console.log("[CallScreen] WebRTC connection established");
      } catch (err) {
        console.error("[CallScreen] Failed to start call:", err);
        setStatus("连接失败");
      }
    };

    startCall();

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.remove();
        remoteAudioRef.current = null;
      }
    };
  }, [sessionId]);

  const hangup = () => {
    const duration = callDuration;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current.remove();
      remoteAudioRef.current = null;
    }
    navigate("/", { state: { callDuration: duration } });
  };

  const isConnected = status.includes("通话中");

  return (
    <div className="h-full flex flex-col bg-[#1a1a1a] text-white select-none">
      {/* 顶部状态 */}
      <div className="pt-12 pb-4 flex flex-col items-center">
        <p className="text-sm text-[#999]">{status}</p>
      </div>

      {/* AI 头像区 */}
      <div className="flex justify-center mt-4 mb-6 relative">
        <div className="w-32 h-32 rounded-full bg-[#07c160] flex items-center justify-center text-6xl relative">
          🤖
          {isConnected && (
            <>
              <span className="absolute inset-0 rounded-full bg-[#07c160] opacity-30 animate-ping" />
              <span className="absolute inset-0 rounded-full bg-[#07c160] opacity-20 animate-pulse" />
            </>
          )}
        </div>
      </div>

      {/* 通话时长 */}
      <div className="text-center mb-8">
        <span className="text-5xl font-light tabular-nums tracking-wider">
          {formatDuration(callDuration)}
        </span>
      </div>

      {/* 实时字幕区 */}
      <div
        ref={subtitleRef}
        className="flex-1 overflow-y-auto px-6 space-y-3 max-h-48 mb-4"
      >
        {subtitleList.map((item, idx) => (
          <div
            key={idx}
            className={`text-sm ${item.role === "user" ? "text-right" : "text-left"}`}
          >
            <span
              className={`inline-block max-w-[80%] rounded-lg px-3 py-2 ${
                item.role === "user"
                  ? "bg-[#07c160] text-white"
                  : "bg-[#2a2a2a] text-[#ccc]"
              }`}
            >
              {item.role === "user" ? "你" : "助手"}：{item.text}
            </span>
          </div>
        ))}
      </div>

      {/* 底部挂断按钮 */}
      <div className="p-8 flex justify-center">
        <button
          type="button"
          onClick={hangup}
          className="w-20 h-20 rounded-full bg-red-500 text-white text-3xl shadow-lg active:scale-95 transition-transform cursor-pointer"
          title="挂断"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
```

## 实现要点

### 性能优化

1. **WebRTC UDP 传输**：比 WebSocket TCP 延迟更低
2. **浏览器原生 AEC**：无需前端手动处理回声
3. **PyAV 重采样**：C 语言底层实现，延迟极低，避免使用 Python for 循环抽点降采样
4. **异步处理**：使用 asyncio 并发处理音频接收和发送

### 错误处理

1. **WebRTC 连接失败降级**：如果 WebRTC 不可用，降级到现有 WebSocket 方案
2. **SDP 交换重试**：添加超时重试逻辑
3. **音频处理异常捕获**：防止单个音频帧处理失败导致整个连接断开

### 安全考虑

1. **API Key 保护**：百炼 API Key 在后端配置，前端不可见
2. **CORS 配置**：确保后端允许前端域名访问 `/api/webrtc/offer`
3. **输入验证**：验证 SDP offer 格式，防止恶意输入

### 生产环境注意事项

1. **AEC 失效的"隐形杀手"**：

- 不要使用耳机：如果用户插了耳机，声音没有经过空气反射，AEC 算法可能会误判环境
- 音量过大：如果前端 `<audio>` 播放音量达到 100% 导致设备扬声器产生物理破音（非线性失真），浏览器的线性 AEC 算法将无法消除这种谐波回声。建议将前端播放音量限制在 70%-80%

2. **网络与 UDP 穿透**：

- WebRTC 依赖 UDP。如果后端部署在阿里云 ECS 等带有安全组的服务器上，必须开放 UDP 端口范围（如 50000-50200）
- 在生产环境中配置 TURN/STUN 服务器，否则在外网环境下会出现"信令连通但无声音"的现象

3. **服务端 VAD 配合**：

- 在 session.update 中开启 server_vad。即使前端 AEC 漏掉了一丝极微弱的"嘶嘶"底噪，百炼服务端的 VAD 也能通过语义和能量阈值将其过滤