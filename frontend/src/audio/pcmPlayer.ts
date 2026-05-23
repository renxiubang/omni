export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private nextTime = 0;
  private sampleRate = 16000;
  private muted = false;
  /** 已调度但尚未播放完的 AudioBufferSourceNode 数量 */
  private playingSources = 0;
  /** 所有音频播放完毕时的回调 */
  private idleCallback: (() => void) | null = null;

  /** 在用户手势上下文中调用，提前创建并激活 AudioContext。
   *  必须在 handleSse 之前调用，否则浏览器会因 autoplay policy 阻止发声。 */
  prepare(sampleRate = 16000) {
    this.sampleRate = sampleRate;
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: this.sampleRate });
      this.nextTime = this.ctx.currentTime;
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  private ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: this.sampleRate });
      this.nextTime = this.ctx.currentTime;
      void this.ctx.resume();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  /** 所有已调度的 audio source 都播放完毕时调用 */
  private checkIdle() {
    if (this.playingSources <= 0 && this.idleCallback) {
      const cb = this.idleCallback;
      this.idleCallback = null;
      cb();
    }
  }

  enqueuePcm16Base64(b64: string, sampleRate = 16000) {
    if (this.muted) return;
    const ctx = this.ensureCtx();
    if (sampleRate !== this.sampleRate) {
      this.sampleRate = sampleRate;
    }
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const samples = new Int16Array(bytes.buffer);
    const floats = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      floats[i] = samples[i] / 32768;
    }
    const buffer = ctx.createBuffer(1, floats.length, this.sampleRate);
    buffer.copyToChannel(floats, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    this.playingSources++;
    source.onended = () => {
      this.playingSources--;
      this.checkIdle();
    };
    const start = Math.max(this.nextTime, ctx.currentTime);
    source.start(start);
    this.nextTime = start + buffer.duration;
  }

  /** 注册空闲回调：所有已调度音频播放完毕后触发 */
  onIdle(callback: () => void) {
    this.idleCallback = callback;
    this.checkIdle();
  }

  /** 是否正在播放音频（有未完成的 source） */
  isPlaying(): boolean {
    return this.playingSources > 0;
  }

  /** 静音：停止当前播放并阻止后续入队播放 */
  mute() {
    this.muted = true;
    this.stop();
  }

  /** 取消静音：允许后续入队播放 */
  unmute() {
    this.muted = false;
  }

  /** 是否处于静音状态 */
  isMuted(): boolean {
    return this.muted;
  }

  stop() {
    this.idleCallback = null; // 停止时不触发 idle 回调
    this.playingSources = 0;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.nextTime = 0;
  }
}
