// Stateful resampling: device rates (usually 44.1/48 kHz) -> mono PCM16 at 16 kHz.
class PCMRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
    this.position = 0;
    this.chunk = [];
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const value of channel) this.samples.push(value);
    const ratio = sampleRate / 16000;
    while (this.position + 1 < this.samples.length) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      const sample = this.samples[index] * (1 - fraction) + this.samples[index + 1] * fraction;
      this.chunk.push(Math.max(-1, Math.min(1, sample)));
      this.position += ratio;
      if (this.chunk.length === 1600) {
        const buffer = new ArrayBuffer(3200);
        const view = new DataView(buffer);
        for (let i = 0; i < this.chunk.length; i++) view.setInt16(i * 2, Math.round(this.chunk[i] * (this.chunk[i] < 0 ? 32768 : 32767)), true);
        this.port.postMessage(buffer, [buffer]);
        this.chunk = [];
      }
    }
    const consumed = Math.min(Math.floor(this.position), this.samples.length);
    this.samples.splice(0, consumed);
    this.position -= consumed;
    return true;
  }
}
registerProcessor('pcm-recorder', PCMRecorder);
