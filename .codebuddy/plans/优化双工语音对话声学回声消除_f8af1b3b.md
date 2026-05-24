---
name: 优化双工语音对话声学回声消除
overview: 针对双工语音对话中AI声音被麦克风捕获回传给AI的回声问题，优化前端AEC实现：改进回声预防逻辑（动态判断AI播放状态）、优化VAD参数、确保Composer组件也启用AEC约束。
design:
  architecture:
    framework: react
    component: shadcn
  styleKeywords:
    - 无UI变更
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 24px
      weight: 600
    subheading:
      size: 18px
      weight: 500
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#07c160"
    background:
      - "#1a1a1a"
    text:
      - "#ffffff"
    functional:
      - "#ff0000"
todos:
  - id: fix-composer-aec
    content: 为Composer.tsx的getUserMedia添加AEC约束配置
    status: completed
  - id: optimize-vad-params
    content: 优化audio-worklet-processor.js的VAD检测参数（能量阈值和最小帧数）
    status: completed
  - id: add-playback-callback
    content: 为PcmPlayer添加播放状态回调支持，便于外部感知播放开始/结束
    status: completed
  - id: implement-mic-muting
    content: 在CallScreen.tsx实现麦克风轨道静音逻辑：AI播放时禁用轨道，播放结束后恢复
    status: completed
    dependencies:
      - add-playback-callback
  - id: improve-ignore-logic
    content: 优化CallScreen.tsx的ignoreVadUntil逻辑，结合播放状态动态判断
    status: completed
    dependencies:
      - implement-mic-muting
  - id: test-verify
    content: 测试验证回声消除效果，在Chrome和Safari下分别测试
    status: completed
    dependencies:
      - improve-ignore-logic
---

## 用户需求

优化双工语音对话时的声学回声消除模块，解决AI的声音被麦克风捕获后回传给AI的问题（AI听到自己的声音）。

## 问题现状

当前实现存在以下导致回声问题的缺陷：

1. CallScreen.tsx中回声预防机制使用硬编码2秒超时（ignoreVadUntil），实际AI回答可能更长，2秒后麦克风会重新捕获AI声音
2. 仅在上层忽略VAD事件，没有真正静音麦克风或停止音频处理
3. Composer.tsx中的麦克风采集未配置AEC约束
4. VAD检测参数（能量阈值0.01）可能过低，容易误触发

## 优化目标

- 在AI播放音频期间有效阻止麦克风捕获AI声音
- 支持Chrome/Edge（桌面端）和Safari（macOS/iOS）
- 先尝试前端优化方案，避免引入后端复杂性

## 技术栈

- 前端：React + TypeScript + Web Audio API + AudioWorklet
- 浏览器音频API：getUserMedia、MediaStreamTrack.enabled、AudioContext

## 实现方案

### 核心策略：麦克风轨道静音 + 动态回声预防

采用"物理静音"方案替代当前的"应用层忽略"方案：

- 当AI开始播放音频时，直接禁用麦克风轨道（track.enabled = false）
- 当AI停止播放音频后，延迟一小段时间再启用麦克风轨道
- 这从物理层面阻止AI声音进入VAD检测流程

### 关键技术方案

#### 1. 麦克风轨道静音机制（CallScreen.tsx）

- 保存getUserMedia返回的MediaStream引用
- 在assistant_audio事件处理中，设置ignoreVadUntil为较长时长（如10秒）
- 同时禁用麦克风轨道：stream.getAudioTracks()[0].enabled = false
- 启动轮询检查PcmPlayer是否还在播放
- 播放停止后延迟500ms再启用麦克风轨道（避免尾部回声）

#### 2. 动态播放状态检测（PcmPlayer.ts）

- 添加onPlaybackStart和onPlaybackEnd回调支持
- 或者在CallScreen中通过定时器轮询isPlaying()状态
- 推荐使用回调方式，更精确且性能更好

#### 3. Composer.tsx添加AEC约束

- 修改getUserMedia调用，添加echoCancellation、noiseSuppression、autoGainControl约束

#### 4. VAD参数优化（audio-worklet-processor.js）

- 适当提高能量阈值（0.01 → 0.015）
- 增加最小语音帧数（8 → 12）
- 减少误触发概率

### 实现细节

#### 文件修改清单

**frontend/src/components/CallScreen.tsx [MODIFY]**

- 保存MediaStream引用到ref
- 在AI开始播放时禁用麦克风轨道
- 实现播放状态轮询，播放结束后重新启用麦克风
- 优化ignoreVadUntil逻辑，结合播放状态动态判断

**frontend/src/audio/pcmPlayer.ts [MODIFY]**

- 添加playbackStateCallback可选配置
- 在start()和stop()时触发回调
- 或者添加getQueueLength()方法，便于判断是否有音频在队列中

**frontend/src/components/Composer.tsx [MODIFY]**

- 第73行getUserMedia添加AEC约束

**frontend/public/audio-worklet-processor.js [MODIFY]**

- 调整energyThreshold从0.01到0.015
- 调整minSpeechFrames从8到12

### 性能考虑

- 麦克风轨道禁用/启用是低开销操作，不会造成音频卡顿
- 轮询间隔建议100-200ms，平衡响应速度和性能
- 不需要修改后端代码，纯前端优化

### 兼容性

- track.enabled属性在所有目标浏览器中都支持
- Chrome/Edge/Safari均支持echoCancellation等约束
- 需要测试Safari下的行为，可能有差异

本任务不涉及UI界面改动，主要是音频处理逻辑的优化，无需设计变更。