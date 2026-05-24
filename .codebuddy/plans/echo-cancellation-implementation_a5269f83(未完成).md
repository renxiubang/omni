---
name: echo-cancellation-implementation
overview: 实现前后端回声消除功能，采用浏览器内置AEC（Acoustic Echo Cancellation）+ 后端音频处理的综合方案，解决对方能听到自己声音回传的问题，并支持根据网络状况动态调整音频参数。
todos:
  - id: frontend-constraints
    content: 创建前端音频约束配置模块 audioConstraints.ts
    status: pending
  - id: frontend-getusermedia
    content: 修改所有 getUserMedia 调用点，启用回声消除
    status: pending
    dependencies:
      - frontend-constraints
  - id: frontend-callscreen
    content: 优化 CallScreen 回声防止机制，移除恢复延迟
    status: pending
    dependencies:
      - frontend-getusermedia
  - id: frontend-network
    content: 实现网络状况监测模块 networkMonitor.ts
    status: pending
  - id: backend-processor
    content: 创建后端音频处理服务 audio_processor.py
    status: pending
  - id: backend-api
    content: 实现后端音频处理端点 audio_process.py
    status: pending
    dependencies:
      - backend-processor
  - id: backend-callws
    content: 修改 call_ws.py，集成服务端音频处理
    status: pending
    dependencies:
      - backend-api
  - id: integration-test
    content: 进行集成测试，验证回声消除效果
    status: pending
    dependencies:
      - frontend-callscreen
      - frontend-network
      - backend-callws
---

## 产品概述

为 Omni 通话系统实现前后端回声消除功能，解决对方能听到自己声音回传的问题。采用浏览器内置回声消除为主、服务端音频处理为辅的方案，并支持根据网络状况动态调整音频参数。

## 核心功能

- **浏览器内置回声消除**：通过 getUserMedia 约束启用 WebRTC 回声消除（AEC）、降噪（NS）和自动增益控制（AGC）
- **服务端音频处理**：使用 ffmpeg 对接收到的音频流进行后处理，进一步消除残留回声
- **通话期间回声防止优化**：优化 CallScreen 的麦克风禁用/启用机制，减少延迟
- **动态音频参数调整**：根据网络延迟和丢包率动态调整音频采样率和比特率
- **多场景支持**：为所有音频录入场景（通话、语音消息、声纹录入）添加回声消除

## 技术栈选择

- **前端音频采集**：WebRTC MediaStreamConstraints API（浏览器内置 AEC/NS/AGC）
- **前端音频处理**：Web Audio API（可选，用于进一步音频增强）
- **后端音频处理**：ffmpeg（已有依赖，用于音频格式转换和后处理）
- **后端音频流处理**：Python asyncio + WebSocket（实时音频流处理）
- **网络状况监测**：WebRTC Statistics API（获取延迟、丢包率等指标）

## 实现方案

### 前端实现

#### 1. 创建统一的音频约束配置

创建 `frontend/src/audio/audioConstraints.ts` 模块，定义标准化的音频约束配置：

```typescript
export const AUDIO_CONSTRAINTS = {
  audio: {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
    sampleRate: { ideal: 16000 },
    channelCount: { ideal: 1 },
  }
};
```

#### 2. 修改所有 getUserMedia 调用点

需要修改以下 4 个文件中的 getUserMedia 调用：

- `frontend/src/pages/ChatPage.tsx` (第 601 行)
- `frontend/src/components/CallScreen.tsx` (第 244 行)
- `frontend/src/components/Composer.tsx` (第 73 行)
- `frontend/src/hooks/useVoicePrint.ts` (第 43 行)

将所有 `{ audio: true }` 替换为 `AUDIO_CONSTRAINTS`。

#### 3. 优化 CallScreen 回声防止机制

当前问题：AI 播放音频时禁用麦克风，但恢复时有 500ms 延迟，可能导致尾部回声。

优化方案：

- 在 `onPlaybackStart` 时立即禁用麦克风
- 在 `onPlaybackEnd` 时立即启用麦克风（移除 500ms 延迟）
- 添加 `playbackActive` 状态标志，在 MediaRecorder 的 `ondataavailable` 中检查，如果正在播放则丢弃音频数据

#### 4. 实现动态音频参数调整

创建 `frontend/src/audio/networkMonitor.ts` 模块：

- 使用 WebRTC Statistics API 监测网络状况（延迟、丢包率）
- 根据网络状况动态调整音频参数：
- 高延迟/高丢包：降低采样率到 8000Hz，减少比特率
- 低延迟/低丢包：保持 16000Hz 采样率
- 通过 WebSocket 通知后端调整音频处理参数

### 后端实现

#### 1. 添加音频处理端点

创建 `backend/app/api/audio_process.py` 模块：

- `POST /api/audio/process`：接收音频数据，使用 ffmpeg 进行后处理（降噪、回声消除）
- 支持多种音频处理算法（可配置）
- 返回处理后的音频数据

#### 2. 修改 call_ws.py 音频处理流程

在 `handle_utterance` 函数中添加音频处理步骤：

- 接收音频数据后，可选地进行服务端回声消除处理
- 使用 ffmpeg 的音频过滤器（如 `afftdn` 降噪、`anlmdn` 降噪等）
- 处理后的音频再发送给 Omni 客户端

#### 3. 实现网络状况自适应

在 `call_ws.py` 中添加网络状况监测：

- 接收前端发送的网络状况数据（延迟、丢包率）
- 根据网络状况调整音频处理参数
- 动态调整音频采样率和比特率

## 实现要点

### 前端修改

1. **创建音频约束配置模块**：统一管理所有音频采集参数
2. **修改 4 个 getUserMedia 调用点**：启用回声消除、降噪、自动增益控制
3. **优化 CallScreen 回声防止**：移除恢复延迟，添加播放状态检查
4. **实现网络监测模块**：使用 WebRTC Statistics API 获取网络指标

### 后端修改

1. **创建音频处理模块**：使用 ffmpeg 进行服务端音频后处理
2. **修改 call_ws.py**：在音频处理流程中添加服务端回声消除选项
3. **实现网络自适应**：根据前端报告的网络状况调整音频参数

## 目录结构

```
前端修改/新增文件：
frontend/src/
├── audio/
│   ├── audioConstraints.ts      [NEW] 音频约束配置
│   ├── networkMonitor.ts        [NEW] 网络状况监测
│   └── pcmPlayer.ts           [MODIFY] 优化播放回调
├── pages/
│   └── ChatPage.tsx           [MODIFY] 修改 getUserMedia 调用
├── components/
│   ├── CallScreen.tsx         [MODIFY] 优化回声防止机制
│   └── Composer.tsx           [MODIFY] 修改 getUserMedia 调用
└── hooks/
    └── useVoicePrint.ts       [MODIFY] 修改 getUserMedia 调用

后端修改/新增文件：
backend/app/
├── api/
│   └── audio_process.py      [NEW] 音频处理端点
├── services/
│   └── audio_processor.py    [NEW] 音频处理服务
└── gateway/
    └── call_ws.py            [MODIFY] 添加音频处理步骤
```

## 关键代码结构

### 前端音频约束配置

```typescript
// frontend/src/audio/audioConstraints.ts
export const AUDIO_CONSTRAINTS = {
  audio: {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
    sampleRate: { ideal: 16000 },
    channelCount: { ideal: 1 },
  }
};

export async function getAudioStream() {
  try {
    return await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
  } catch (error) {
    console.error('Failed to get audio stream:', error);
    // 降级方案：使用基本音频约束
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  }
}
```

### 后端音频处理服务

```python
# backend/app/services/audio_processor.py
import subprocess
from pathlib import Path

class AudioProcessor:
    """音频处理器，使用 ffmpeg 进行音频后处理"""
    
    @staticmethod
    def remove_echo(input_path: str, output_path: str) -> bool:
        """使用 ffmpeg 过滤器消除回声"""
        cmd = [
            "ffmpeg", "-y",
            "-i", input_path,
            "-af", "afftdn=nf=-25",  # 降噪
            "-ar", "16000",
            "-ac", "1",
            output_path
        ]
        try:
            subprocess.run(cmd, capture_output=True, check=True, timeout=10)
            return True
        except Exception as e:
            print(f"Audio processing failed: {e}")
            return False
```

## 性能优化

### 前端优化

1. **音频约束降级**：如果浏览器不支持某些高级约束，自动降级到基本配置
2. **网络监测节流**：限制网络状况报告的频率（每秒最多 1 次）
3. **音频数据处理优化**：使用 Web Audio API 的 `ScriptProcessorNode` 或 `AudioWorklet` 进行实时音频处理

### 后端优化

1. **音频处理异步化**：使用 `asyncio.to_thread` 将 ffmpeg 处理放到后台线程
2. **音频处理可选**：通过配置开关控制是否启用服务端音频处理
3. **缓存处理结果**：对相同的音频处理参数进行缓存，避免重复处理

## 测试策略

### 前端测试

1. **单元测试**：测试音频约束配置、网络监测模块
2. **集成测试**：测试 getUserMedia 调用、回声防止机制
3. **手动测试**：在实际通话场景中测试回声消除效果

### 后端测试

1. **单元测试**：测试音频处理服务、网络自适应逻辑
2. **集成测试**：测试音频处理端点、call_ws.py 集成
3. **性能测试**：测试音频处理延迟、并发处理能力

## Agent Extensions

### Skill

- **playwright-cli**
- Purpose: 自动化浏览器测试，验证回声消除功能在不同浏览器中的表现
- Expected outcome: 生成跨浏览器兼容性测试报告，确保回声消除功能在 Chrome、Firefox、Safari 中正常工作

### SubAgent

- **code-explorer**
- Purpose: 深入探索代码库，查找所有需要修改的 getUserMedia 调用点，并分析现有音频处理流程
- Expected outcome: 提供完整的修改清单和代码修改建议，确保所有音频采集点都启用了回声消除