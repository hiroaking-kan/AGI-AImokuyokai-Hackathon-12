import { useCallback, useEffect, useRef, useState } from 'react';
import { GoogleGenAI, type LiveServerMessage, type Session } from '@google/genai';
import { LIVE_API_VERSION, LIVE_CONFIG } from '../../../shared/live-config';
import type { ConnectionStatus, TokenResponse } from '../../../shared/types';
import { AudioPlayback, bytesToBase64, VoiceConsentGate, type VoiceDecision } from '../services/live-audio';

interface LiveOptions {
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  onVoiceDecision: (decision: VoiceDecision) => Promise<unknown>;
  hasPending: boolean;
}

export function useGeminiLive(options: LiveOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [aiState, setAiState] = useState('待機中');
  const [latestMessage, setLatestMessage] = useState('商品にカメラを向けて、話しかけてください。');
  const [userTranscript, setUserTranscript] = useState('');
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [microphoneActive, setMicrophoneActive] = useState(false);
  const generation = useRef(0);
  const resources = useRef<{
    session?: Session; streams: MediaStream[]; context?: AudioContext; playback?: AudioPlayback;
    input?: MediaStreamAudioSourceNode; worklet?: AudioWorkletNode; timer?: ReturnType<typeof setInterval>;
    startupTimer?: ReturnType<typeof setTimeout>; finishSetup?: (ready: boolean) => void;
    video?: HTMLVideoElement; abort?: AbortController;
  }>({ streams: [] });
  const starting = useRef(false);
  const cleanup = useCallback(() => {
    generation.current++;
    starting.current = false;
    const current = resources.current;
    resources.current = { streams: [] };
    current.abort?.abort();
    if (current.timer) clearInterval(current.timer);
    if (current.startupTimer) clearTimeout(current.startupTimer);
    current.finishSetup?.(false);
    if (current.worklet) { current.worklet.port.onmessage = null; current.worklet.disconnect(); }
    current.input?.disconnect();
    current.playback?.interrupt();
    try { current.session?.close(); } catch { /* Connection may already be closed. */ }
    current.streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    if (current.video) { current.video.pause(); current.video.srcObject = null; }
    if (current.context && current.context.state !== 'closed') void current.context.close().catch(() => {});
    setCameraStream(null);
    setMicrophoneActive(false);
  }, []);
  const stop = useCallback(() => { cleanup(); setStatus('disconnected'); setAiState('待機中'); setError(null); }, [cleanup]);
  useEffect(() => cleanup, [cleanup]);

  const notifyDecision = useCallback((result: unknown) => {
    try {
      resources.current.session?.sendRealtimeInput({ text: `画面操作の処理結果です。結果だけを利用者へ日本語で伝えてください。追加更新は禁止です。${JSON.stringify(result)}` });
    } catch { /* The inventory result remains valid even if conversation disconnected. */ }
  }, []);

  // This function is only called by a user gesture. No effect acquires media or connects.
  const start = useCallback(async () => {
    if (starting.current || resources.current.session) return;
    cleanup();
    starting.current = true;
    const run = generation.current;
    const active = () => generation.current === run;
    const current = resources.current;
    const fail = (message: string) => {
      if (!active()) return;
      cleanup(); setError(message); setStatus('error'); setAiState('接続を確認してください');
    };
    setStatus('connecting'); setError(null); setUserTranscript(''); setAiState('準備中');
    let mediaStage: 'camera' | 'microphone' | 'connection' = 'connection';
    let connectionMessage = 'AIに接続できませんでした。通信状況と接続設定を確認して、もう一度お試しください。';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('このブラウザではカメラとマイクを利用できません。Chromeでlocalhostを開いてください。');
      // Resume immediately within the click gesture to satisfy browser audio autoplay policy.
      current.context = new AudioContext();
      await current.context.resume();
      current.playback = new AudioPlayback(current.context);
      mediaStage = 'camera';
      const camera = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: { ideal: 'environment' } }, audio: false });
      if (!active()) { camera.getTracks().forEach((track) => track.stop()); return; }
      current.streams.push(camera); setCameraStream(camera);
      mediaStage = 'microphone';
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!active()) { microphone.getTracks().forEach((track) => track.stop()); return; }
      current.streams.push(microphone); setMicrophoneActive(true);
      for (const stream of current.streams) for (const track of stream.getTracks()) track.onended = () => fail('カメラまたはマイクとの接続が切れました。もう一度接続してください。');
      mediaStage = 'connection';
      current.startupTimer = setTimeout(() => fail('AIの接続に時間がかかっています。通信状況を確認して再接続してください。'), 30_000);
      current.abort = new AbortController();
      const response = await fetch('/api/gemini/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: current.abort.signal });
      const payload = await response.json() as TokenResponse & { error?: string };
      if (!response.ok) { connectionMessage = payload.error || connectionMessage; throw new Error('Connection unavailable'); }
      if (!active()) return;
      const client = new GoogleGenAI({ apiKey: payload.token, httpOptions: { apiVersion: LIVE_API_VERSION } });
      let turn = 0;
      let inputTurn = -1;
      let inputText = '';
      let outputTurn = -1;
      let outputText = '';
      const gate = new VoiceConsentGate();
      const cancelledTools = new Set<string>();
      const toolResults = new Map<string, unknown>();
      let voiceResult: { turn: number; decision: VoiceDecision; promise: Promise<unknown> } | undefined;
      let toolQueue = Promise.resolve();
      const setupReady = new Promise<boolean>((resolve) => { current.finishSetup = resolve; });
      const performVoiceDecision = (decisionTurn: number) => {
        const decision = gate.consume(decisionTurn, optionsRef.current.hasPending);
        // Replayed/late model calls receive the already completed result; they never write twice.
        if (!decision) return voiceResult;
        const promise = optionsRef.current.onVoiceDecision(decision).catch(() => ({ error: '在庫を更新できませんでした。もう一度お試しください。' }));
        voiceResult = { turn: decisionTurn, decision, promise };
        return voiceResult;
      };
      const handleMessage = (message: LiveServerMessage) => {
        if (!active()) return;
        if (message.setupComplete) current.finishSetup?.(true);
        for (const id of message.toolCallCancellation?.ids ?? []) cancelledTools.add(id);
        const content = message.serverContent;
        if (content?.interrupted) { current.playback?.interrupt(); setAiState('お話しください'); }
        if (content?.inputTranscription?.text) {
          if (inputTurn !== turn) { inputText = ''; inputTurn = turn; }
          inputText += content.inputTranscription.text;
          gate.append(content.inputTranscription.text, turn);
          setUserTranscript(inputText); setAiState('お話を確認しています');
        }
        if (content?.outputTranscription?.text) {
          if (outputTurn !== turn) { outputText = ''; outputTurn = turn; }
          outputText += content.outputTranscription.text;
          setLatestMessage(outputText);
        }
        for (const part of content?.modelTurn?.parts ?? []) {
          if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/pcm')) { current.playback?.play(part.inlineData.data); setAiState('お答えしています'); }
          if (part.text && !part.thought) setLatestMessage(part.text);
        }
        // Finished ASR only; never approve from a partial "はい、でも...".
        if (content?.inputTranscription?.finished) {
          gate.finish(turn);
          // ASR and tool events may arrive in either order. Finished explicit speech itself
          // is the human action; it follows exactly the same App callback as the buttons.
          const prior = voiceResult;
          const decision = performVoiceDecision(turn);
          if (decision && decision !== prior) void decision.promise.then((result) => {
            if (active()) notifyDecision(result);
          });
        }
        if (message.toolCall?.functionCalls) {
          const calls = message.toolCall.functionCalls;
          const callTurn = turn;
          toolQueue = toolQueue.then(async () => {
            for (const call of calls) {
              if (!active() || (call.id && cancelledTools.has(call.id))) continue;
              const name = call.name ?? '';
              let result: unknown;
              try {
                if (call.id && toolResults.has(call.id)) result = toolResults.get(call.id);
                else if (name === 'confirm_inventory_change' || name === 'cancel_inventory_change') {
                  // Model intent alone is insufficient: a completed explicit ASR utterance is required.
                  const decision = performVoiceDecision(callTurn);
                  const expected = name === 'confirm_inventory_change' ? 'confirm' : 'cancel';
                  result = decision?.decision === expected
                    ? await decision.promise
                    : { error: '変更案を提示した後の、利用者の明示的な承認または取消を確認できません。確認カードのボタンでも回答できます。' };
                } else if (['get_products', 'get_product_by_category', 'get_inventory', 'prepare_inventory_change', 'prepare_new_product'].includes(name)) {
                  result = await optionsRef.current.onToolCall(name, call.args ?? {});
                  if ((name === 'prepare_inventory_change' || name === 'prepare_new_product') && result && typeof result === 'object' && !('error' in result)) {
                    gate.prepare(callTurn); voiceResult = undefined;
                  }
                } else result = { error: 'この操作には対応していません。' };
              } catch (cause) { result = { error: cause instanceof Error ? cause.message : '在庫の処理に失敗しました。もう一度お試しください。' }; }
              if (call.id) toolResults.set(call.id, result);
              if (active() && !(call.id && cancelledTools.has(call.id))) current.session?.sendToolResponse({ functionResponses: [{ id: call.id, name, response: { result } }] });
            }
          }).catch(() => fail('AIとの通信が途切れました。もう一度接続してください。'));
        }
        if (content?.turnComplete) { turn++; setAiState('お話しください'); }
        if (message.goAway) fail('会話の接続時間が終了します。再接続して続けてください。');
      };
      const session = await client.live.connect({ model: payload.model, config: LIVE_CONFIG, callbacks: {
        onmessage: handleMessage,
        onerror: () => fail('AIに接続できませんでした。通信状況を確認して、もう一度お試しください。'),
        onclose: () => fail('AIとの接続が終了しました。再接続して続けられます。'),
      } });
      if (!active()) { session.close(); return; }
      current.session = session;
      if (!(await setupReady) || !active()) return;
      await current.context.audioWorklet.addModule('/pcm-worklet.js');
      if (!active()) return;
      current.worklet = new AudioWorkletNode(current.context, 'pcm-recorder');
      current.worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (!active()) return;
        try { session.sendRealtimeInput({ audio: { data: bytesToBase64(event.data), mimeType: 'audio/pcm;rate=16000' } }); }
        catch { fail('音声を送れませんでした。もう一度接続してください。'); }
      };
      current.input = current.context.createMediaStreamSource(microphone);
      current.input.connect(current.worklet);
      current.worklet.connect(current.context.destination); // Worklet outputs silence; never monitors mic.
      current.video = document.createElement('video');
      current.video.muted = true; current.video.playsInline = true; current.video.srcObject = camera;
      await current.video.play();
      if (!active()) return;
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 480;
      const canvasContext = canvas.getContext('2d');
      const sendFrame = () => {
        if (!active() || !canvasContext || !current.video || current.video.readyState < 2) return;
        const ratio = current.video.videoHeight / current.video.videoWidth;
        canvas.height = Math.max(1, Math.round(canvas.width * ratio));
        canvasContext.drawImage(current.video, 0, 0, canvas.width, canvas.height);
        try { session.sendRealtimeInput({ video: { data: canvas.toDataURL('image/jpeg', 0.65).split(',')[1], mimeType: 'image/jpeg' } }); }
        catch { fail('カメラの映像を送れませんでした。もう一度接続してください。'); }
      };
      sendFrame();
      current.timer = setInterval(sendFrame, 1000);
      if (current.startupTimer) clearTimeout(current.startupTimer);
      starting.current = false;
      setStatus('connected'); setAiState('お話しください');
      session.sendRealtimeInput({ text: '利用者が会話を開始しました。短く挨拶して、商品にカメラを向けて話しかけるよう案内してください。' });
    } catch (cause) {
      if (!active()) return;
      const denied = cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'SecurityError');
      if (mediaStage === 'camera') fail(denied ? 'カメラへのアクセスが許可されていません。ブラウザの設定から許可してください。' : 'カメラが見つからないか、ほかのアプリで使用されています。接続を確認してください。');
      else if (mediaStage === 'microphone') fail(denied ? 'マイクへのアクセスが許可されていません。ブラウザの設定から許可してください。' : 'マイクが見つからないか、ほかのアプリで使用されています。接続を確認してください。');
      else fail(connectionMessage);
    }
  }, [cleanup, notifyDecision]);
  const reconnect = useCallback(async () => { stop(); await start(); }, [start, stop]);
  return { status, error, aiState, latestMessage, userTranscript, cameraStream, microphoneActive, start, stop, reconnect, notifyDecision };
}
