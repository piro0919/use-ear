"use client";

// ─────────────────────────────────────────────────────────────────────────────
// POC: オンデバイス STT (vosk-browser) 版の useEar
//
// 目的: Web Speech API を使わずにウェイクワード検知を行い、
//   1. OS の音声認識通知音 (earcon) を鳴らさない
//   2. セッション再起動なしの連続リッスン (途切れなし)
//   3. 任意の日本語文字列を照合 (既存の照合ロジックを流用)
// を実機で検証する。
//
// vosk-browser は getUserMedia の生音声を WebWorker 上の WASM 推論に流すため、
// OS の音声認識サービスを一切呼ばない = 構造的に earcon が鳴らない。
//
// 注意: これは検証用フックであり、まだライブラリの公開 API には含めない。
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import type { WakeWordInput } from "../types";
import {
  matchWord as matchWordCore,
  normalizeWakeWords,
  transformForMatch as transformForMatchCore,
} from "./wakeWordMatch";

// vosk-browser の最小型 (実体は動的 import する。SSR で Worker/AudioContext を触らないため)
interface VoskResultMessage {
  result: { text: string };
}
interface VoskPartialMessage {
  result: { partial: string };
}
interface VoskRecognizer {
  on(event: "result", cb: (m: VoskResultMessage) => void): void;
  on(event: "partialresult", cb: (m: VoskPartialMessage) => void): void;
  on(event: "error", cb: (m: { error: string }) => void): void;
  acceptWaveform(buffer: AudioBuffer): void;
  remove(): void;
}
interface VoskModel {
  KaldiRecognizer: new (sampleRate: number, grammar?: string) => VoskRecognizer;
  terminate(): void;
}
type CreateModel = (modelUrl: string, logLevel?: number) => Promise<VoskModel>;

export interface UseEarVoskOptions {
  /** 検出するウェイクワード */
  wakeWords: WakeWordInput[];
  /** ウェイクワード検出時のコールバック */
  onWakeWord: (word: string, transcript: string) => void;
  /** リッスンを停止するワード */
  stopWords?: WakeWordInput[];
  /** ストップワード検出時のコールバック */
  onStopWord?: (word: string, transcript: string) => void;
  /** モデル tar.gz の URL (default: /models/vosk-model-small-ja-0.22.tar.gz) */
  modelUrl?: string;
  /** default language (照合には未使用、正規化互換のため) */
  language?: string;
  /** 大文字小文字を区別しない (default: false) */
  caseSensitive?: boolean;
  /** テキスト正規化 (default: true) */
  normalize?: boolean;
  /** あいまい一致の類似度閾値 (0〜1)。未指定なら完全部分一致 */
  similarityThreshold?: number;
  /**
   * Vosk の grammar 機能でウェイクワードだけを認識対象に絞る (実験的)。
   * 有効にすると短い語の精度が上がる場合があるが、モデル語彙に無い語で
   * エラーになることがある。default: false (フリー認識 + あいまい照合)。
   */
  useGrammar?: boolean;
  /** 認識テキスト更新時のコールバック (partial 含む) */
  onTranscript?: (text: string, info: { isFinal: boolean }) => void;
}

export type VoskStatus =
  | "idle"
  | "loading-model"
  | "requesting-mic"
  | "listening"
  | "error";

export interface VoskMetrics {
  /** モデルのダウンロード + 初期化にかかった時間 (ms) */
  modelLoadMs: number | null;
  /** モデルのダウンロードサイズ (bytes) */
  modelBytes: number | null;
  /** リッスン開始からの経過秒数 */
  uptimeSec: number;
  /**
   * メインスレッドの詰まり具合の指標 (ms)。
   * requestAnimationFrame の平均間隔。16.7ms が理想。
   * vosk-browser は非推奨の ScriptProcessorNode (メインスレッド) を使うため、
   * ここが大きく跳ねる = 音声処理でメインスレッドが詰まっている兆候。
   */
  avgFrameMs: number | null;
  /** rAF 間隔の最大値 (ms)。単発の大きなジャンクを捉える */
  maxFrameMs: number | null;
  /** JS ヒープ使用量 (bytes)。Chrome 系のみ。iOS Safari では null */
  heapBytes: number | null;
  /** これまでに処理した音声チャンク数 */
  audioChunks: number;
  /** onaudioprocess 1回の平均処理時間 (ms)。推論前処理の重さの指標 */
  avgChunkMs: number | null;
}

export interface UseEarVoskReturn {
  status: VoskStatus;
  isListening: boolean;
  /** モデルロードの進捗 (0〜1)。取得できない場合は null */
  loadProgress: number | null;
  start: () => Promise<void>;
  stop: () => void;
  error: Error | null;
  /** 直近の確定認識テキスト */
  transcript: string;
  /** 現在の途中経過テキスト (連続性の可視化用) */
  partial: string;
  metrics: VoskMetrics;
}

const DEFAULT_MODEL_URL = "/models/vosk-model-small-ja-0.22.tar.gz";

interface PerfMemory {
  usedJSHeapSize: number;
}

export function useEarVosk(options: UseEarVoskOptions): UseEarVoskReturn {
  const {
    wakeWords,
    onWakeWord,
    stopWords = [],
    onStopWord,
    modelUrl = DEFAULT_MODEL_URL,
    language = "ja-JP",
    caseSensitive = false,
    normalize = true,
    similarityThreshold,
    useGrammar = false,
    onTranscript,
  } = options;

  const [status, setStatus] = useState<VoskStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [transcript, setTranscript] = useState("");
  const [partial, setPartial] = useState("");
  const [loadProgress, setLoadProgress] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<VoskMetrics>({
    modelLoadMs: null,
    modelBytes: null,
    uptimeSec: 0,
    avgFrameMs: null,
    maxFrameMs: null,
    heapBytes: null,
    audioChunks: 0,
    avgChunkMs: null,
  });

  // 最新の options を参照から読むための ref (再レンダーで start をやり直さないため)
  const onWakeWordRef = useRef(onWakeWord);
  const onStopWordRef = useRef(onStopWord);
  const onTranscriptRef = useRef(onTranscript);
  const wakeWordsRef = useRef(wakeWords);
  const stopWordsRef = useRef(stopWords);
  const matchCfgRef = useRef({ caseSensitive, normalize, similarityThreshold });
  useEffect(() => {
    onWakeWordRef.current = onWakeWord;
    onStopWordRef.current = onStopWord;
    onTranscriptRef.current = onTranscript;
    wakeWordsRef.current = wakeWords;
    stopWordsRef.current = stopWords;
    matchCfgRef.current = { caseSensitive, normalize, similarityThreshold };
  });

  // リソース ref
  // モデルは一度ロードしたら保持し、start/stop 間で使い回す (毎回の再ロードを避ける)
  const modelRef = useRef<VoskModel | null>(null);
  const modelPromiseRef = useRef<Promise<VoskModel> | null>(null);
  const recognizerRef = useRef<VoskRecognizer | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const uptimeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 現在の発話で既に発火したワード。1発話につき各ワード1回だけ発火させる。
  // Vosk の partial は発話中ずっと蓄積されるため、これが無いと同じワードが
  // partial 更新のたびに何度も発火してしまう。'result'(発話確定)でクリアする。
  const firedWordsRef = useRef<Set<string>>(new Set());

  // メトリクス集計用の可変カウンタ (再レンダーを避けるため ref に貯めて定期的に flush)
  const perfRef = useRef({
    startedAt: 0,
    frameLast: 0,
    frameSum: 0,
    frameCount: 0,
    frameMax: 0,
    chunkSum: 0,
    chunkCount: 0,
  });

  // partial / final 両方から呼ばれる。現在の発話で未発火のワードだけを1回発火する。
  const runMatch = useCallback((text: string) => {
    if (!text) return;
    const cfg = matchCfgRef.current;
    const transformedText = transformForMatchCore(text, cfg);

    // ストップワード優先
    const stops = normalizeWakeWords(stopWordsRef.current, "ja-JP");
    for (const sw of stops) {
      const tw = transformForMatchCore(sw.word, cfg);
      if (matchWordCore(transformedText, tw, cfg.similarityThreshold)) {
        const key = `stop:${sw.word}`;
        if (firedWordsRef.current.has(key)) return;
        firedWordsRef.current.add(key);
        onStopWordRef.current?.(sw.word, text);
        return;
      }
    }

    const wakes = normalizeWakeWords(wakeWordsRef.current, "ja-JP");
    for (const ww of wakes) {
      const tw = transformForMatchCore(ww.word, cfg);
      if (matchWordCore(transformedText, tw, cfg.similarityThreshold)) {
        const key = `wake:${ww.word}`;
        if (firedWordsRef.current.has(key)) return;
        firedWordsRef.current.add(key);
        onWakeWordRef.current(ww.word, text);
        return;
      }
    }
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (uptimeTimerRef.current != null) {
      clearInterval(uptimeTimerRef.current);
      uptimeTimerRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (silentGainRef.current) {
      silentGainRef.current.disconnect();
      silentGainRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (recognizerRef.current) {
      try {
        recognizerRef.current.remove();
      } catch {
        // すでに解放済みなら無視
      }
      recognizerRef.current = null;
    }
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) track.stop();
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    // NOTE: モデル (modelRef) はここでは解放しない。次の start() で即再開できるよう
    // 保持し続ける。破棄はアンマウント時のみ。
    setStatus("idle");
    setPartial("");
  }, []);

  // モデルを一度だけロードしてキャッシュする。多重呼び出しは同じ Promise を共有する。
  const ensureModel = useCallback(async (): Promise<VoskModel> => {
    if (modelRef.current) return modelRef.current;
    if (modelPromiseRef.current) return modelPromiseRef.current;

    const load = (async (): Promise<VoskModel> => {
      setStatus("loading-model");
      setLoadProgress(null);
      const loadStart = performance.now();

      // fetch で進捗とサイズを取得 (ブラウザ HTTP キャッシュに乗るので実DLは1回)
      let modelBytes: number | null = null;
      try {
        const res = await fetch(modelUrl);
        const total = Number(res.headers.get("content-length")) || 0;
        if (res.body && total > 0) {
          const reader = res.body.getReader();
          let received = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value?.length ?? 0;
            setLoadProgress(Math.min(1, received / total));
          }
          modelBytes = received;
        } else {
          modelBytes = total || null;
        }
      } catch {
        // 進捗取得に失敗しても createModel 側で再取得できるので続行
      }

      const { createModel } = (await import("vosk-browser")) as unknown as {
        createModel: CreateModel;
      };
      const model = await createModel(modelUrl);
      modelRef.current = model;
      const modelLoadMs = performance.now() - loadStart;
      setMetrics((m) => ({ ...m, modelLoadMs, modelBytes }));
      setLoadProgress(1);
      return model;
    })();

    modelPromiseRef.current = load;
    try {
      return await load;
    } catch (e) {
      modelPromiseRef.current = null; // 失敗したら次回リトライできるように
      throw e;
    }
  }, [modelUrl]);

  const start = useCallback(async () => {
    if (
      status === "listening" ||
      status === "loading-model" ||
      status === "requesting-mic"
    )
      return;
    setError(null);
    firedWordsRef.current.clear();

    try {
      // 1) モデルを用意 (初回のみロード。2回目以降は保持済みモデルを即返す)
      const model = await ensureModel();

      // 2) grammar (実験的): ウェイク/ストップワードだけを認識対象に絞る
      let grammar: string | undefined;
      if (useGrammar) {
        const phrases = [
          ...normalizeWakeWords(wakeWordsRef.current, language),
          ...normalizeWakeWords(stopWordsRef.current, language),
        ].map((w) => w.word);
        if (phrases.length > 0) {
          grammar = JSON.stringify([...new Set(phrases), "[unk]"]);
        }
      }

      // 3) マイク取得
      setStatus("requesting-mic");
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          // 16kHz を要求 (best-effort。実際のレートは worker 側で吸収される)
          sampleRate: 16000,
        },
      });
      mediaStreamRef.current = mediaStream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      // iOS ではユーザー操作起点でも suspended のことがあるので resume
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const recognizer = grammar
        ? new model.KaldiRecognizer(audioContext.sampleRate, grammar)
        : new model.KaldiRecognizer(audioContext.sampleRate);
      recognizerRef.current = recognizer;

      recognizer.on("result", (message) => {
        const text = message.result.text ?? "";
        if (text) {
          setTranscript(text);
          onTranscriptRef.current?.(text, { isFinal: true });
          runMatch(text);
        }
        // 発話確定 = 発話境界。次の発話に向けて発火済みフラグをリセット
        firedWordsRef.current.clear();
        setPartial("");
      });
      recognizer.on("partialresult", (message) => {
        const p = message.result.partial ?? "";
        setPartial(p);
        if (p) {
          onTranscriptRef.current?.(p, { isFinal: false });
          runMatch(p);
        } else {
          // partial が空 = 発話境界とみなしリセット
          firedWordsRef.current.clear();
        }
      });
      recognizer.on("error", (message) => {
        setError(new Error(`vosk error: ${message.error}`));
      });

      // 4) 音声グラフ: mic -> scriptProcessor -> (silent gain) -> destination
      //    ScriptProcessorNode は非推奨だが vosk-browser の推奨経路。
      //    onaudioprocess を確実に発火させるため destination まで繋ぐが、
      //    出力は書き込まないので無音 (gain=0 でさらに保険)。
      const source = audioContext.createMediaStreamSource(mediaStream);
      sourceRef.current = source;
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      silentGainRef.current = silentGain;

      processor.onaudioprocess = (event) => {
        const t0 = performance.now();
        try {
          recognizerRef.current?.acceptWaveform(event.inputBuffer);
        } catch (e) {
          // acceptWaveform の失敗は致命ではないのでログのみ
          console.error("acceptWaveform failed", e);
        }
        const dt = performance.now() - t0;
        const p = perfRef.current;
        p.chunkSum += dt;
        p.chunkCount += 1;
      };

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);

      // 5) メトリクス計測開始
      const now = performance.now();
      perfRef.current = {
        startedAt: now,
        frameLast: now,
        frameSum: 0,
        frameCount: 0,
        frameMax: 0,
        chunkSum: 0,
        chunkCount: 0,
      };
      // modelLoadMs/modelBytes は ensureModel で設定済みなので保持し、実行時系のみリセット
      setMetrics((m) => ({
        ...m,
        uptimeSec: 0,
        audioChunks: 0,
        avgChunkMs: null,
        avgFrameMs: null,
        maxFrameMs: null,
      }));

      // rAF でメインスレッドの詰まり具合を測る
      const tick = (ts: number) => {
        const p = perfRef.current;
        if (p.frameLast) {
          const delta = ts - p.frameLast;
          p.frameSum += delta;
          p.frameCount += 1;
          if (delta > p.frameMax) p.frameMax = delta;
        }
        p.frameLast = ts;
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      // 1秒ごとにメトリクスを state へ flush
      uptimeTimerRef.current = setInterval(() => {
        const p = perfRef.current;
        const perf = performance as Performance & { memory?: PerfMemory };
        setMetrics((m) => ({
          ...m,
          uptimeSec: Math.round((performance.now() - p.startedAt) / 1000),
          avgFrameMs: p.frameCount ? p.frameSum / p.frameCount : null,
          maxFrameMs: p.frameMax || null,
          heapBytes: perf.memory?.usedJSHeapSize ?? null,
          audioChunks: p.chunkCount,
          avgChunkMs: p.chunkCount ? p.chunkSum / p.chunkCount : null,
        }));
      }, 1000);

      setLoadProgress(1);
      setStatus("listening");
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Failed to start vosk"));
      setStatus("error");
      stop();
    }
  }, [status, ensureModel, useGrammar, language, runMatch, stop]);

  // アンマウント時のクリーンアップ: 音声リソースを止め、保持していたモデルも破棄する
  useEffect(() => {
    return () => {
      stop();
      modelPromiseRef.current = null;
      if (modelRef.current) {
        try {
          modelRef.current.terminate();
        } catch {
          // 既に破棄済みなら無視
        }
        modelRef.current = null;
      }
    };
  }, [stop]);

  return {
    status,
    isListening: status === "listening",
    loadProgress,
    start,
    stop,
    error,
    transcript,
    partial,
    metrics,
  };
}
