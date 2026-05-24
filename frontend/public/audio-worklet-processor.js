/**
 * AudioStreamProcessor — 麦克风音频流采集，不做 VAD（交给 DashScope 服务端）。
 * 每 ~100ms 将 Float32 转为 Int16Array 并通过 postMessage 发送给主线程。
 */
class AudioStreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    // 收集 float32 样本
    for (let i = 0; i < input.length; i++) {
      this.buffer.push(input[i]);
    }

    // 每 ~100ms 发送一次（1600 samples @ 16kHz = 3200 bytes）
    const CHUNK_SIZE = 1600;
    if (this.buffer.length >= CHUNK_SIZE) {
      const chunk = this.buffer.splice(0, CHUNK_SIZE);
      const int16 = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      // Transferable 零拷贝传输
      this.port.postMessage(
        { type: "audio_chunk", buffer: int16.buffer },
        [int16.buffer]
      );
    }
    return true;
  }
}

registerProcessor("audio-stream", AudioStreamProcessor);
