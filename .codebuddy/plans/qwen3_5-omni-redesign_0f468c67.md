---
name: qwen3.5-omni-redesign
overview: 根据 Qwen3.5-Omni-Realtime 文档重新设计实时语音对话系统，主要改进：1) 更新到最新 API 格式和模型 2) 支持语义 VAD 3) 优化音频流处理架构 4) 支持新特性（联网搜索、工具调用等）
design:
  architecture:
    framework: react
    component: shadcn
  styleKeywords:
    - Glassmorphism
    - Dark Mode
    - Audio Visualization
    - Real-time Subtitle
    - Smooth Animation
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 24px
      weight: 600
    subheading:
      size: 18px
      weight: 500
    body:
      size: 16px
      weight: 400
  colorSystem:
    primary:
      - "#07c160"
      - "#10b981"
      - "#3b82f6"
    background:
      - "#0a0a0a"
      - "#1a1a2e"
      - rgba(255,255,255,0.1)
    text:
      - "#ffffff"
      - "#999999"
      - "#07c160"
    functional:
      - "#ef4444"
      - "#10b981"
      - "#f59e0b"
todos:
  - id: update-vad-type
    content: 修改 realtime_client.py：将 VAD 类型从 server_vad 改为 semantic_vad，添加 silence_duration_ms 参数
    status: completed
  - id: fix-mic-samplerate
    content: 修改 CallScreenWebRTC.tsx：将麦克风采样率从 48000 改为 16000，与文档要求一致
    status: completed
  - id: add-subtitle-handling
    content: 修改 realtime_client.py：添加 response.audio_transcript.delta 事件处理，转发字幕给前端
    status: completed
    dependencies:
      - update-vad-type
  - id: display-subtitles
    content: 修改 CallScreenWebRTC.tsx：添加实时字幕显示区域，展示用户和 AI 的对话内容
    status: completed
    dependencies:
      - add-subtitle-handling
  - id: optimize-audio-buffer
    content: 优化 webrtc_gateway.py：调整 RESPONDING_TIMEOUT，增加 buffer 大小，减少静音帧
    status: completed
  - id: add-volume-control
    content: 修改 CallScreenWebRTC.tsx：添加音量控制滑块和静音按钮
    status: completed
    dependencies:
      - display-subtitles
  - id: test-and-debug
    content: 测试实时语音对话功能，调试音频颤抖和字幕显示问题
    status: completed
    dependencies:
      - optimize-audio-buffer
      - add-volume-control
---

## 需求描述

根据 Qwen3.5-Omni-Realtime 文档重新设计实时语音对话系统，主要目标：

1. **更新 VAD 类型**：从 `server_vad` 改为文档推荐的 `semantic_vad`，以支持语义打断功能
2. **修复音频采样率**：前端麦克风输入从 48kHz 改为 16kHz，与文档要求一致
3. **添加实时字幕显示**：处理 `response.audio_transcript.delta` 事件，实现流式字幕
4. **支持新特性**：

- 联网搜索（WebSearch）功能
- 工具调用（Function Calling）支持
- 语音控制（语速、音量、情绪）

5. **优化音频流处理**：改进音频颤抖和静音问题
6. **改进错误处理和重连机制**：增强系统稳定性

## 产品概述

重新设计的实时语音对话系统将基于 Qwen3.5-Omni-Realtime 模型，提供更智能、更稳定的语音对话体验。新系统将支持语义 VAD（自动识别对话意图，避免误触发打断）、实时字幕显示、联网搜索和工具调用等高级功能。

## 核心功能

- 语义 VAD 检测（semantic_vad）
- 实时字幕显示（audio_transcript.delta）
- 语音控制（语速、音量、情绪）
- 联网搜索集成
- 工具调用支持
- 优化音频流处理（解决颤抖和静音问题）

## 技术栈

- **后端框架**: FastAPI (Python)
- **WebSocket 客户端**: websockets 库
- **WebRTC**: aiortc
- **音频处理**: numpy, PyAV (av)
- **前端**: React + TypeScript + Tailwind CSS
- **WebRTC API**: 浏览器原生 WebRTC API

## 实现方案

### 1. 更新 VAD 类型

**问题**: 当前使用 `server_vad`，文档推荐使用 `semantic_vad`

**方案**: 修改 `realtime_client.py` 中的 `session.update` 事件

```python
# 修改前
"turn_detection": {"type": "server_vad", "threshold": 0.5}

# 修改后
"turn_detection": {
    "type": "semantic_vad",
    "threshold": 0.5,
    "silence_duration_ms": 800
}
```

**优势**:

- 语义 VAD 能自动识别对话意图，避免附和声和无意义背景音触发打断
- 提高对话自然度和用户体验

### 2. 修复前端麦克风采样率

**问题**: 前端 `CallScreenWebRTC.tsx` 中麦克风采样率设置为 48000，但文档要求输入为 16kHz

**方案**: 修改 `getUserMedia` 参数

```typescript
// 修改前
sampleRate: { ideal: 48000 }

// 修改后
sampleRate: { ideal: 16000 }
```

**注意**: 后端 `webrtc_gateway.py` 中的 `mic_resampler` 已经是正确的（48kHz → 16kHz），但前端直接发送 48kHz 会导致重采样质量下降。修改为 16kHz 后，后端重采样器可以移除或调整为直通模式。

### 3. 添加实时字幕显示

**问题**: 当前没有处理 `response.audio_transcript.delta` 事件，无法显示实时字幕

**方案**:

1. 后端 `realtime_client.py` 中处理 `response.audio_transcript.delta` 事件
2. 通过 WebSocket 或 DataChannel 发送字幕给前端
3. 前端 `CallScreenWebRTC.tsx` 中显示实时字幕

**实现细节**:

- 后端：将 `response.audio_transcript.delta` 事件转发到前端
- 前端：创建字幕显示区域，实时更新

### 4. 支持语音控制

**问题**: 没有实现语音控制功能（语速、音量、情绪）

**方案**: 在前端添加语音控制 UI，通过发送特定指令实现：

- "语速快一些" → 模型自动识别并调整
- "声音大一些" → 模型自动识别并调整
- "用开心的语气" → 模型自动调整情绪

这些是 Qwen3.5-Omni 的内置功能，无需后端特殊处理，只需确保前端音频播放器支持音量控制。

### 5. 优化音频流处理

**问题**: 从之前的对话看，音频存在颤抖和静音问题

**方案**: 当前 `webrtc_gateway.py` 中已经实现了 IDLE/RESPONDING 状态机，但可能需要进一步优化：

- 调整 `RESPONDING_TIMEOUT`  from 50ms to 100ms
- 增加 buffer 大小，减少静音帧
- 确保 `_buffer_ready` 事件正确触发

### 6. 架构设计

```
┌─────────────┐     WebSocket      ┌─────────────┐     WebRTC      ┌─────────────┐
│   前端       │ ───────────────→ │   后端       │ ───────────────→ │  百炼 API   │
│  (浏览器)   │ ←─────────────── │  (FastAPI)  │ ←──────────────  │  (Qwen3.5) │
└─────────────┘     DataChannel   └─────────────┘     WebSocket   └─────────────┘
      │                            │                            │
      │ 麦克风音频                 │ 音频流处理                 │  AI 响应
      │ (16kHz PCM)              │ (重采样、缓冲)             │  (24kHz PCM)
      └──────────────────────────┘                            │
                                                  字幕、文本响应
```

## 目录结构

### 修改文件

```
backend/app/
├── gateway/
│   └── webrtc_gateway.py      # [MODIFY] 优化音频流处理，修复采样率
├── services/
│   └── realtime_client.py     # [MODIFY] 更新 VAD 类型，添加字幕事件处理
└── config.py                   # [MODIFY] 添加新配置项（联网搜索、工具调用）

frontend/src/
└── components/
    └── CallScreenWebRTC.tsx    # [MODIFY] 修复麦克风采样率，添加字幕显示
```

## 关键代码结构

### realtime_client.py 修改

```python
# session.update 事件配置
session_update = {
    "event_id": "event_init_001",
    "type": "session.update",
    "session": {
        "modalities": ["text", "audio"],
        "voice": voice,
        "input_audio_format": "pcm",
        "output_audio_format": "pcm",
        "turn_detection": {
            "type": "semantic_vad",  # 改为 semantic_vad
            "threshold": 0.5,
            "silence_duration_ms": 800
        },
        "instructions": system_prompt,
        # 可选：启用联网搜索
        # "tools": [{"type": "web_search"}]
    }
}
```

### webrtc_gateway.py 修改

```python
# 前端麦克风采样率改为 16kHz，移除重采样器
# 修改前：mic_resampler = AudioResampler(format='s16', layout='mono', rate=16000)
# 修改后：如果前端已经是 16kHz，可以直接发送，无需重采样
```

## 设计风格

采用 **Glassmorphism** 设计风格，结合现代、科技感的视觉元素，打造沉浸式语音对话体验。

### 设计要点

1. **背景**: 深色渐变背景（#0a0a0a → #1a1a2e），配合模糊效果
2. **字幕区域**: 半透明玻璃效果面板，实时显示对话内容
3. **音频可视化**: 添加音频波形动画，增强交互体验
4. **状态指示**: 清晰的连接状态、语音活动状态指示
5. **响应式布局**: 适配桌面和移动设备

### 页面布局

#### CallScreenWebRTC 页面

1. **顶部状态栏**

- 连接状态指示（连接中/通话中/断开）
- 通话时长显示
- 网络质量指示

2. **AI 头像区**

- 动态脉冲动画（通话中时）
- 语音活动可视化（波形效果）

3. **实时字幕区**（新增）

- 半透明玻璃面板
- 用户和 AI 对话分批显示
- 流式更新效果
- 自动滚动到底部

4. **控制区**

- 挂断按钮（红色圆形按钮）
- 音量控制滑块（新增）
- 静音按钮（新增）

### 交互设计

- **字幕显示**: 实时流式显示，AI 回复时逐字出现
- **语音活动指示**: AI 说话时头像区域显示波形动画
- **平滑过渡**: 状态变化时使用 CSS 过渡动画

## Agent Extensions

无可用扩展。