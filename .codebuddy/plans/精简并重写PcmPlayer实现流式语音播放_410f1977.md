---
name: 精简并重写PcmPlayer实现流式语音播放
overview: 重写前端 PcmPlayer 类，修复音频输出问题，实现真正的流式播放，同时保留回放功能。主要修复 Uint8Array.buffer 处理错误和采样率不匹配问题。
todos:
  - id: fix-arraybuffer-conversion
    content: 修复 PcmPlayer 的 ArrayBuffer 转换 bug（Uint8Array/Int16Array）
    status: completed
  - id: fix-sample-rate
    content: 修复采样率不匹配问题，确保使用正确的采样率初始化 AudioContext
    status: completed
    dependencies:
      - fix-arraybuffer-conversion
  - id: simplify-pcm-player
    content: 精简 PcmPlayer 类，移除 nextTime 手动调度和 onIdle 回调，简化播放逻辑
    status: completed
    dependencies:
      - fix-sample-rate
  - id: update-chatpage
    content: 更新 ChatPage.tsx 适配新的 PcmPlayer API，使用 waitForFinish 等待播放完成
    status: completed
    dependencies:
      - simplify-pcm-player
  - id: update-callscreen
    content: 更新 CallScreen.tsx 适配新的 PcmPlayer API（如有使用）
    status: completed
    dependencies:
      - simplify-pcm-player
  - id: test-streaming-playback
    content: 测试验证流式播放功能（文本输入、语音输入场景）
    status: completed
    dependencies:
      - update-chatpage
      - update-callscreen
  - id: test-playback-feature
    content: 测试验证语音回放功能（WAV 回放）
    status: completed
    dependencies:
      - test-streaming-playback
---

## 产品概述

修复智能体实时回复时的流式语音播放功能，解决当前"完全没有音频输出"的问题，并实现智能体回复时立即开始流式播放音频。

## 核心功能

- 修复导致无声的两个严重 bug（ArrayBuffer 转换错误、采样率不匹配）
- 实现智能体回复时的流式语音播放（边生成边播放）
- 精简 PcmPlayer 代码，移除复杂的手动调度逻辑
- 保留语音回放功能（将流式音频保存为 WAV 供后续点击播放）

## 技术栈

- 前端框架：React + TypeScript
- 音频处理：Web Audio API（AudioContext、AudioBufferSourceNode）
- 数据转换：Base64 解码、PCM16 转 Float32

## 实现方案

### 问题分析

通过代码分析，发现 PcmPlayer 存在两个严重 bug 导致完全没有音频输出：

**Bug 1: Uint8Array/Int16Array 转换错误**（pcmPlayer.ts 第 64-66 行）

```typescript
// 错误写法
const bytes = new Uint8Array(raw.length);
for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
const samples = new Int16Array(bytes.buffer); // ❌ 错误
```

**问题**：`bytes.buffer` 指向整个底层 ArrayBuffer，但 `byteOffset` 可能不为 0，且 `byteLength` 可能大于 `bytes.length`。直接使用会导致读取错误数据。

**修复方案**：

```typescript
const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
```

**Bug 2: 采样率不匹配**

- `prepare()` 默认使用 16000Hz
- 但后端配置 `output_sample_rate: 24000`
- 导致音频播放速度不正确或无声

**修复方案**：

- 确保 `prepare()` 使用后端返回的正确采样率
- 在 `enqueuePcm16Base64` 中检测采样率变化并重新创建 AudioContext

### 精简设计

1. **移除复杂的 `nextTime` 手动调度逻辑**

- 原实现手动计算 `nextTime` 来调度多个 AudioBufferSourceNode
- 容易出错，且 Web Audio API 会自动混合同时播放的音频
- 改为直接使用 `source.start(0)` 立即播放

2. **移除 `playingSources` 计数器和 `onIdle` 回调**

- 简化状态管理
- 使用 Promise-based 的 `waitForFinish()` 方法替代

3. **简化播放逻辑**

- 每个音频块创建一个 AudioBufferSourceNode 并立即调度
- Web Audio API 会自动处理音频混合和时间对齐

### 实施说明

1. **修复 ArrayBuffer 转换**：修改 `enqueuePcm16Base64` 方法中的 Int16Array 构造方式
2. **修复采样率处理**：在 `prepare()` 和 `enqueuePcm16Base64` 中正确处理采样率
3. **精简 PcmPlayer 类**：移除 `nextTime`、`playingSources`、`onIdle`，简化播放逻辑
4. **更新 ChatPage.tsx**：适配新的 PcmPlayer API，使用 `waitForFinish()` 等待播放完成
5. **保留回放功能**：`assistantAudioChunksRef` 和 `voiceAudioUrls` 逻辑不变

### 架构设计

```
后端 DashScope API
    ↓ 流式返回音频数据（SSE）
前端 ChatPage.tsx (handleSse)
    ↓ 接收 assistant_audio 事件
PcmPlayer.enqueuePcm16Base64()
    ↓ Base64 解码 → PCM16 转 Float32 → 创建 AudioBuffer
Web Audio API (AudioContext.destination)
    ↓ 扬声器输出
```

## 目录结构

```
/Users/renxiansheng/Project/omni/frontend/src/
├── audio/
│   └── pcmPlayer.ts          [MODIFY] 修复 bug 并精简播放逻辑
├── pages/
│   └── ChatPage.tsx          [MODIFY] 适配新的 PcmPlayer API
└── components/
    └── CallScreen.tsx        [MODIFY] 适配新的 PcmPlayer API（如有使用）
```