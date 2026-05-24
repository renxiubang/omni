---
name: WebRTC 接入回声消除改造
overview: 将前端从 WebSocket 音频传输改为 WebRTC 接入 DashScope Realtime API，利用浏览器原生 AEC 消除回声。后端新增 WebRTC SDP 代理端点，前端通过 RTCPeerConnection 直接对接 DashScope，音频轨道自动启用药回声消除。
todos:
  - id: apply-whitelist
    content: 申请 DashScope WebRTC 白名单，获取专属 Endpoint
    status: pending
  - id: backend-sdp-proxy
    content: 创建后端 SDP 代理端点 /api/webrtc/sdp
    status: pending
    dependencies:
      - apply-whitelist
  - id: backend-config
    content: 修改后端配置，添加 dashscope_webrtc_endpoint
    status: pending
    dependencies:
      - backend-sdp-proxy
  - id: frontend-webrtc
    content: 修改 CallScreen.tsx，改为 WebRTC 接入
    status: pending
    dependencies:
      - backend-sdp-proxy
  - id: frontend-datachannel
    content: 实现 DataChannel 事件处理和消息保存
    status: pending
    dependencies:
      - frontend-webrtc
  - id: frontend-audio-track
    content: 实现 ontrack 音频接收和播放
    status: pending
    dependencies:
      - frontend-webrtc
  - id: test-webrtc
    content: 集成测试：验证 WebRTC 连接、音频传输、回声消除效果
    status: pending
    dependencies:
      - frontend-datachannel
      - frontend-audio-track
---

## 用户需求

将现有 Omni 通话系统从 WebSocket + HTTP streaming 架构改为 WebRTC 接入，根治智能体播放声音被麦克风捕获的回声问题。

## 核心功能

1. **WebRTC 接入 DashScope Realtime API**：前端通过 RTCPeerConnection 直接连接 DashScope，音频通过 RTP 轨道传输
2. **浏览器原生 AEC 自动生效**：音频通过 WebRTC 媒体管道播放，浏览器自动消除回声
3. **后端 SDP 代理**：新增 `/api/webrtc/sdp` 端点，解决浏览器跨域问题
4. **服务端 VAD**：WebRTC 模式仅支持服务端 VAD（server_vad 或 semantic_vad）
5. **DataChannel 事件接收**：通过 DataChannel 接收文本/事件推送
6. **会话管理保持**：后端仍管理 session_store，但音频不再经后端中转

## 功能边界

- 音频输入：通过 WebRTC 音频轨道自动传输到 DashScope
- 音频输出：通过 ontrack 事件接收并播放（浏览器 AEC 自动生效）
- 文本接收：通过 DataChannel 接收，前端发送到后端保存
- VAD 模式：仅支持服务端 VAD，不支持手动控制

## 技术栈选择

- **前端**：WebRTC API（RTCPeerConnection、DataChannel、MediaStream）
- **后端**：FastAPI + httpx（SDP 代理转发）
- **DashScope API**：Qwen-Omni Realtime（WebRTC 模式，需白名单）

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
前端 ←→ DashScope Realtime API (WebRTC)
  ↓                                           ↓
  ├─ 音频轨道 (RTP) ─────────────→ 发送用户语音
  ├─ 音频轨道 (RTP) ←───────────── 接收智能体语音 (AEC 自动生效)
  └─ DataChannel ←────────────────── 接收文本/事件
  
后端 (仅管理会话/历史，不中转音频)
  ↓
  /api/webrtc/sdp (SDP 代理，解决跨域)
```

### 前端改造（CallScreen.tsx）

#### 1. 创建 WebRTC 连接

```typescript
const pcRef = useRef<RTCPeerConnection | null>(null);
const dataChannelRef = useRef<RTCDataChannel | null>(null);

async function initWebRTC() {
  // 1. 创建 RTCPeerConnection (无需 STUN/TURN)
  const pc = new RTCPeerConnection({ iceServers: [] });
  pcRef.current = pc;
  
  // 2. 采集麦克风音频 (启用 AEC)
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
      sampleRate: { ideal: 48000 }
    }
  });
  stream.getAudioTracks().forEach(track => pc.addTrack(track, stream));
  
  // 3. 创建 DataChannel
  const dc = pc.createDataChannel('oai-events');
  dataChannelRef.current = dc;
  
  // 4. 配置会话参数
  dc.onopen = () => {
    dc.send(JSON.stringify({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        voice: settings.omni_voice,
        turn_detection: {
          type: 'semantic_vad',
          threshold: 0.5,
          silence_duration_ms: 800
        },
        instructions: systemPrompt
      }
    }));
  };
  
  // 5. 接收服务端事件
  dc.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleServerEvent(msg);
  };
  
  // 6. 接收服务端音频轨道 (AEC 自动生效)
  pc.ontrack = (event) => {
    const audioElement = document.createElement('audio');
    audioElement.srcObject = event.streams[0];
    audioElement.autoplay = true;
    document.body.appendChild(audioElement);
  };
  
  // 7. SDP 信令交换
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  
  // 等待 ICE 收集完成
  await waitForIceGatheringComplete(pc);
  
  // 8. 发送到后端代理
  const response = await fetch(`/api/webrtc/sdp?model=${model}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: pc.localDescription!.sdp
  });
  
  if (!response.ok) throw new Error('SDP exchange failed');
  
  const answerSdp = await response.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  
  console.log('WebRTC connection established');
}
```

#### 2. 处理服务端事件

```typescript
function handleServerEvent(event: any) {
  switch (event.type) {
    case 'response.text.delta':
      // 接收文本增量
      setAssistantLine(prev => prev + event.delta);
      break;
      
    case 'response.audio.delta':
      // 音频通过 ontrack 自动播放，无需处理
      break;
      
    case 'response.done':
      // 响应完成，保存消息到后端
      saveMessageToBackend();
      break;
  }
}
```

### 后端改造

#### 1. 新增 SDP 代理端点（backend/app/api/webrtc.py）

```python
import logging

import httpx
from fastapi import APIRouter, Query, Request, Response

from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

WEBRTC_ENDPOINT = settings.dashscope_webrtc_endpoint  # 白名单获取的专属地址

@router.post("/api/webrtc/sdp")
async def webrtc_sdp_exchange(
    request: Request,
    model: str = Query("qwen3.5-omni-flash-realtime")
):
    """代理 SDP 信令交换，解决浏览器跨域问题"""
    offer_sdp = await request.body()
    
    if not WEBRTC_ENDPOINT:
        return Response(
            content='{"error": "WebRTC endpoint not configured. Please apply for whitelist."},
            status_code=400,
            media_type="application/json"
        )
    
    url = f"https://{WEBRTC_ENDPOINT}/api/v1/webrtc/realtime?model={model}"
    headers = {
        "Content-Type": "application/sdp",
        "Authorization": f"Bearer {settings.dashscope_api_key}"
    }
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, content=offer_sdp, headers=headers)
            
        if response.status_code != 200:
            logger.error(f"SDP exchange failed: {response.status_code} {response.text}")
            return Response(
                content=response.text,
                status_code=response.status_code,
                media_type="application/json"
            )
            
        answer_sdp = response.text
        return Response(content=answer_sdp, media_type="application/sdp")
        
    except Exception as e:
        logger.exception("SDP exchange error")
        return Response(
            content=f'{{"error": "{str(e)}"}}',
            status_code=500,
            media_type="application/json"
        )
```

#### 2. 修改配置（backend/app/config.py）

```python
class Settings(BaseSettings):
    # ... 现有配置
    
    # WebRTC 专属 Endpoint (白名单获取)
    dashscope_webrtc_endpoint: str = ""  # 例如: "your-endpoint.realtime.aliyuncs.com"
```

#### 3. 注册路由（backend/app/main.py）

```python
from app.api import webrtc

app.include_router(webrtc.router)
```

### 会话管理调整

**变化**：

- 音频不再经后端中转
- 前端通过 DataChannel 接收文本
- 前端将文本发送到后端保存

**实现**：

```typescript
// 前端：接收文本后保存到后端
async function saveMessageToBackend(role: string, content: string) {
  await fetch(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, content })
  });
}
```

## 实现要点

### 性能优化

1. **WebRTC UDP 传输**：比 WebSocket TCP 延迟更低
2. **浏览器原生 AEC**：无需前端手动处理回声
3. **异步 SDP 交换**：使用 httpx.AsyncClient，不阻塞事件循环

### 错误处理

1. **WebRTC 连接失败降级**：如果 WebRTC 不可用，降级到现有 WebSocket 方案
2. **SDP 交换重试**：添加超时重试逻辑
3. **DataChannel 断开重连**：监听 onerror/onclose 事件

### 安全考虑

1. **API Key 保护**：SDP 代理在后端的 Authorization header 中添加 API Key，前端不可见
2. **CORS 配置**：确保后端允许前端域名访问 `/api/webrtc/sdp`
3. **输入验证**：验证 SDP offer 格式，防止恶意输入

## 目录结构

```
前端修改文件：
frontend/src/components/
└── CallScreen.tsx            [MODIFY] 改为 WebRTC 接入，移除 WebSocket

后端修改/新增文件：
backend/app/
├── api/
│   └── webrtc.py             [NEW] SDP 代理端点
├── config.py                 [MODIFY] 新增 dashscope_webrtc_endpoint 配置
└── main.py                  [MODIFY] 注册 webrtc 路由
```

## 关键代码结构

### 等待 ICE 收集完成

```typescript
function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
      }
    };
  });
}
```

## Agent Extensions

### Skill

- **playwright-cli**
- Purpose: 自动化测试 WebRTC 接入功能，验证回声消除效果
- Expected outcome: 生成测试报告，验证浏览器原生 AEC 是否自动消除回声

### SubAgent

- **code-explorer**
- Purpose: 探索 CallScreen.tsx 中所有 WebSocket 相关代码，确保完整迁移到 WebRTC
- Expected outcome: 提供完整的修改清单，确保所有 WebSocket 逻辑都被正确替换