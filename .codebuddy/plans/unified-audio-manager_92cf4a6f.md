---
name: unified-audio-manager
overview: 创建统一的 AudioManager 类，封装 PcmPlayer（流式播放）和 HTMLAudioElement（回放），保证任意时刻只有一路音频在播放，并修改 CallScreen.tsx 和 ChatPage.tsx 使用新的统一接口。
todos:
  - id: create-audio-manager
    content: 创建 frontend/src/audio/AudioManager.ts，实现统一音频管理器，内部封装 PcmPlayer 和 HTMLAudioElement，提供 prepare/enqueuePcm16Base64/playPlayback/stopAll/mute/unmute/setPlaybackRate/waitForFinish 等接口，保证任意播放开始时自动停止其他音频
    status: completed
  - id: refactor-call-screen
    content: 修改 CallScreen.tsx，将所有 playerRef.current 调用替换为 AudioManager.getInstance()，将 setupPlayerCallbacks 改为设置 AudioManager.onPlaybackStart/End 回调，移除 playerRef 和相关新建 PcmPlayer 的逻辑
    status: completed
    dependencies:
      - create-audio-manager
  - id: refactor-chat-page
    content: "修改 ChatPage.tsx，将 playerRef.current 和 activeAudioRef.current 统一替换为 AudioManager.getInstance()，重构 handlePlayVoice 三个场景（A: 静音流式/B: 播放收集数据/C: WAV回放）使用 AudioManager 接口，移除 playerRef/activeAudioRef/voiceAudioUrls/tempWavUrlRef 等分散状态"
    status: completed
    dependencies:
      - create-audio-manager
  - id: verify-build
    content: 验证前端构建通过，检查所有音频播放场景（通话流式播放、聊天流式播放、聊天回放、语速设置、静音恢复）功能正常
    status: completed
    dependencies:
      - refactor-call-screen
      - refactor-chat-page
---

## 产品概述

统一前端音频播放管理接口，将当前分散在两处的独立播放器（`PcmPlayer` 流式播放 和 `HTMLAudioElement` 回放音频）整合为一个统一的 `AudioManager` 单例管理器，从架构层面保证任意时刻只有一路音频在播放。

## 核心功能

1. **统一音频管理接口**：创建 `AudioManager` 类，内部封装 `PcmPlayer`（流式播放）和 `HTMLAudioElement`（回放音频）
2. **自动互斥机制**：任意播放开始时自动停止其他正在播放的音频（流式播放开始时停止回放，回放开始时停止流式播放）
3. **保留现有功能**：保留 `prepare`、`enqueuePcm16Base64`、`setPlaybackRate`、`mute`/`unmute`、`waitForFinish`、`onPlaybackStart`/`onPlaybackEnd` 回调等全部现有接口
4. **重构调用方**：修改 `CallScreen.tsx` 和 `ChatPage.tsx`，将 `playerRef.current` 和 `activeAudioRef.current` 统一替换为 `AudioManager.getInstance()`

## 技术栈

- 语言：TypeScript
- 运行时：浏览器 Web Audio API + HTMLAudioElement
- 架构模式：单例模式（Singleton）+ 外观模式（Facade）

## 实现方案

### 核心设计：`AudioManager` 统一音频管理器

`AudioManager` 作为统一门面，内部维护两个播放子系统：

- **流式播放子系统**：内部持有 `PcmPlayer` 实例，负责 `assistant_audio` 的实时流式播放
- **回放音频子系统**：内部持有 `HTMLAudioElement | null`，负责已生成 WAV 的点击回放

**互斥保证**：

- `enqueuePcm16Base64()` 被调用时 → 内部先调用 `stopPlayback()` 停止回放
- `playPlayback()` 被调用时 → 内部先调用 `stopStreaming()` 停止流式播放
- 任意时刻保证只有一路音频输出

### 架构设计

```
┌──────────────────────────────────────────────────────┐
│                    AudioManager                     │
│                                                      │
│  private static instance: AudioManager | null       │
│  private pcmPlayer: PcmPlayer                    │
│  private playbackAudio: HTMLAudioElement | null    │
│                                                      │
│  // 对外统一接口                                   │
│  static getInstance(): AudioManager                │
│  static releaseInstance(): void                  │
│  async prepare(sampleRate?): Promise<void>       │
│  async enqueuePcm16Base64(b64, sr?): P<v>   │
│  playPlayback(url, onEnd?): void               │
│  stopAll(): void                               │
│  stopStreaming(): void                          │
│  stopPlayback(): void                          │
│  mute(): void                                  │
│  unmute(): void                                │
│  isMuted(): boolean                           │
│  setPlaybackRate(rate): void                  │
│  getPlaybackRate(): number                    │
│  isPlaying(): boolean                         │
│  waitForFinish(): Promise<void>                │
│  onPlaybackStart: (() => void) | null        │
│  onPlaybackEnd: (() => void) | null          │
└──────────────────────────────────────────────────────┘
```

### 修改范围

| 文件 | 修改内容 |
| --- | --- |
| **新建** `frontend/src/audio/AudioManager.ts` | 实现统一音频管理器，封装 `PcmPlayer` + `HTMLAudioElement`，保证互斥 |
| `frontend/src/components/CallScreen.tsx` | 将所有 `playerRef.current.xxx()` 调用替换为 `AudioManager.getInstance().xxx()`，`setupPlayerCallbacks` 改为设置 `AudioManager.getInstance().onPlaybackStart/End` |
| `frontend/src/pages/ChatPage.tsx` | 将 `playerRef.current` 和 `activeAudioRef.current` 统一替换为 `AudioManager.getInstance()`，`handlePlayVoice` 中的三个场景（A/B/C）改为调用 `AudioManager` 的对应方法 |


### 实现要点

1. **单例模式**：`AudioManager.getInstance()` 全局共享一个实例，`CallScreen` 和 `ChatPage` 共享状态
2. **回调转发**：`AudioManager` 内部监听 `PcmPlayer.onPlaybackStart/End` 和 `HTMLAudioElement.onended`，统一通过 `AudioManager.onPlaybackStart/End` 向外通知
3. **mute 语义保留**：`mute()` 仅影响流式播放（`PcmPlayer.mute()`），不影响回放音频
4. **waitForFinish 语义**：等待所有音频（流式 + 回放）播放完毕
5. **资源清理**：`releaseInstance()` 在组件卸载时调用，清理所有资源和回调

### 目录结构

```
frontend/src/audio/
├── pcmPlayer.ts          [MODIFY 无需修改，作为内部实现]
├── pcmToWav.ts            [不修改]
└── AudioManager.ts          [NEW] 统一音频管理器

frontend/src/components/
└── CallScreen.tsx           [MODIFY] 使用 AudioManager 替换 PcmPlayer

frontend/src/pages/
└── ChatPage.tsx             [MODIFY] 使用 AudioManager 替换 PcmPlayer + activeAudioRef
```