export class PcmPlayer {
  private ctx: AudioContext | null = null;
  /** 最近一次入队数据的采样率（用于创建匹配的 AudioContext） */
  private dataSampleRate = 16000;
  private muted = false;
  /** 播放速率，默认 1.0，范围 0.5~2.0 */
  private rate = 1.0;
  /** 下一个 source 应该开始播放的绝对时间（ctx.currentTime），0 表示未调度 */
  private nextStartTime = 0;
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

  private log(msg: string) {
    console.log(`[PcmPlayer] ${msg}`);
  }

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
    this.log(`prepare(sr=${sampleRate}) 当前ctx=${this.ctx ? this.ctx.state : 'null'} storedSr=${this.dataSampleRate}`);
    this.dataSampleRate = sampleRate;
    if (this.ctx) {
      this.log(`  ctx已存在，state=${this.ctx.state}`);
      if (this.ctx.state === "suspended") {
        this.log(`  prepare: awaiting ctx.resume()...`);
        await this.ctx.resume();
        this.log(`  resume完成, state=${this.ctx.state}`);
      }
      return;
    }
    this.ctx = new AudioContext({ sampleRate: this.dataSampleRate });
    this.log(`  新建AudioContext(sr=${sampleRate}) state=${this.ctx.state}`);
    if (this.ctx.state === "suspended") {
      this.log(`  prepare: awaiting ctx.resume()...`);
      await this.ctx.resume();
      this.log(`  resume完成, state=${this.ctx.state}`);
    }
  }

  private async ensureCtx(dataSr: number): Promise<AudioContext> {
    if (!this.ctx) {
      this.log(`ensureCtx: ctx为null，新建AudioContext(sr=${dataSr})`);
      this.ctx = new AudioContext({ sampleRate: dataSr });
      this.dataSampleRate = dataSr;
      this.log(`  新建完成 state=${this.ctx.state} actualSr=${this.ctx.sampleRate}`);
    } else if (this.ctx.sampleRate !== dataSr) {
      // AudioContext 实际采样率与数据不匹配，重建
      this.log(`ensureCtx: 采样率不匹配 ctx.sampleRate=${this.ctx.sampleRate} dataSr=${dataSr}，重建ctx`);
      this.stop();
      this.ctx = new AudioContext({ sampleRate: dataSr });
      this.dataSampleRate = dataSr;
      this.log(`  重建完成 state=${this.ctx.state} actualSr=${this.ctx.sampleRate}`);
    }
    if (this.ctx.state === "suspended") {
      this.log(`  ensureCtx: awaiting ctx.resume()...`);
      await this.ctx.resume();
      this.log(`  ensureCtx resume完成 state=${this.ctx.state}`);
    }
    this.log(`ensureCtx返回 state=${this.ctx.state} currentTime=${this.ctx.currentTime} sampleRate=${this.ctx.sampleRate}`);
    return this.ctx;
  }

  /** 等待所有已调度的音频播放完毕 */
  waitForFinish(): Promise<void> {
    this.log(`waitForFinish active=${this.activeSources.length}`);
    if (this.activeSources.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const check = () => {
        if (this.activeSources.length === 0) {
          this.log(`waitForFinish 完成`);
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  /**
   * 接收 base64 编码的 PCM16 音频块并添加调度播放。
   * 核心改进：使用 source.start(preciseTime) 精确调度，消除块间间隙（杂音根因）。
   */
  async enqueuePcm16Base64(b64: string, sampleRate = 16000): Promise<void> {
    this.seq++;
    const mySeq = this.seq;
    const actualSr = sampleRate;
    this.log(`enqueue #${mySeq} muted=${this.muted} b64Len=${b64.length} dataSr=${actualSr} storedSr=${this.dataSampleRate}`);

    if (this.muted) {
      this.log(`  #${mySeq} 已静音，丢弃`);
      return;
    }

    if (!b64) {
      this.log(`  #${mySeq} ⚠️ 空base64数据，跳过`);
      return;
    }

    const ctx = await this.ensureCtx(actualSr);
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
      this.log(`  #${mySeq} PCM样本 peek[0..${peekCount - 1}]=${peekVals.join(',')} min=${minVal} max=${maxVal} rms=${rms.toFixed(1)}`);
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

    const buffer = ctx.createBuffer(1, floats.length, actualSr);
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
      this.log(`  #${mySeq} buffer验证 peek=${vvals.map(v => v.toFixed(4)).join(',')} 范围=[${vmin.toFixed(4)},${vmax.toFixed(4)}] duration=${buffer.duration.toFixed(3)}s samples=${floats.length}`);
    }

    // === 核心改动：精确时间调度 ===
    // 计算这个 chunk 应该从哪个时间点开始
    const now = ctx.currentTime;
    const effectiveStart = Math.max(this.nextStartTime, now);
    const chunkDuration = buffer.duration / this.rate;

    this.log(`  #${mySeq} 调度: nextStartTime=${this.nextStartTime.toFixed(4)} now=${now.toFixed(4)} effectiveStart=${effectiveStart.toFixed(4)} chunkDuration=${chunkDuration.toFixed(4)}s`);

    // 创建 source 并精确调度 start 时间
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this.rate;
    source.connect(ctx.destination);

    const sourceId = this.activeSources.length;
    this.log(`  #${mySeq} 创建source#${sourceId} startAt=${effectiveStart.toFixed(4)}s`);

    source.onended = () => {
      this.log(`  source#${sourceId} onended activeSources剩余=${this.activeSources.length - 1}`);
      this.activeSources = this.activeSources.filter((s) => s !== source);
      this.checkIdle();
    };
    this.activeSources.push(source);

    // 更新 nextStartTime 为这个 chunk 结束后的时间点
    this.nextStartTime = effectiveStart + chunkDuration;

    const doStart = () => {
      try {
        source.start(effectiveStart); // ← 精确时间调度，消除块间间隙
        this.log(`  source#${sourceId}.start(${effectiveStart.toFixed(4)}) 成功 预计${effectiveStart.toFixed(3)}→${(effectiveStart + chunkDuration).toFixed(3)}s`);
      } catch (e) {
        this.log(`  source#${sourceId}.start() 抛异常: ${e}`);
      }
    };

    if (ctx.state === "suspended") {
      this.log(`  enqueue: ctx 为 suspended，await resume 后再 start`);
      ctx.resume().then(() => {
        this.log(`  resume 完成，state=${ctx.state}，调用 start()`);
        doStart();
      }).catch((e) => this.log(`  resume 失败: ${e}`));
    } else {
      doStart();
    }

    // 第一次播放时触发回调
    if (!this.playbackStarted) {
      this.playbackStarted = true;
      this.onPlaybackStart?.();
    }
  }

  /** 检查是否所有 source 都已结束，触发 idle 回调 */
  private checkIdle() {
    if (this.activeSources.length === 0) {
      this.log(`checkIdle: 所有source已结束`);
      this.nextStartTime = 0;
      if (this.playbackStarted) {
        this.playbackStarted = false;
        this.onPlaybackEnd?.();
      }
    }
  }

  /** 是否正在播放音频 */
  isPlaying(): boolean {
    return this.activeSources.length > 0;
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
    this.log(`stop active=${this.activeSources.length}`);
    this.nextStartTime = 0;
    for (const src of this.activeSources) {
      try { src.stop(); } catch { /* ignore */ }
    }
    this.activeSources = [];
    
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
