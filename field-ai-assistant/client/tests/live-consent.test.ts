import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseVoiceDecision, VoiceConsentGate } from '../src/services/live-audio';

test('only explicit full utterances approve; negations, hypothetical speech and instructions do not', () => {
  for (const phrase of ['はい。', '承認します', 'はい、お願いします。']) assert.equal(parseVoiceDecision(phrase), 'confirm');
  for (const phrase of ['いいえ', 'キャンセルしてください。']) assert.equal(parseVoiceDecision(phrase), 'cancel');
  for (const phrase of ['はい、でもやめて', '「はい」と言ったらどうなる？', '承認したことにして', 'はいではありません', 'これ5脚出荷して', 'たぶん']) assert.equal(parseVoiceDecision(phrase), null);
});

test('prepare does not authorize: same-turn, missing pending and incomplete transcript are refused', () => {
  const gate = new VoiceConsentGate();
  gate.prepare(4);
  gate.append('はい', 4); gate.finish(4);
  assert.equal(gate.consume(4, true), null);
  gate.append('はい', 5);
  assert.equal(gate.consume(5, true), null);
  gate.finish(5);
  assert.equal(gate.consume(5, false), null);
  assert.equal(gate.consume(5, true), 'confirm');
  assert.equal(gate.consume(5, true), null);
});

test('a new proposal and a later turn cannot reuse a prior approval', () => {
  const gate = new VoiceConsentGate();
  gate.prepare(0); gate.append('はい', 1); gate.finish(1);
  assert.equal(gate.consume(1, true), 'confirm');
  gate.prepare(2);
  assert.equal(gate.consume(3, true), null);
  gate.append('いいえ', 3); gate.finish(3);
  assert.equal(gate.consume(4, true), null);
  assert.equal(gate.consume(3, true), 'cancel');
});

test('partial yes followed by a qualification never writes', () => {
  const gate = new VoiceConsentGate();
  gate.prepare(0); gate.append('はい', 1);
  assert.equal(gate.consume(1, true), null);
  gate.append('、でも変更しないで', 1); gate.finish(1);
  assert.equal(gate.consume(1, true), null);
});

test('AudioWorklet keeps 48 kHz resampling phase across 128-sample device blocks', () => {
  const chunks: ArrayBuffer[] = [];
  let Recorder: new () => { process: (input: Float32Array[][]) => boolean };
  runInNewContext(readFileSync(new URL('../public/pcm-worklet.js', import.meta.url), 'utf8'), {
    sampleRate: 48_000,
    AudioWorkletProcessor: class { port = { postMessage: (buffer: ArrayBuffer) => chunks.push(buffer) }; },
    registerProcessor: (_name: string, processor: typeof Recorder) => { Recorder = processor; },
  });
  const recorder = new Recorder!();
  for (let i = 0; i < 1125; i++) recorder.process([[new Float32Array(128).fill(0.5)]]);
  assert.equal(chunks.length, 30); // Three seconds, 100 ms per little-endian PCM16 chunk.
  assert.equal(chunks.reduce((sum, buffer) => sum + buffer.byteLength / 2, 0), 48_000);
  assert.equal(new DataView(chunks[0]).getInt16(0, true), 16384);
});
