class UtteranceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.state = "idle";
    this.speechBuffer = [];
    this.silenceFrames = 0;
    this.speechFrames = 0;
    this.energyThreshold = 0.01;
    this.minSpeechFrames = 8;
    this.maxSilenceFrames = 25;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    let energy = 0;
    for (let i = 0; i < input.length; i++) energy += input[i] * input[i];
    energy = Math.sqrt(energy / input.length);

    const speaking = energy > this.energyThreshold;

    if (this.state === "idle") {
      if (speaking) {
        this.state = "speaking";
        this.speechFrames = 1;
        this.silenceFrames = 0;
        this.speechBuffer = [Float32Array.from(input)];
        this.port.postMessage({ type: "speechStart" });
      }
    } else if (this.state === "speaking") {
      this.speechBuffer.push(Float32Array.from(input));
      if (speaking) {
        this.speechFrames++;
        this.silenceFrames = 0;
      } else {
        this.silenceFrames++;
        if (this.silenceFrames >= this.maxSilenceFrames && this.speechFrames >= this.minSpeechFrames) {
          this.finalize();
        }
      }
    }
    return true;
  }

  finalize() {
    let total = 0;
    for (const c of this.speechBuffer) total += c.length;
    const combined = new Float32Array(total);
    let offset = 0;
    for (const c of this.speechBuffer) {
      combined.set(c, offset);
      offset += c.length;
    }
    const int16 = new Int16Array(combined.length);
    for (let i = 0; i < combined.length; i++) {
      const s = Math.max(-1, Math.min(1, combined[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage({ type: "utterance_end", buffer: int16.buffer }, [int16.buffer]);
    this.state = "idle";
    this.speechBuffer = [];
    this.speechFrames = 0;
    this.silenceFrames = 0;
  }
}

registerProcessor("utterance-processor", UtteranceProcessor);
