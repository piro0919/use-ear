"use client";

// ─────────────────────────────────────────────────────────────────────────────
// POC 検証ページ: オンデバイス STT (vosk-browser) 版のウェイクワード検知
//
// 実機 (iPhone Safari / Android Chrome) で以下を確認するための画面:
//   1. earcon (ピコ音) が鳴らないか  → 耳で確認
//   2. 連続リッスンが途切れないか      → Partial が途切れず更新され続けるか
//   3. 任意の日本語ワードを拾えるか    → Detection Log
//   4. CPU/メインスレッド負荷・発熱    → Metrics (avg/max frame ms, chunk ms)
// ─────────────────────────────────────────────────────────────────────────────

import { useId, useRef, useState } from "react";
import { useEarVosk } from "../../hooks/useEarVosk";
import type { WakeWord } from "../../types";

interface DetectedWord {
  id: string;
  word: string;
  transcript: string;
  time: string;
  type: "wake" | "stop";
}

const defaultWakeWords: WakeWord[] = [
  { word: "こんにちは", language: "ja-JP" },
  { word: "おはよう", language: "ja-JP" },
  { word: "ねえ", language: "ja-JP" },
];

const defaultStopWords: WakeWord[] = [{ word: "ストップ", language: "ja-JP" }];

const fmtBytes = (b: number | null): string => {
  if (b == null) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

const fmtMs = (n: number | null, digits = 1): string =>
  n == null ? "—" : `${n.toFixed(digits)} ms`;

function Metric({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg bg-zinc-800/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div
        className={`text-lg font-semibold tabular-nums ${
          warn ? "text-amber-400" : "text-zinc-100"
        }`}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-zinc-600">{hint}</div>}
    </div>
  );
}

export default function VoskPocPage() {
  const baseId = useId();
  const seqRef = useRef(0);
  const [detectedWords, setDetectedWords] = useState<DetectedWord[]>([]);
  const [wakeWords, setWakeWords] = useState<WakeWord[]>(defaultWakeWords);
  const [stopWords, setStopWords] = useState<WakeWord[]>(defaultStopWords);
  const [newWord, setNewWord] = useState("");
  const [wordType, setWordType] = useState<"wake" | "stop">("wake");
  const [useGrammar, setUseGrammar] = useState(false);
  const [fuzzy, setFuzzy] = useState(true);

  const {
    status,
    isListening,
    loadProgress,
    start,
    stop,
    error,
    transcript,
    partial,
    metrics,
  } = useEarVosk({
    wakeWords,
    stopWords,
    useGrammar,
    similarityThreshold: fuzzy ? 0.7 : undefined,
    onWakeWord: (word, fullTranscript) => {
      setDetectedWords((prev) => [
        {
          id: `${baseId}-${seqRef.current++}`,
          word,
          transcript: fullTranscript,
          time: new Date().toLocaleTimeString(),
          type: "wake",
        },
        ...prev,
      ]);
    },
    onStopWord: (word, fullTranscript) => {
      setDetectedWords((prev) => [
        {
          id: `${baseId}-${seqRef.current++}`,
          word,
          transcript: fullTranscript,
          time: new Date().toLocaleTimeString(),
          type: "stop",
        },
        ...prev,
      ]);
    },
  });

  const addWord = () => {
    const trimmed = newWord.trim();
    if (!trimmed) return;
    const obj = { word: trimmed, language: "ja-JP" };
    if (wordType === "wake") {
      if (!wakeWords.some((w) => w.word === trimmed)) {
        setWakeWords((p) => [...p, obj]);
      }
    } else if (!stopWords.some((w) => w.word === trimmed)) {
      setStopWords((p) => [...p, obj]);
    }
    setNewWord("");
  };

  const statusLabel: Record<string, string> = {
    idle: "Idle",
    "loading-model": "Loading model…",
    "requesting-mic": "Requesting mic…",
    listening: "Listening (on-device)",
    error: "Error",
  };

  const frameWarn = (metrics.avgFrameMs ?? 0) > 22; // 60fps=16.7ms。22ms超で軽いジャンク
  const frameBad = (metrics.maxFrameMs ?? 0) > 120;

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900">
      <div className="mx-auto max-w-2xl px-6 py-12">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mb-2 inline-block rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-300">
            POC · on-device STT (vosk-browser)
          </div>
          <h1 className="mb-1 text-3xl font-bold tracking-tight text-white">
            useEar / Vosk
          </h1>
          <p className="text-sm text-zinc-400">
            No Web Speech API · No earcon · Continuous · Fully client-side
          </p>
        </div>

        {/* How-to (real device checklist) */}
        <details className="mb-6 rounded-xl border border-zinc-700/50 bg-zinc-800/30 p-4 text-sm text-zinc-400">
          <summary className="cursor-pointer font-medium text-zinc-300">
            実機テストの見方
          </summary>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            <li>
              <b>earcon</b>: Start してもピコ音が鳴らなければ ✓（OS
              音声認識を使っていない証拠）
            </li>
            <li>
              <b>連続性</b>: 話している間 Partial
              が途切れず更新され続ければ、セッション再起動なしの連続リッスン ✓
            </li>
            <li>
              <b>精度</b>: ウェイクワードを言って Detection Log に載れば ✓。
              Fuzzy を切ると完全一致のみになる
            </li>
            <li>
              <b>負荷</b>: Avg/Max frame ms が跳ねる = メインスレッドの詰まり
              (ScriptProcessorNode の影響)。発熱・電池は端末側で体感確認
            </li>
          </ul>
        </details>

        {/* Main control */}
        <div className="mb-6 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={isListening ? stop : start}
            disabled={status === "loading-model" || status === "requesting-mic"}
            className={`h-28 w-28 rounded-full font-medium text-white transition-all ${
              isListening
                ? "bg-gradient-to-br from-red-500 to-red-600 shadow-lg shadow-red-500/30"
                : "bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-lg shadow-indigo-500/30 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
            }`}
          >
            {status === "loading-model" || status === "requesting-mic"
              ? "…"
              : isListening
                ? "Stop"
                : "Start"}
          </button>
          <div className="text-sm text-zinc-400">
            {statusLabel[status] ?? status}
            {status === "loading-model" && loadProgress != null && (
              <span className="ml-1 tabular-nums">
                {Math.round(loadProgress * 100)}%
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-center text-sm text-red-400">
            {error.message}
          </div>
        )}

        {/* Metrics */}
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric
            label="Model load"
            value={fmtMs(metrics.modelLoadMs, 0)}
            hint={fmtBytes(metrics.modelBytes)}
          />
          <Metric label="Uptime" value={`${metrics.uptimeSec}s`} />
          <Metric
            label="Avg frame"
            value={fmtMs(metrics.avgFrameMs)}
            hint="16.7ms=60fps"
            warn={frameWarn}
          />
          <Metric
            label="Max frame"
            value={fmtMs(metrics.maxFrameMs, 0)}
            hint="jank spike"
            warn={frameBad}
          />
          <Metric label="Audio chunks" value={String(metrics.audioChunks)} />
          <Metric label="Avg chunk" value={fmtMs(metrics.avgChunkMs, 2)} />
          <Metric label="JS heap" value={fmtBytes(metrics.heapBytes)} />
          <Metric label="Earcon" value="none" hint="by design" />
        </div>

        {/* Live transcript / partial */}
        <div className="mb-6 rounded-2xl border border-zinc-700/50 bg-zinc-800/30 p-5">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Partial (continuity)
          </div>
          <div className="mb-3 min-h-[28px] text-base text-indigo-300">
            {partial || <span className="text-zinc-600">…</span>}
          </div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Final
          </div>
          <div className="min-h-[28px] text-lg text-zinc-100">
            {transcript || <span className="text-zinc-600">—</span>}
          </div>
        </div>

        {/* Config */}
        <div className="mb-6 rounded-2xl border border-zinc-700/50 bg-zinc-800/30 p-5">
          <div className="mb-3 flex gap-2">
            <input
              type="text"
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addWord()}
              placeholder={
                wordType === "wake" ? "ウェイクワード" : "ストップワード"
              }
              disabled={isListening}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            />
            <select
              value={wordType}
              onChange={(e) => setWordType(e.target.value as "wake" | "stop")}
              disabled={isListening}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            >
              <option value="wake">Wake</option>
              <option value="stop">Stop</option>
            </select>
            <button
              type="button"
              onClick={addWord}
              disabled={isListening || !newWord.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Add
            </button>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {wakeWords.map((w) => (
              <span
                key={w.word}
                className="flex items-center gap-2 rounded-full border border-indigo-700/50 bg-indigo-900/20 py-1 pl-3 pr-2 text-sm text-indigo-300"
              >
                {w.word}
                <button
                  type="button"
                  onClick={() =>
                    setWakeWords((p) => p.filter((x) => x.word !== w.word))
                  }
                  disabled={isListening}
                  className="text-indigo-500/70 hover:text-indigo-200 disabled:opacity-50"
                >
                  ×
                </button>
              </span>
            ))}
            {stopWords.map((w) => (
              <span
                key={w.word}
                className="flex items-center gap-2 rounded-full border border-red-700/50 bg-red-900/20 py-1 pl-3 pr-2 text-sm text-red-300"
              >
                {w.word}
                <button
                  type="button"
                  onClick={() =>
                    setStopWords((p) => p.filter((x) => x.word !== w.word))
                  }
                  disabled={isListening}
                  className="text-red-500/70 hover:text-red-200 disabled:opacity-50"
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                checked={fuzzy}
                onChange={(e) => setFuzzy(e.target.checked)}
                disabled={isListening}
                className="h-4 w-4 rounded border-zinc-600 bg-zinc-700 text-indigo-500"
              />
              <span>Fuzzy match (0.7)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                checked={useGrammar}
                onChange={(e) => setUseGrammar(e.target.checked)}
                disabled={isListening}
                className="h-4 w-4 rounded border-zinc-600 bg-zinc-700 text-indigo-500"
              />
              <span>Grammar mode (実験的)</span>
            </label>
          </div>
        </div>

        {/* Detection log */}
        <div className="rounded-2xl border border-zinc-700/50 bg-zinc-800/30 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              Detection Log
            </div>
            {detectedWords.length > 0 && (
              <button
                type="button"
                onClick={() => setDetectedWords([])}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Clear
              </button>
            )}
          </div>
          <div className="max-h-[240px] min-h-[80px] overflow-y-auto">
            {detectedWords.length === 0 ? (
              <div className="flex h-[80px] items-center justify-center text-zinc-600">
                No detections yet
              </div>
            ) : (
              <div className="space-y-2">
                {detectedWords.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-3 rounded-lg bg-zinc-700/30 px-3 py-2"
                  >
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        e.type === "stop"
                          ? "bg-red-500/20 text-red-400"
                          : "bg-indigo-500/20 text-indigo-300"
                      }`}
                    >
                      {e.type === "stop" ? "STOP" : "WAKE"}
                    </span>
                    <span className="font-medium text-zinc-100">{e.word}</span>
                    <span className="flex-1 truncate text-sm text-zinc-500">
                      {e.transcript}
                    </span>
                    <span className="text-xs text-zinc-600">{e.time}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 text-center text-xs text-zinc-600">
          Model: vosk-model-small-ja-0.22 (Apache-2.0) ·{" "}
          <a href="/" className="text-zinc-400 underline hover:text-zinc-200">
            ← Web Speech API demo
          </a>
        </div>
      </div>
    </div>
  );
}
