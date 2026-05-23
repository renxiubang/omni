export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private nextTime = 0;
  private sampleRate = 24000;

  private ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: this.sampleRate });
      this.nextTime = this.ctx.currentTime;
    }
    return this.ctx;
  }

  enqueuePcm16Base64(b64: string, sampleRate = 24000) {
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
    const start = Math.max(this.nextTime, ctx.currentTime);
    source.start(start);
    this.nextTime = start + buffer.duration;
  }

  stop() {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.nextTime = 0;
  }
}
