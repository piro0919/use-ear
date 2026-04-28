"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UseEarOptions, UseEarReturn, WakeWordInput } from "../types";

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
  readonly resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onresult:
    | ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEvent) => void)
    | null;
  onerror:
    | ((
        this: SpeechRecognitionInstance,
        ev: SpeechRecognitionErrorEvent,
      ) => void)
    | null;
  onend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const getSpeechRecognition = (): SpeechRecognitionConstructor | null => {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
};

interface AudioKeepAlive {
  context: AudioContext;
  oscillator: OscillatorNode;
  gain: GainNode;
}

const createKeepAlive = (): AudioKeepAlive | null => {
  if (typeof window === "undefined") return null;

  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    // ほぼ無音（完全に0だと最適化で停止される可能性がある）
    gain.gain.value = 0.001;
    // 可聴域外の周波数にして音が聞こえないようにする
    oscillator.frequency.value = 20;

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();

    return { context, oscillator, gain };
  } catch {
    return null;
  }
};

const stopKeepAlive = (keepAlive: AudioKeepAlive) => {
  try {
    keepAlive.oscillator.stop();
    keepAlive.oscillator.disconnect();
    keepAlive.gain.disconnect();
    keepAlive.context.close();
  } catch {
    // 既に停止している場合は無視
  }
};

interface NormalizedWakeWord {
  word: string;
  language: string;
}

const normalizeWakeWords = (
  wakeWords: WakeWordInput[],
  defaultLanguage: string,
): NormalizedWakeWord[] => {
  return wakeWords.map((w) =>
    typeof w === "string" ? { word: w, language: defaultLanguage } : w,
  );
};

const getUniqueLanguages = (wakeWords: NormalizedWakeWord[]): string[] => {
  return [...new Set(wakeWords.map((w) => w.language))];
};

// Wake Lock API
const requestWakeLock = async (): Promise<WakeLockSentinel | null> => {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
    return null;
  }

  try {
    return await navigator.wakeLock.request("screen");
  } catch {
    // Wake Lock APIがサポートされていない、または権限がない場合
    return null;
  }
};

const releaseWakeLock = async (wakeLock: WakeLockSentinel | null) => {
  if (wakeLock) {
    try {
      await wakeLock.release();
    } catch {
      // 既に解放されている場合は無視
    }
  }
};

/**
 * テキスト正規化: ウェイクワード照合の安定性を上げるための前処理
 * - 空白除去 (Web Speech APIが任意位置にスペースを挿入することがある)
 * - NFKC: 全角↔半角統一
 * - カタカナ→ひらがな: 「ばいたる」「バイタル」を等価に扱う
 * - 「を」→「お」: 助詞の同音異字 (Web Speech APIは「を/お」を頻繁に取り違える)
 */
const normalizeText = (s: string): string =>
  s
    .replace(/\s+/g, "")
    .normalize("NFKC")
    .replace(/[ァ-ヶ]/g, (m) => String.fromCharCode(m.charCodeAt(0) - 0x60))
    .replace(/を/g, "お");

// Levenshtein 距離 (1文字の挿入/削除/置換の最小回数)
const levenshtein = (a: string, b: string): number => {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // メモリ節約のため2行だけ保持
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
};

/**
 * text の中に word と類似度 threshold 以上の部分が含まれるかを判定する。
 * word 長のスライディングウィンドウで text を走査し、各位置で類似度を計算する。
 * 完全部分一致は早期 return で軽量化。
 */
const fuzzyIncludes = (
  text: string,
  word: string,
  threshold: number,
): boolean => {
  if (text.includes(word)) return true;

  const wlen = word.length;
  if (wlen === 0) return false;

  // ワードが短いほど誤発火しやすいので閾値を引き上げる
  const effectiveThreshold = wlen <= 3 ? Math.max(threshold, 0.9) : threshold;

  if (text.length < wlen) {
    const sim = 1 - levenshtein(text, word) / wlen;
    return sim >= effectiveThreshold;
  }

  // 多少前後の長さも見るため ±1 幅でウィンドウを取る (挿入/削除を吸収)
  const minWin = Math.max(1, wlen - 1);
  const maxWin = wlen + 1;

  for (let winLen = minWin; winLen <= maxWin; winLen++) {
    if (text.length < winLen) continue;
    for (let i = 0; i <= text.length - winLen; i++) {
      const window = text.slice(i, i + winLen);
      const dist = levenshtein(window, word);
      const sim = 1 - dist / Math.max(window.length, wlen);
      if (sim >= effectiveThreshold) return true;
    }
  }
  return false;
};

export function useEar(options: UseEarOptions): UseEarReturn {
  const {
    wakeWords,
    onWakeWord,
    stopWords = [],
    onStopWord,
    continuous = true,
    language = "ja-JP",
    caseSensitive = false,
    keepAlive = true,
    screenLock = false,
    maxAlternatives = 3,
    normalize = true,
    similarityThreshold,
    onTranscript,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [transcript, setTranscript] = useState("");

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const keepAliveRef = useRef<AudioKeepAlive | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const onWakeWordRef = useRef(onWakeWord);
  const onStopWordRef = useRef(onStopWord);
  const onTranscriptRef = useRef(onTranscript);
  const languageIndexRef = useRef(0);
  const shouldContinueRef = useRef(false);
  const detectedWordsRef = useRef<Set<string>>(new Set());
  const lastFinalIndexRef = useRef(-1);

  // ワードを正規化して言語リストを取得
  const normalizedWakeWords = normalizeWakeWords(wakeWords, language);
  const normalizedStopWords = normalizeWakeWords(stopWords, language);
  const allWords = [...normalizedWakeWords, ...normalizedStopWords];
  const languages = getUniqueLanguages(allWords);
  const normalizedWakeWordsRef = useRef(normalizedWakeWords);
  const normalizedStopWordsRef = useRef(normalizedStopWords);
  const languagesRef = useRef(languages);

  // 参照を更新
  useEffect(() => {
    onWakeWordRef.current = onWakeWord;
    onStopWordRef.current = onStopWord;
    onTranscriptRef.current = onTranscript;
    normalizedWakeWordsRef.current = normalizedWakeWords;
    normalizedStopWordsRef.current = normalizedStopWords;
    languagesRef.current = languages;
  }, [
    onWakeWord,
    onStopWord,
    onTranscript,
    normalizedWakeWords,
    normalizedStopWords,
    languages,
  ]);

  // マウント後にブラウザサポートをチェック（SSRでのhydration mismatchを防ぐ）
  useEffect(() => {
    setHasMounted(true);
  }, []);

  // hasMountedがtrueになってから実際のサポート状況を返す
  const isSupported = hasMounted && getSpeechRecognition() !== null;

  const stopRef = useRef<() => void>(() => {});

  // 照合用にテキストを変換: 大文字小文字 + 任意の正規化処理
  const transformForMatch = useCallback(
    (s: string): string => {
      let out = caseSensitive ? s : s.toLowerCase();
      if (normalize) out = normalizeText(out);
      return out;
    },
    [caseSensitive, normalize],
  );

  const matchWord = useCallback(
    (text: string, word: string): boolean => {
      if (
        typeof similarityThreshold === "number" &&
        similarityThreshold > 0 &&
        similarityThreshold <= 1
      ) {
        return fuzzyIncludes(text, word, similarityThreshold);
      }
      return text.includes(word);
    },
    [similarityThreshold],
  );

  const checkStopWord = useCallback(
    (texts: string[], resultIndex: number): boolean => {
      for (const stopWord of normalizedStopWordsRef.current) {
        const transformedWord = transformForMatch(stopWord.word);
        const detectionKey = `stop:${resultIndex}:${transformedWord}`;

        if (detectedWordsRef.current.has(detectionKey)) continue;

        for (const text of texts) {
          if (matchWord(transformForMatch(text), transformedWord)) {
            detectedWordsRef.current.add(detectionKey);
            onStopWordRef.current?.(stopWord.word, text);
            stopRef.current();
            return true;
          }
        }
      }
      return false;
    },
    [transformForMatch, matchWord],
  );

  const checkWakeWord = useCallback(
    (texts: string[], resultIndex: number) => {
      // まずストップワードをチェック
      if (checkStopWord(texts, resultIndex)) {
        return false;
      }

      for (const wakeWord of normalizedWakeWordsRef.current) {
        const transformedWord = transformForMatch(wakeWord.word);
        const detectionKey = `wake:${resultIndex}:${transformedWord}`;

        if (detectedWordsRef.current.has(detectionKey)) continue;

        for (const text of texts) {
          if (matchWord(transformForMatch(text), transformedWord)) {
            detectedWordsRef.current.add(detectionKey);
            onWakeWordRef.current(wakeWord.word, text);
            return true;
          }
        }
      }
      return false;
    },
    [transformForMatch, checkStopWord, matchWord],
  );

  const startWithLanguage = useCallback(
    (lang: string) => {
      const SpeechRecognitionClass = getSpeechRecognition();
      if (!SpeechRecognitionClass) {
        setError(
          new Error("SpeechRecognition is not supported in this browser"),
        );
        return;
      }

      // 既存のインスタンスを停止
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }

      const recognition = new SpeechRecognitionClass();
      recognition.continuous = continuous;
      recognition.interimResults = true;
      recognition.lang = lang;
      recognition.maxAlternatives = Math.max(1, maxAlternatives);

      recognition.onstart = () => {
        setIsListening(true);
        setError(null);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const resultIndex = event.resultIndex;
        const result = event.results[resultIndex];

        if (result) {
          // トップ候補と代替認識をまとめて取得 (照合ヒット率を上げる)
          const alternatives: string[] = [];
          for (let i = 0; i < result.length; i++) {
            const alt = result[i];
            if (alt?.transcript) alternatives.push(alt.transcript);
          }
          const topText = alternatives[0] ?? "";
          setTranscript(topText);

          if (onTranscriptRef.current) {
            onTranscriptRef.current(topText, {
              alternatives: alternatives.slice(1),
              isFinal: result.isFinal,
            });
          }

          // 同じresultIndexに対して、finalになったときに一度だけチェック
          // または、中間結果でも新しいresultIndexの場合はチェック
          if (result.isFinal || resultIndex > lastFinalIndexRef.current) {
            checkWakeWord(alternatives, resultIndex);
            if (result.isFinal) {
              lastFinalIndexRef.current = resultIndex;
            }
          }
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        setError(new Error(`Speech recognition error: ${event.error}`));
        setIsListening(false);
      };

      recognition.onend = () => {
        // continuous モードの場合は次の言語で再開
        if (shouldContinueRef.current && continuous) {
          // 次の言語にローテーション
          languageIndexRef.current =
            (languageIndexRef.current + 1) % languagesRef.current.length;
          const nextLang = languagesRef.current[languageIndexRef.current];

          // 言語切り替え時に検出状態をリセット
          detectedWordsRef.current.clear();
          lastFinalIndexRef.current = -1;

          // 少し遅延を入れて再開（ブラウザの制限回避）
          setTimeout(() => {
            if (shouldContinueRef.current) {
              startWithLanguage(nextLang);
            }
          }, 100);
        } else {
          setIsListening(false);
        }
      };

      recognitionRef.current = recognition;

      try {
        recognition.start();
      } catch (e) {
        setError(
          e instanceof Error ? e : new Error("Failed to start recognition"),
        );
      }
    },
    [continuous, maxAlternatives, checkWakeWord],
  );

  const start = useCallback(async () => {
    shouldContinueRef.current = true;
    languageIndexRef.current = 0;
    detectedWordsRef.current.clear();
    lastFinalIndexRef.current = -1;

    // keepAliveが有効な場合、オーディオセッションを維持
    if (keepAlive && !keepAliveRef.current) {
      keepAliveRef.current = createKeepAlive();
    }

    // screenLockが有効な場合、画面の自動ロックを防ぐ
    if (screenLock && !wakeLockRef.current) {
      wakeLockRef.current = await requestWakeLock();
    }

    const initialLang = languagesRef.current[0] || language;
    startWithLanguage(initialLang);
  }, [keepAlive, screenLock, language, startWithLanguage]);

  const stop = useCallback(async () => {
    shouldContinueRef.current = false;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (keepAliveRef.current) {
      stopKeepAlive(keepAliveRef.current);
      keepAliveRef.current = null;
    }
    if (wakeLockRef.current) {
      await releaseWakeLock(wakeLockRef.current);
      wakeLockRef.current = null;
    }
    setIsListening(false);
  }, []);

  // stopRefを更新してcheckStopWordから呼び出せるようにする
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  // Wake Lockはページが非表示になると自動解放されるため、再取得する
  useEffect(() => {
    if (!screenLock) return;

    const handleVisibilityChange = async () => {
      if (
        document.visibilityState === "visible" &&
        shouldContinueRef.current &&
        !wakeLockRef.current
      ) {
        wakeLockRef.current = await requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [screenLock]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      shouldContinueRef.current = false;
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      if (keepAliveRef.current) {
        stopKeepAlive(keepAliveRef.current);
        keepAliveRef.current = null;
      }
      if (wakeLockRef.current) {
        releaseWakeLock(wakeLockRef.current);
        wakeLockRef.current = null;
      }
    };
  }, []);

  return {
    isListening,
    isSupported,
    start,
    stop,
    error,
    transcript,
  };
}
