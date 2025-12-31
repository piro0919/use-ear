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
  const languageIndexRef = useRef(0);
  const shouldContinueRef = useRef(false);

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
    normalizedWakeWordsRef.current = normalizedWakeWords;
    normalizedStopWordsRef.current = normalizedStopWords;
    languagesRef.current = languages;
  }, [
    onWakeWord,
    onStopWord,
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

  const checkStopWord = useCallback(
    (text: string): boolean => {
      const normalizedText = caseSensitive ? text : text.toLowerCase();

      for (const stopWord of normalizedStopWordsRef.current) {
        const normalizedWord = caseSensitive
          ? stopWord.word
          : stopWord.word.toLowerCase();
        if (normalizedText.includes(normalizedWord)) {
          onStopWordRef.current?.(stopWord.word, text);
          stopRef.current();
          return true;
        }
      }
      return false;
    },
    [caseSensitive],
  );

  const checkWakeWord = useCallback(
    (text: string) => {
      const normalizedText = caseSensitive ? text : text.toLowerCase();

      // まずストップワードをチェック
      if (checkStopWord(text)) {
        return false;
      }

      for (const wakeWord of normalizedWakeWordsRef.current) {
        const normalizedWord = caseSensitive
          ? wakeWord.word
          : wakeWord.word.toLowerCase();
        if (normalizedText.includes(normalizedWord)) {
          onWakeWordRef.current(wakeWord.word, text);
          return true;
        }
      }
      return false;
    },
    [caseSensitive, checkStopWord],
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

      recognition.onstart = () => {
        setIsListening(true);
        setError(null);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const results = Array.from(event.results);
        const latestResult = results[results.length - 1];

        if (latestResult) {
          const text = latestResult[0].transcript;
          setTranscript(text);
          checkWakeWord(text);
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
    [continuous, checkWakeWord],
  );

  const start = useCallback(async () => {
    shouldContinueRef.current = true;
    languageIndexRef.current = 0;

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
