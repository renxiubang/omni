export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private sampleRate = 16000;
  private muted = false;
  /** 播放速率，默认 1.0，范围 0.5~2.0 */
  private rate = 1.0;
  /** 待播放的音频缓冲队列 */
  private pending: AudioBuffer[] = [];
  /** 是否正在播放（防止重复触发 playNext） */
  private playing = false;
  /** 当前正在播放的 source 列表（用于 stop） */
  private activeSources: AudioBufferSourceNode[] = [];
  /** 音频块序号，用于日志追踪 */
  private seq = 0;
  /** 播放开始回调 */
  onPlaybackStart: (() => void) | null = null;
  /** 播放结束回调 */
  onPlaybackEnd: (() => void) | null = null;
  /** 标记是否已经开始播放（用于触发 onPlaybackStart） */
  private playbackStarted = false;

  private log(_msg: string) {}

  /** 设置播放速率（0.5 ~ 2.0） */
  setPlaybackRate(rate: number) {
    this.rate = Math.max(0.5, Math.min(2.0, rate));
    for (const src of this.activeSources) {
      try { src.playbackRate.value = this.rate; } catch { /* ignore */ }
    }
  }

  /** 获取当前播放速率 */
  getPlaybackRate(): number {
    return this.rate;
  }

  /** 在用户手势上下文中调用，提前创建并激活 AudioContext */
  async prepare(sampleRate = 16000): Promise<void> {
    this.log(`prepare(sr=${sampleRate}) 当前ctx=${this.ctx ? this.ctx.state : 'null'} storedSr=${this.sampleRate}`);
    if (this.ctx) {
      if (this.sampleRate !== sampleRate) {
        this.log(`  采样率变化 ${this.sampleRate}→${sampleRate}，重建ctx`);
        this.stop();
      } else {
        this.log(`  ctx已存在，state=${this.ctx.state}`);
        if (this.ctx.state === "suspended") {
          this.log(`  prepare: awaiting ctx.resume()...`);
          await this.ctx.resume();
          this.log(`  resume完成, state=${this.ctx.state}`);
        }
        return;
      }
    }
    this.sampleRate = sampleRate;
    this.ctx = new AudioContext({ sampleRate: this.sampleRate });
    this.log(`  新建AudioContext(sr=${sampleRate}) state=${this.ctx.state}`);
    if (this.ctx.state === "suspended") {
      this.log(`  prepare: awaiting ctx.resume()...`);
      await this.ctx.resume();
      this.log(`  resume完成, state=${this.ctx.state}`);
    }
  }

  private async ensureCtx(): Promise<AudioContext> {
    if (!this.ctx) {
      this.log(`ensureCtx: ctx为null，新建AudioContext(sr=${this.sampleRate})`);
      this.ctx = new AudioContext({ sampleRate: this.sampleRate });
      this.log(`  新建完成 state=${this.ctx.state}`);
    }
    if (this.ctx.state === "suspended") {
      this.log(`  ensureCtx: awaiting ctx.resume()...`);
      await this.ctx.resume();
      this.log(`  ensureCtx resume完成 state=${this.ctx.state}`);
    }
    this.log(`ensureCtx返回 state=${this.ctx.state} currentTime=${this.ctx.currentTime}`);
    return this.ctx;
  }

  /** 等待所有已入队的音频播放完毕 */
  waitForFinish(): Promise<void> {
    this.log(`waitForFinish pending=${this.pending.length} active=${this.activeSources.length}`);
    if (this.pending.length === 0 && this.activeSources.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const check = () => {
        if (this.pending.length === 0 && this.activeSources.length === 0) {
          this.log(`waitForFinish 完成`);
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  async enqueuePcm16Base64(b64: string, sampleRate = 16000): Promise<void> {
    this.seq++;
    const mySeq = this.seq;
    this.log(`enqueue #${mySeq} muted=${this.muted} b64Len=${b64.length} dataSr=${sampleRate} storedSr=${this.sampleRate}`);

    if (this.muted) {
      this.log(`  #${mySeq} 已静音，丢弃`);
      return;
    }

    // 采样率不匹配时不再重建 AudioContext，只用数据的采样率创建 buffer
    // Web Audio API 会自动重新采样到 AudioContext 的设备采样率
    const useSr = sampleRate;
    if (sampleRate !== this.sampleRate) {
      this.log(`  #${mySeq} 采样率不匹配 data=${sampleRate} stored=${this.sampleRate}，使用dataRate创建buffer`);
    }

    const ctx = await this.ensureCtx();
    this.log(`  #${mySeq} ctx.state=${ctx.state} ctx.sampleRate=${ctx.sampleRate} ctx.currentTime=${ctx.currentTime}`);

    // Base64 解码
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const sampleCount = bytes.length / 2;
    this.log(`  #${mySeq} rawBytes=${bytes.length} sampleCount=${sampleCount}`);

    // 诊断：检查原始字节（前20字节=10个PCM16样本）
    {
      const peekLen = Math.min(20, bytes.length);
      const hexParts: string[] = [];
      for (let i = 0; i < peekLen; i++) {
        hexParts.push(bytes[i].toString(16).padStart(2, '0'));
      }
      this.log(`  #${mySeq} rawHex前${peekLen}字节: ${hexParts.join(' ')}`);
    }

    // 修复：正确使用 byteOffset 和长度
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
    this.log(`  #${mySeq} Int16Array length=${samples.length} byteOffset=${bytes.byteOffset} byteLength=${samples.byteLength}`);

    // 诊断：检查前10个PCM样本值和统计
    {
      let minVal = 32767, maxVal = -32768;
      let sumSq = 0;
      const peekCount = Math.min(10, samples.length);
      const peekVals: number[] = [];
      for (let i = 0; i < peekCount; i++) peekVals.push(samples[i]);
      for (let i = 0; i < samples.length; i++) {
        if (samples[i] < minVal) minVal = samples[i];
        if (samples[i] > maxVal) maxVal = samples[i];
        sumSq += samples[i] * samples[i];
      }
      const rms = Math.sqrt(sumSq / samples.length);
      this.log(`  #${mySeq} PCM样本 peek[0..${peekCount-1}]=${peekVals.join(',')} min=${minVal} max=${maxVal} rms=${rms.toFixed(1)}`);
    }

    const floats = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      floats[i] = samples[i] / 32768;
    }

    // 诊断：检查float采样统计
    {
      let fmin = 1.0, fmax = -1.0;
      for (let i = 0; i < floats.length; i++) {
        if (floats[i] < fmin) fmin = floats[i];
        if (floats[i] > fmax) fmax = floats[i];
      }
      this.log(`  #${mySeq} Float32范围: [${fmin.toFixed(4)}, ${fmax.toFixed(4)}]`);
    }

    const buffer = ctx.createBuffer(1, floats.length, useSr);
    buffer.copyToChannel(floats, 0);

    // 验证 buffer 内容
    const verifyCh = buffer.getChannelData(0);
    {
      let vmin = 1.0, vmax = -1.0;
      const vpeek = Math.min(5, verifyCh.length);
      const vvals: number[] = [];
      for (let i = 0; i < vpeek; i++) vvals.push(verifyCh[i]);
      for (let i = 0; i < verifyCh.length; i++) {
        if (verifyCh[i] < vmin) vmin = verifyCh[i];
        if (verifyCh[i] > vmax) vmax = verifyCh[i];
      }
      this.log(`  #${mySeq} buffer验证 peek=${vvals.map(v=>v.toFixed(4)).join(',')} 范围=[${vmin.toFixed(4)},${vmax.toFixed(4)}] duration=${buffer.duration.toFixed(3)}s samples=${floats.length}`);
    }

    // 入队，由 playNext 按顺序逐个播放
    this.pending.push(buffer);
    this.log(`  #${mySeq} 入队 pending队列长度=${this.pending.length} playing=${this.playing}`);
    if (!this.playing) {
      this.log(`  #${mySeq} 触发playNext(ctx)`);
      this.playNext(ctx, mySeq);
    }
  }

  /** 从队列取出下一个缓冲并播放，onended 时递归调用自身 */
  private playNext(ctx: AudioContext, triggerSeq: number) {
    this.log(`playNext 触发者=#${triggerSeq} pending长度=${this.pending.length} ctx.state=${ctx.state} ctx.currentTime=${ctx.currentTime} ctx.sampleRate=${ctx.sampleRate} destMaxCh=${ctx.destination.maxChannelCount}`);
    const buffer = this.pending.shift();
    if (!buffer) {
      this.log(`  playNext pending为空 设置playing=false`);
      this.playing = false;
      // 播放结束，触发回调
      if (this.playbackStarted && this.activeSources.length === 0) {
        this.playbackStarted = false;
        this.onPlaybackEnd?.();
      }
      return;
    }
    this.playing = true;
    
    // 第一次开始播放时触发 onPlaybackStart
    if (!this.playbackStarted) {
      this.playbackStarted = true;
      this.onPlaybackStart?.();
    }

    // 验证 buffer 在 playNext 阶段
    const ch = buffer.getChannelData(0);
    let minVal = 1.0, maxVal = -1.0, sumAbs = 0;
    for (let i = 0; i < ch.length; i++) {
      if (ch[i] < minVal) minVal = ch[i];
      if (ch[i] > maxVal) maxVal = ch[i];
      sumAbs += Math.abs(ch[i]);
    }
    const meanAbs = sumAbs / ch.length;
    this.log(`  playNext buffer内容: duration=${buffer.duration.toFixed(3)}s sr=${buffer.sampleRate} ch=${buffer.numberOfChannels} len=${buffer.length} 范围=[${minVal.toFixed(4)},${maxVal.toFixed(4)}] meanAbs=${meanAbs.toFixed(6)}`);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this.rate;
    source.connect(ctx.destination);

    const sourceId = this.activeSources.length;
    this.log(`  playNext 创建source#${sourceId} duration=${buffer.duration.toFixed(3)}s rate=${this.rate} ctx.state=${ctx.state}`);

    this.activeSources.push(source);
    source.onended = () => {
      const endedAt = ctx.currentTime;
      this.log(`  source#${sourceId} onended at ${endedAt.toFixed(3)}s activeSources剩余=${this.activeSources.length - 1}`);
      this.activeSources = this.activeSources.filter((s) => s !== source);
      this.playNext(ctx, -1);
    };

    const doStart = () => {
      const startTime = ctx.currentTime;
      this.log(`  source#${sourceId}.start() 调用... ctx.currentTime=${startTime.toFixed(4)}`);
      try {
        source.start(); // 无参数 = 立即播放，等价于 start(ctx.currentTime)
        this.log(`  source#${sourceId}.start() 成功 activeSources=${this.activeSources.length} 预计${startTime.toFixed(3)}→${(startTime+buffer.duration).toFixed(3)}s`);
      } catch (e) {
        this.log(`  source#${sourceId}.start() 抛异常: ${e}`);
      }
    };

    // 防御性检查：确保 context 处于 running 状态后再 start
    if (ctx.state === "suspended") {
      this.log(`  playNext: ctx 为 suspended，await resume 后再 start`);
      ctx.resume().then(() => {
        this.log(`  resume 完成，state=${ctx.state}，调用 start()`);
        doStart();
      }).catch((e) => this.log(`  resume 失败: ${e}`));
    } else {
      doStart();
    }
  }

  /** 是否正在播放音频 */
  isPlaying(): boolean {
    return this.activeSources.length > 0 || this.pending.length > 0;
  }

  /** 静音：停止当前播放并阻止后续入队播放 */
  mute() {
    this.log(`mute`);
    this.muted = true;
    this.stop();
  }

  /** 取消静音：允许后续入队播放 */
  unmute() {
    this.log(`unmute`);
    this.muted = false;
  }

  /** 是否处于静音状态 */
  isMuted(): boolean {
    return this.muted;
  }

  stop() {
    this.log(`stop pending=${this.pending.length} active=${this.activeSources.length}`);
    this.pending = [];
    this.playing = false;
    for (const src of this.activeSources) {
      try { src.stop(); } catch { /* ignore */ }
    }
    this.activeSources = [];
    
    // 如果播放已经开始，触发结束回调
    if (this.playbackStarted) {
      this.playbackStarted = false;
      this.onPlaybackEnd?.();
    }
    
    if (this.ctx) {
      this.log(`  close AudioContext`);
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
