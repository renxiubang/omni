import { PcmPlayer } from "./pcmPlayer";

export interface AudioManagerCallbacks {
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
}

/**
 * 统一音频管理器
 * 封装 PcmPlayer（流式播放）和 HTMLAudioElement（回放音频）
 * 保证任意时刻只有一路音频在播放
 */
export class AudioManager {
  private static instance: AudioManager | null = null;

  // 流式播放子系统
  private pcmPlayer: PcmPlayer;
  // 回放音频子系统
  private playbackAudio: HTMLAudioElement | null = null;
  private playbackOnEnd: (() => void) | null = null;

  // 回调
  onPlaybackStart: (() => void) | null = null;
  onPlaybackEnd: (() => void) | null = null;

  // 播放状态追踪
  private streamingPlaying = false;
  private playbackPlaying = false;
  private playbackRate = 1.0;

  private constructor() {
    this.pcmPlayer = new PcmPlayer();
    this.setupPcmPlayerCallbacks();
  }

  /** 获取单例 */
  static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  /** 释放单例（组件卸载时调用） */
  static releaseInstance(): void {
    if (AudioManager.instance) {
      AudioManager.instance.stopAll();
      AudioManager.instance = null;
    }
  }

  /** 设置 PcmPlayer 回调，转发播放开始/结束事件 */
  private setupPcmPlayerCallbacks(): void {
    this.pcmPlayer.onPlaybackStart = () => {
      this.streamingPlaying = true;
      this.onPlaybackStart?.();
    };
    this.pcmPlayer.onPlaybackEnd = () => {
      this.streamingPlaying = false;
      // 只有在回放也没在播放时，才触发 onPlaybackEnd
      if (!this.playbackPlaying) {
        this.onPlaybackEnd?.();
      }
    };
  }

  // ========== 播放接口 ==========

  /**
   * 流式播放 PCM16 base64 音频块
   * 内部自动停止回放音频，保证互斥
   */
  async enqueuePcm16Base64(b64: string, sampleRate = 16000): Promise<void> {
    // 停止回放音频，保证互斥
    this.stopPlayback();
    // 委托给 pcmPlayer
    await this.pcmPlayer.enqueuePcm16Base64(b64, sampleRate);
  }

  /**
   * 回放 WAV URL
   * 内部自动停止流式播放，保证互斥
   */
  playPlayback(url: string, onEnd?: () => void): void {
    // 停止流式播放，保证互斥
    this.stopStreaming();

    // 如果已经在播放同一个 URL，不做重复操作
    if (this.playbackAudio && this.playbackAudio.src === url) {
      // 如果已暂停，继续播放
      if (this.playbackAudio.paused) {
        this.playbackAudio.play().catch(() => {});
      }
      return;
    }

    // 停止当前回放
    this.stopPlayback();

    this.playbackOnEnd = onEnd || null;
    const audio = new Audio(url);
    audio.playbackRate = this.playbackRate;
    audio.onended = () => {
      this.playbackPlaying = false;
      // 如果流式也没在播放，触发 onPlaybackEnd
      if (!this.streamingPlaying) {
        this.onPlaybackEnd?.();
      }
      this.playbackOnEnd?.();
      this.playbackOnEnd = null;
    };
    audio.onerror = () => {
      this.playbackPlaying = false;
      if (!this.streamingPlaying) {
        this.onPlaybackEnd?.();
      }
      this.playbackOnEnd = null;
    };

    this.playbackAudio = audio;
    this.playbackPlaying = true;
    this.onPlaybackStart?.();

    audio.play().catch(() => {
      this.playbackPlaying = false;
      if (!this.streamingPlaying) {
        this.onPlaybackEnd?.();
      }
    });
  }

  // ========== 控制接口 ==========

  /** 停止所有播放（流式 + 回放） */
  stopAll(): void {
    this.stopStreaming();
    this.stopPlayback();
  }

  /** 仅停止流式播放（保留回放） */
  stopStreaming(): void {
    this.pcmPlayer.stop();
    this.streamingPlaying = false;
  }

  /** 仅停止回放（保留流式） */
  stopPlayback(): void {
    if (this.playbackAudio) {
      this.playbackAudio.pause();
      this.playbackAudio.currentTime = 0;
      this.playbackAudio.src = "";
      this.playbackAudio = null;
      this.playbackPlaying = false;
      // 不触发 onPlaybackEnd，因为 stopPlayback 是内部互斥调用
      // 只有当外部显式停止时才触发回调
    }
  }

  /** 停止回放并触发回调（外部调用时使用） */
  stopPlaybackWithCallback(): void {
    if (this.playbackAudio) {
      this.playbackAudio.pause();
      this.playbackAudio.currentTime = 0;
      this.playbackAudio.src = "";
      this.playbackAudio = null;
      this.playbackPlaying = false;
      if (!this.streamingPlaying) {
        this.onPlaybackEnd?.();
      }
    }
  }

  /** 静音：停止当前播放并阻止后续流式入队 */
  mute(): void {
    this.pcmPlayer.mute();
  }

  /** 取消静音：允许后续入队播放 */
  unmute(): void {
    this.pcmPlayer.unmute();
  }

  /** 是否处于静音状态 */
  isMuted(): boolean {
    return this.pcmPlayer.isMuted();
  }

  /** 设置播放速率（两路同时生效） */
  setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.5, Math.min(2.0, rate));
    this.pcmPlayer.setPlaybackRate(this.playbackRate);
    // HTMLAudioElement 的 playbackRate 在下次 playPlayback 时生效
    if (this.playbackAudio) {
      this.playbackAudio.playbackRate = this.playbackRate;
    }
  }

  /** 获取当前播放速率 */
  getPlaybackRate(): number {
    return this.playbackRate;
  }

  /** 是否在播放中（流式或回放） */
  isPlaying(): boolean {
    return this.streamingPlaying || this.playbackPlaying;
  }

  /** 等待所有已调度的音频播放完毕 */
  async waitForFinish(): Promise<void> {
    // 等待流式播放完成
    if (this.streamingPlaying) {
      await this.pcmPlayer.waitForFinish();
    }
    // 等待回放完成
    if (this.playbackPlaying && this.playbackAudio) {
      return new Promise((resolve) => {
        const check = () => {
          if (!this.playbackPlaying || !this.playbackAudio) {
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });
    }
  }

  /** 重置 AudioContext（用户手势调用） */
  async prepare(sampleRate = 16000): Promise<void> {
    await this.pcmPlayer.prepare(sampleRate);
  }

  /** 获取当前回放音频元素（用于检查是否在播放特定消息） */
  getPlaybackAudio(): HTMLAudioElement | null {
    return this.playbackAudio;
  }

  /** 停止回放并重置状态（用于 ChatPage 场景 A：正在流式播放中点击暂停） */
  muteStreamingAndKeepData(): void {
    this.pcmPlayer.mute();
  }

  /** 取消静音（用于恢复流式播放） */
  unmuteStreaming(): void {
    this.pcmPlayer.unmute();
  }
}
