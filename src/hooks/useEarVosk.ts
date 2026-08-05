"use client";

// ─────────────────────────────────────────────────────────────────────────────
// オンデバイス STT (vosk-browser) 版の useEar (複数言語モデル対応)
//
// Web Speech API を使わずにウェイクワード検知を行い、
//   1. OS の音声認識通知音 (earcon) を鳴らさない
//   2. セッション再起動なしの連続リッスン (途切れなし)
//   3. 任意の文字列を照合 (既存の照合ロジックを流用)
//   4. 複数言語モデルを同時ロードし、同じ音声を各 recognizer に流して並列照合する
// を実現する。
//
// vosk-browser は getUserMedia の生音声を WebWorker 上の WASM 推論に流すため、
// OS の音声認識サービスを一切呼ばない = 構造的に earcon が鳴らない。
//
// vosk-browser は optional peerDependency。使う側だけ `npm i vosk-browser` する
// (本フックは動的 import するので、Web Speech 版だけの利用者には不要)。
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
  /** 検出するウェイクワード (語ごとに language を持つ) */
  wakeWords: WakeWordInput[];
  /** ウェイクワード検出時のコールバック */
  onWakeWord: (word: string, transcript: string) => void;
  /** リッスンを停止するワード */
  stopWords?: WakeWordInput[];
  /** ストップワード検出時のコールバック */
  onStopWord?: (word: string, transcript: string) => void;
  /**
   * 言語コード -> モデル tar.gz URL のマップ。
   * 複数指定すると全モデルを同時ロードし、同じ音声を各 recognizer に並列で流す。
   * 未指定なら { [language]: modelUrl } の単一モデルとして扱う。
   */
  models?: Record<string, string>;
  /** 単一モデル時の URL (models 未指定時のフォールバック) */
  modelUrl?: string;
  /** default language (bare string の語に割り当てる言語) */
  language?: string;
  /** 大文字小文字を区別しない (default: false) */
  caseSensitive?: boolean;
  /** テキスト正規化 (default: true) */
  normalize?: boolean;
  /** あいまい一致の類似度閾値 (0〜1)。未指定なら完全部分一致 */
  similarityThreshold?: number;
  /**
   * Vosk の grammar 機能でウェイクワードだけを認識対象に絞る (実験的)。
   * 言語ごとにその言語の語で grammar を組む。
   */
  useGrammar?: boolean;
  /** 認識テキスト更新時のコールバック (partial 含む) */
  onTranscript?: (
    text: string,
    info: { isFinal: boolean; language: string },
  ) => void;
}

export type VoskStatus =
  | "idle"
  | "loading-model"
  | "requesting-mic"
  | "listening"
  | "error";

export interface VoskMetrics {
  /** 全モデルのロード + 初期化にかかった時間 (ms) */
  modelLoadMs: number | null;
  /** 全モデルのダウンロード合計サイズ (bytes) */
  modelBytes: number | null;
  /** ロード済みモデル数 (= 同時稼働 recognizer 数) */
  modelCount: number;
  /** リッスン開始からの経過秒数 */
  uptimeSec: number;
  /**
   * メインスレッドの詰まり具合の指標 (ms)。rAF の平均間隔。16.7ms が理想。
   * ScriptProcessorNode (メインスレッド) が詰まると跳ねる。
   */
  avgFrameMs: number | null;
  /** rAF 間隔の最大値 (ms)。単発の大きなジャンクを捉える */
  maxFrameMs: number | null;
  /**
   * JS ヒープ使用量 (bytes)。Chrome 系のみ。
   * 注意: Vosk のモデルメモリは Worker の WASM ヒープにあり、ここには出ない。
   * 複数モデルの本当のメモリ圧は端末の体感 (発熱/もたつき/クラッシュ) で見る。
   */
  heapBytes: number | null;
  /** これまでに処理した音声チャンク数 */
  audioChunks: number;
  /** onaudioprocess 1回の平均処理時間 (ms)。全 recognizer への投入コスト */
  avgChunkMs: number | null;
}

export interface UseEarVoskReturn {
  status: VoskStatus;
  isListening: boolean;
  /**
   * この環境で on-device STT が動作可能か (AudioContext + getUserMedia +
   * WebAssembly の有無で判定)。SSR 中は false、マウント後に確定する。
   * UI の出し分け (対応端末だけボタンを見せる等) に使う。
   */
  isSupported: boolean;
  /** モデルロードの進捗 (0〜1)。取得できない場合は null */
  loadProgress: number | null;
  /** モデルを事前ロードする (start 前に裏で呼ぶと初期化待ちを隠せる) */
  preload: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => void;
  error: Error | null;
  /** 直近の確定認識テキスト (どれかの言語) */
  transcript: string;
  /** 現在の途中経過テキスト (どれかの言語) */
  partial: string;
  metrics: VoskMetrics;
}

// 既定のモデル配信元 (Cloudflare R2 のカスタムドメイン, CDN 前段 / egress 無料 /
// CORS 許可済み)。利用者は models / modelUrl を渡して自前ホストに差し替え可能。
const R2_MODELS_BASE = "https://models.use-ear.kkweb.io";

/**
 * 言語コード -> Vosk small モデル (tar.gz) の既定 URL。
 * models も modelUrl も未指定なら、language に対応するここの URL を単一で使う。
 * 複数言語を同時に使いたい場合は models にこのマップの必要分を渡す。
 */
export const DEFAULT_MODELS: Record<string, string> = {
  "ja-JP": `${R2_MODELS_BASE}/vosk-model-small-ja-0.22.tar.gz`,
  "en-US": `${R2_MODELS_BASE}/vosk-model-small-en-us-0.15.tar.gz`,
  "zh-CN": `${R2_MODELS_BASE}/vosk-model-small-cn-0.22.tar.gz`,
  "ko-KR": `${R2_MODELS_BASE}/vosk-model-small-ko-0.22.tar.gz`,
  "es-ES": `${R2_MODELS_BASE}/vosk-model-small-es-0.42.tar.gz`,
  "fr-FR": `${R2_MODELS_BASE}/vosk-model-small-fr-0.22.tar.gz`,
  "de-DE": `${R2_MODELS_BASE}/vosk-model-small-de-0.15.tar.gz`,
};

// on-device STT が動作可能な環境か (静的な能力判定。モデル URL の到達性は含まない)。
const detectVoskSupport = (): boolean => {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { webkitAudioContext?: unknown };
  const hasAudio =
    typeof AudioContext !== "undefined" ||
    typeof w.webkitAudioContext !== "undefined";
  const hasMic =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const hasWasm = typeof WebAssembly !== "undefined";
  return hasAudio && hasMic && hasWasm;
};

interface PerfMemory {
  usedJSHeapSize: number;
}

interface ActiveRecognizer {
  language: string;
  recognizer: VoskRecognizer;
}

// 読み込んだモデルはモジュール単位で共有する。フックの利用側ごとに持つと、画面遷移で
// 待ち受けが立ち上がり直すたびに数十MBを落とし直し、展開もやり直すことになる。ページに
// 2つ目の利用側が現れても、既に読み込んであるものをそのまま使う。
const sharedModels = new Map<string, VoskModel>();
const sharedModelPromises = new Map<string, Promise<VoskModel>>();
// 生きている利用側の数。0 になってもすぐには捨てない。画面遷移では「外れてから
// 立ち上がる」順になるため、その瞬間に捨てると結局落とし直しになる。
let consumerCount = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
// 利用側が居なくなってからモデルを破棄するまでの猶予。
const MODEL_RELEASE_DELAY_MS = 60_000;

// 進捗もモデルと同じく共有する。実際にモデルを落としているのは最初に立ち上がった
// 利用側だけで、後から立ち上がった側は同じ取得を待っているだけになる。値を利用側ごとの
// state に閉じ込めると、待っている側の画面には進捗が出ない。
let sharedLoadProgress: number | null = null;
const progressSubscribers = new Set<(progress: number | null) => void>();
const publishLoadProgress = (progress: number | null): void => {
  sharedLoadProgress = progress;
  for (const notify of progressSubscribers) notify(progress);
};

const terminateSharedModels = (): void => {
  for (const model of sharedModels.values()) {
    try {
      model.terminate();
    } catch {
      // 既に破棄済みなら無視
    }
  }
  sharedModels.clear();
  sharedModelPromises.clear();
};

export function useEarVosk(options: UseEarVoskOptions): UseEarVoskReturn {
  const {
    wakeWords,
    onWakeWord,
    stopWords = [],
    onStopWord,
    models,
    modelUrl,
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
  const [loadProgress, setLoadProgress] = useState<number | null>(
    sharedLoadProgress,
  );
  // マウント後に環境の対応可否を確定 (SSR では false のまま → ハイドレーション不一致なし)
  const [isSupported, setIsSupported] = useState(false);
  useEffect(() => setIsSupported(detectVoskSupport()), []);
  const [metrics, setMetrics] = useState<VoskMetrics>({
    modelLoadMs: null,
    modelBytes: null,
    modelCount: 0,
    uptimeSec: 0,
    avgFrameMs: null,
    maxFrameMs: null,
    heapBytes: null,
    audioChunks: 0,
    avgChunkMs: null,
  });

  // 言語 -> モデル URL のマップを解決。
  // models 優先。無ければ language 1言語ぶんを modelUrl か既定(R2)から引く。
  const modelsMap = models ?? {
    [language]: modelUrl ?? DEFAULT_MODELS[language] ?? DEFAULT_MODELS["ja-JP"],
  };
  // 有効言語の集合を表す安定キー (解放エフェクトの依存に使う)
  const modelsKey = Object.keys(modelsMap).sort().join("|");

  // 最新の options を参照から読むための ref
  const onWakeWordRef = useRef(onWakeWord);
  const onStopWordRef = useRef(onStopWord);
  const onTranscriptRef = useRef(onTranscript);
  const wakeWordsRef = useRef(wakeWords);
  const stopWordsRef = useRef(stopWords);
  const matchCfgRef = useRef({ caseSensitive, normalize, similarityThreshold });
  const languageRef = useRef(language);
  const useGrammarRef = useRef(useGrammar);
  const modelsMapRef = useRef<Record<string, string>>(modelsMap);
  useEffect(() => {
    onWakeWordRef.current = onWakeWord;
    onStopWordRef.current = onStopWord;
    onTranscriptRef.current = onTranscript;
    wakeWordsRef.current = wakeWords;
    stopWordsRef.current = stopWords;
    matchCfgRef.current = { caseSensitive, normalize, similarityThreshold };
    languageRef.current = language;
    useGrammarRef.current = useGrammar;
    modelsMapRef.current = modelsMap;
  });

  // リソース ref。モデルは言語ごとに保持し、start/stop 間で使い回す。
  // モデルは共有。ref は「その利用側から見た入口」でしかない。
  const modelsRef = useRef(sharedModels);
  const modelPromisesRef = useRef(sharedModelPromises);
  const recognizersRef = useRef<ActiveRecognizer[]>([]);
  // 起動処理が走っている間だけ true。多重起動のガードに state (status) を使うと、
  // 再レンダリング前の呼び出しが古い status を握ったまま素通りし、マイクと音声グラフが
  // 人数分できてしまう。同じ音声が多重に認識器へ流れ込み、認識が引き伸ばされて壊れる。
  const startingRef = useRef(false);
  // 起動の世代。stop() で進める。await の後に世代が変わっていたら、その起動は
  // 割り込まれたものとして自分が作った資源だけ片付けて撤退する。
  const runIdRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const uptimeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 発話ごとの発火済み管理を言語別に持つ (1発話につき各語1回)
  const firedByLangRef = useRef<Map<string, Set<string>>>(new Map());

  const perfRef = useRef({
    startedAt: 0,
    frameLast: 0,
    frameSum: 0,
    frameCount: 0,
    frameMax: 0,
    chunkSum: 0,
    chunkCount: 0,
  });

  // 指定言語の語だけを対象に、未発火の語を1回発火する
  const runMatch = useCallback((text: string, lang: string) => {
    if (!text) return;
    const cfg = matchCfgRef.current;
    const tText = transformForMatchCore(text, cfg);
    let fired = firedByLangRef.current.get(lang);
    if (!fired) {
      fired = new Set<string>();
      firedByLangRef.current.set(lang, fired);
    }
    const def = languageRef.current;

    const stops = normalizeWakeWords(stopWordsRef.current, def).filter(
      (w) => w.language === lang,
    );
    for (const sw of stops) {
      const tw = transformForMatchCore(sw.word, cfg);
      if (matchWordCore(tText, tw, cfg.similarityThreshold)) {
        const key = `stop:${sw.word}`;
        if (fired.has(key)) return;
        fired.add(key);
        onStopWordRef.current?.(sw.word, text);
        return;
      }
    }

    const wakes = normalizeWakeWords(wakeWordsRef.current, def).filter(
      (w) => w.language === lang,
    );
    for (const ww of wakes) {
      const tw = transformForMatchCore(ww.word, cfg);
      if (matchWordCore(tText, tw, cfg.similarityThreshold)) {
        const key = `wake:${ww.word}`;
        if (fired.has(key)) return;
        fired.add(key);
        onWakeWordRef.current(ww.word, text);
        return;
      }
    }
  }, []);

  const stop = useCallback(() => {
    // 進行中の起動を無効化する。await の途中では資源がまだ生まれていないため、
    // ここで片付けることはできない。世代を進めて、起動側に撤退させる。
    runIdRef.current += 1;
    startingRef.current = false;
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
    for (const { recognizer } of recognizersRef.current) {
      try {
        recognizer.remove();
      } catch {
        // すでに解放済みなら無視
      }
    }
    recognizersRef.current = [];
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) track.stop();
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    // モデル (modelsRef) は保持し続ける。破棄はアンマウント時のみ。
    setStatus("idle");
    setPartial("");
  }, []);

  // modelsMap の全モデルを一度だけロードしてキャッシュする (並列)。
  const ensureModels = useCallback(async (): Promise<void> => {
    const entries = Object.entries(modelsMapRef.current);
    const missing = entries.filter(([lang]) => !modelsRef.current.has(lang));
    if (missing.length === 0) return;

    setStatus("loading-model");
    publishLoadProgress(null);
    const loadStart = performance.now();

    const received: Record<string, number> = {};
    const totals: Record<string, number> = {};
    const updateProgress = () => {
      const t = Object.values(totals).reduce((a, b) => a + b, 0);
      const r = Object.values(received).reduce((a, b) => a + b, 0);
      if (t > 0) publishLoadProgress(Math.min(1, r / t));
    };

    const { createModel } = (await import("vosk-browser")) as unknown as {
      createModel: CreateModel;
    };

    await Promise.all(
      entries.map(async ([lang, url]) => {
        if (modelsRef.current.has(lang)) return;
        let p = modelPromisesRef.current.get(lang);
        if (!p) {
          p = (async () => {
            // 進捗のために本体を読み切るが、渡すのは URL のままにする。取得した中身を
            // Blob にして渡すとダウンロードは1回で済むが、その経路では圧縮が解かれた
            // 状態になり vosk 側の展開が "Unrecognized archive format" で失敗する。
            try {
              const res = await fetch(url);
              const total = Number(res.headers.get("content-length")) || 0;
              totals[lang] = total;
              if (res.body && total > 0) {
                const reader = res.body.getReader();
                received[lang] = 0;
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  received[lang] += value?.length ?? 0;
                  updateProgress();
                }
              }
            } catch {
              // 進捗取得に失敗しても createModel が自分で取りに行くので続行する
            }
            const model = await createModel(url);
            modelsRef.current.set(lang, model);
            return model;
          })();
          modelPromisesRef.current.set(lang, p);
        }
        try {
          await p;
        } catch (e) {
          modelPromisesRef.current.delete(lang);
          throw e;
        }
      }),
    );

    const totalBytes = Object.values(totals).reduce((a, b) => a + b, 0) || null;
    setMetrics((m) => ({
      ...m,
      modelLoadMs: performance.now() - loadStart,
      modelBytes: totalBytes,
      modelCount: modelsRef.current.size,
    }));
    publishLoadProgress(1);
  }, []);

  const start = useCallback(async () => {
    // ガードは state ではなく ref で行う。state は再レンダリングまで古い値のままで、
    // 同じ瞬間に重なった呼び出しを弾けない。
    if (startingRef.current || recognizersRef.current.length > 0) return;
    startingRef.current = true;
    const runId = ++runIdRef.current;
    // この起動が割り込まれたか。割り込まれていたら自分の資源だけ片付けて撤退する。
    const abandoned = (): boolean => runId !== runIdRef.current;
    setError(null);
    firedByLangRef.current.clear();

    try {
      // 1) 全モデルを用意 (初回のみロード)
      await ensureModels();
      if (abandoned()) return;

      // 2) マイク取得
      setStatus("requesting-mic");
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          sampleRate: 16000,
        },
      });
      // ここから先は資源を掴んでいる。撤退するなら自分で解放する。
      if (abandoned()) {
        for (const track of mediaStream.getTracks()) track.stop();
        return;
      }
      mediaStreamRef.current = mediaStream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      if (abandoned()) {
        for (const track of mediaStream.getTracks()) track.stop();
        audioContext.close().catch(() => {});
        if (mediaStreamRef.current === mediaStream)
          mediaStreamRef.current = null;
        if (audioContextRef.current === audioContext)
          audioContextRef.current = null;
        return;
      }

      // 3) 言語ごとに recognizer を作成 (grammar はその言語の語で)
      const def = languageRef.current;
      const active: ActiveRecognizer[] = [];
      for (const lang of Object.keys(modelsMapRef.current)) {
        const model = modelsRef.current.get(lang);
        if (!model) continue;

        let grammar: string | undefined;
        if (useGrammarRef.current) {
          const phrases = [
            ...normalizeWakeWords(wakeWordsRef.current, def),
            ...normalizeWakeWords(stopWordsRef.current, def),
          ]
            .filter((w) => w.language === lang)
            .map((w) => w.word);
          if (phrases.length > 0) {
            grammar = JSON.stringify([...new Set(phrases), "[unk]"]);
          }
        }

        const recognizer = grammar
          ? new model.KaldiRecognizer(audioContext.sampleRate, grammar)
          : new model.KaldiRecognizer(audioContext.sampleRate);

        recognizer.on("result", (message) => {
          const text = message.result.text ?? "";
          if (text) {
            setTranscript(text);
            onTranscriptRef.current?.(text, { isFinal: true, language: lang });
            runMatch(text, lang);
          }
          // その言語の発話境界。発火済みをリセット
          firedByLangRef.current.get(lang)?.clear();
        });
        recognizer.on("partialresult", (message) => {
          const p = message.result.partial ?? "";
          setPartial(p);
          if (p) {
            onTranscriptRef.current?.(p, { isFinal: false, language: lang });
            runMatch(p, lang);
          } else {
            firedByLangRef.current.get(lang)?.clear();
          }
        });
        recognizer.on("error", (message) => {
          setError(new Error(`vosk error (${lang}): ${message.error}`));
        });

        active.push({ language: lang, recognizer });
      }
      recognizersRef.current = active;

      // 4) 音声グラフ: mic -> scriptProcessor -> (silent gain) -> destination
      //    onaudioprocess で全 recognizer に同じ音声を投入する。
      const source = audioContext.createMediaStreamSource(mediaStream);
      sourceRef.current = source;
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      silentGainRef.current = silentGain;

      // 回すのは recognizersRef ではなく、この起動で作った active。
      // ref を読み直すと、取り残されたノードが「今の認識器」へ音声を重ねて流し込み、
      // 同じ音が多重に入って認識が引き伸ばされる。
      processor.onaudioprocess = (event) => {
        const t0 = performance.now();
        for (const { recognizer } of active) {
          try {
            recognizer.acceptWaveform(event.inputBuffer);
          } catch (e) {
            console.error("acceptWaveform failed", e);
          }
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
      setMetrics((m) => ({
        ...m,
        uptimeSec: 0,
        audioChunks: 0,
        avgChunkMs: null,
        avgFrameMs: null,
        maxFrameMs: null,
      }));

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

      publishLoadProgress(1);
      setStatus("listening");
    } catch (e) {
      // 割り込まれた後の失敗は、次の起動が面倒を見るのでここでは触らない。
      if (abandoned()) return;
      setError(e instanceof Error ? e : new Error("Failed to start vosk"));
      setStatus("error");
      stop();
    } finally {
      // 自分が最後の起動である間だけ在庫フラグを下ろす。割り込まれている場合は
      // 新しい起動が握っているので触らない。
      if (!abandoned()) startingRef.current = false;
    }
  }, [ensureModels, runMatch, stop]);

  // モデルの事前ロード
  const preload = useCallback(async () => {
    try {
      await ensureModels();
      setStatus((s) => (s === "loading-model" ? "idle" : s));
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Failed to preload model"));
      setStatus((s) => (s === "loading-model" ? "idle" : s));
    }
  }, [ensureModels]);

  // 選択から外れた言語のモデルをメモリ解放する。
  // 選択変更 (modelsKey 変化) のたびに、有効マップに無く、かつ現在稼働中の
  // recognizer にも使われていないモデルを terminate してヒープから落とす。
  // (ページ側はリッスン中の言語切り替えを禁止しているので通常は idle 時のみ発火)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 意図的に modelsKey のみで発火
  useEffect(() => {
    // モデルは共有しているので、他の利用側が居る間は解放しない。
    if (consumerCount > 1) return;
    const wanted = new Set(Object.keys(modelsMapRef.current));
    const activeLangs = new Set(recognizersRef.current.map((r) => r.language));
    let released = false;
    for (const [lang, model] of modelsRef.current) {
      if (wanted.has(lang) || activeLangs.has(lang)) continue;
      try {
        model.terminate();
      } catch {
        // 既に破棄済みなら無視
      }
      modelsRef.current.delete(lang);
      modelPromisesRef.current.delete(lang);
      released = true;
    }
    if (released) {
      setMetrics((m) => ({ ...m, modelCount: modelsRef.current.size }));
    }
  }, [modelsKey]);

  // アンマウント時のクリーンアップ: 音声リソースだけ止める。モデルは共有なので、
  // 最後の利用側が居なくなってから猶予をおいて破棄する。画面遷移では新しい待ち受けが
  // すぐ立ち上がるため、その場で捨てると落とし直しになる。
  // 共有している進捗を購読する。落としている側でなくても現在値が届く。
  useEffect(() => {
    progressSubscribers.add(setLoadProgress);
    setLoadProgress(sharedLoadProgress);
    return () => {
      progressSubscribers.delete(setLoadProgress);
    };
  }, []);

  useEffect(() => {
    consumerCount += 1;
    if (releaseTimer != null) {
      clearTimeout(releaseTimer);
      releaseTimer = null;
    }
    return () => {
      stop();
      consumerCount -= 1;
      if (consumerCount > 0) return;
      if (releaseTimer != null) clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        if (consumerCount > 0) return;
        terminateSharedModels();
      }, MODEL_RELEASE_DELAY_MS);
    };
  }, [stop]);

  return {
    status,
    isListening: status === "listening",
    isSupported,
    loadProgress,
    preload,
    start,
    stop,
    error,
    transcript,
    partial,
    metrics,
  };
}
