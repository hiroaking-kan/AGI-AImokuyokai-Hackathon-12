export function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export class AudioPlayback {
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  constructor(readonly context: AudioContext) {}
  play(base64: string) {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const samples = Math.floor(bytes.length / 2);
    if (!samples || this.context.state === 'closed') return;
    const audio = this.context.createBuffer(1, samples, 24_000);
    const channel = audio.getChannelData(0);
    for (let i = 0; i < samples; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
    const source = this.context.createBufferSource();
    source.buffer = audio;
    source.connect(this.context.destination);
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); };
    this.nextTime = Math.max(this.nextTime, this.context.currentTime + 0.03);
    source.start(this.nextTime);
    this.nextTime += audio.duration;
  }
  interrupt() {
    for (const source of this.sources) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
    this.sources.clear();
    this.nextTime = 0;
  }
}

export type VoiceDecision = 'confirm' | 'cancel';
/** Exact, complete utterances only: e.g. 'はい、でも...' is deliberately not approval. */
export function parseVoiceDecision(transcript: string): VoiceDecision | null {
  const text = transcript.normalize('NFKC').replace(/[\s。、.!！?？「」]/g, '').toLowerCase();
  if (['はい', 'はいお願いします', 'お願いします', '承認します', '変更してください', '実行してください', 'yes'].includes(text)) return 'confirm';
  if (['いいえ', 'やめて', 'やめてください', 'キャンセル', 'キャンセルしてください', '変更しないでください', 'no'].includes(text)) return 'cancel';
  return null;
}

export class VoiceConsentGate {
  private preparedTurn = Number.POSITIVE_INFINITY;
  private transcript = '';
  private transcriptTurn = -1;
  private consumed = false;
  private finished = false;
  prepare(turn: number) {
    this.preparedTurn = turn;
    this.transcript = '';
    this.transcriptTurn = -1;
    this.consumed = false;
    this.finished = false;
  }
  append(text: string, turn: number) {
    if (this.transcriptTurn !== turn) { this.transcript = ''; this.finished = false; }
    this.transcriptTurn = turn;
    this.transcript += text;
  }
  finish(turn: number) { if (this.transcriptTurn === turn) this.finished = true; }
  consume(turn: number, hasPending: boolean): VoiceDecision | null {
    if (!hasPending || !this.finished || this.consumed || turn <= this.preparedTurn || turn !== this.transcriptTurn) return null;
    const decision = parseVoiceDecision(this.transcript);
    if (decision) this.consumed = true;
    return decision;
  }
}
