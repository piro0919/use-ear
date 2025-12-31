"use client";

import { useId, useState } from "react";
import { PWAPrompt } from "react-ios-pwa-prompt";
import { useEar } from "../hooks/useEar";
import { usePwa } from "../hooks/usePwa";
import type { WakeWord } from "../types";

interface DetectedWord {
  id: string;
  word: string;
  transcript: string;
  time: string;
  type: "wake" | "stop";
}

const defaultWakeWords: WakeWord[] = [
  { word: "ヘイ", language: "ja-JP" },
  { word: "オーケー", language: "ja-JP" },
  { word: "hello", language: "en-US" },
  { word: "hey", language: "en-US" },
];

const defaultStopWords: WakeWord[] = [
  { word: "ストップ", language: "ja-JP" },
  { word: "stop", language: "en-US" },
];

const languageOptions = [
  { value: "ja-JP", label: "Japanese" },
  { value: "en-US", label: "English" },
  { value: "zh-CN", label: "Chinese" },
  { value: "ko-KR", label: "Korean" },
  { value: "es-ES", label: "Spanish" },
  { value: "fr-FR", label: "French" },
  { value: "de-DE", label: "German" },
];

export default function Home() {
  const baseId = useId();
  const [detectedWords, setDetectedWords] = useState<DetectedWord[]>([]);
  const [wakeWords, setWakeWords] = useState<WakeWord[]>(defaultWakeWords);
  const [stopWords, setStopWords] = useState<WakeWord[]>(defaultStopWords);
  const [newWord, setNewWord] = useState("");
  const [newLanguage, setNewLanguage] = useState("ja-JP");
  const [wordType, setWordType] = useState<"wake" | "stop">("wake");
  const [screenLock, setScreenLock] = useState(true);

  const {
    canInstall,
    install,
    isInstalled,
    isSupported: isPwaSupported,
  } = usePwa();

  const { isListening, isSupported, start, stop, error, transcript } = useEar({
    wakeWords,
    onWakeWord: (word, fullTranscript) => {
      setDetectedWords((prev) => [
        {
          id: `${baseId}-${Date.now()}`,
          word,
          transcript: fullTranscript,
          time: new Date().toLocaleTimeString(),
          type: "wake",
        },
        ...prev,
      ]);
    },
    stopWords,
    onStopWord: (word, fullTranscript) => {
      setDetectedWords((prev) => [
        {
          id: `${baseId}-${Date.now()}`,
          word,
          transcript: fullTranscript,
          time: new Date().toLocaleTimeString(),
          type: "stop",
        },
        ...prev,
      ]);
    },
    screenLock,
  });

  const addWord = () => {
    const trimmed = newWord.trim();
    if (!trimmed) return;
    const targetList = wordType === "wake" ? wakeWords : stopWords;
    if (
      targetList.some((w) => w.word.toLowerCase() === trimmed.toLowerCase())
    ) {
      return;
    }
    const newWordObj = { word: trimmed, language: newLanguage };
    if (wordType === "wake") {
      setWakeWords((prev) => [...prev, newWordObj]);
    } else {
      setStopWords((prev) => [...prev, newWordObj]);
    }
    setNewWord("");
  };

  const removeWakeWord = (wordToRemove: string) => {
    setWakeWords((prev) => prev.filter((w) => w.word !== wordToRemove));
  };

  const removeStopWord = (wordToRemove: string) => {
    setStopWords((prev) => prev.filter((w) => w.word !== wordToRemove));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900">
      <div className="mx-auto max-w-2xl px-6 py-16">
        {/* Header */}
        <div className="mb-12 text-center">
          <h1 className="mb-2 text-4xl font-bold tracking-tight text-white">
            useEar
          </h1>
          <p className="text-zinc-400">
            Wake word detection with Web Speech API
          </p>

          {/* PWA Install Button */}
          {isInstalled ? (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-4 py-2 text-sm text-emerald-400">
              <svg
                className="h-4 w-4"
                fill="currentColor"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              Installed as PWA
            </div>
          ) : isPwaSupported ? (
            <button
              type="button"
              onClick={install}
              disabled={!canInstall}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-zinc-700/50 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              {canInstall ? "Install App" : "Waiting for install prompt..."}
            </button>
          ) : null}
        </div>

        {/* Main Control */}
        <div className="mb-8 flex flex-col items-center">
          <button
            type="button"
            onClick={isListening ? stop : start}
            disabled={!isSupported || wakeWords.length === 0}
            className={`group relative h-32 w-32 rounded-full transition-all duration-300 ${
              !isSupported || wakeWords.length === 0
                ? "cursor-not-allowed bg-zinc-700"
                : isListening
                  ? "bg-gradient-to-br from-red-500 to-red-600 shadow-lg shadow-red-500/30 hover:shadow-red-500/50"
                  : "bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:scale-105"
            }`}
          >
            {isListening && (
              <>
                <span className="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-20" />
                <span className="absolute inset-2 animate-pulse rounded-full bg-red-400 opacity-10" />
              </>
            )}

            <span className="relative flex flex-col items-center justify-center text-white">
              {!isSupported ? (
                <>
                  <svg
                    className="mb-1 h-8 w-8"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                    />
                  </svg>
                  <span className="text-xs">Not Supported</span>
                </>
              ) : isListening ? (
                <>
                  <svg
                    className="mb-1 h-8 w-8"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <rect x="6" y="6" width="4" height="12" rx="1" />
                    <rect x="14" y="6" width="4" height="12" rx="1" />
                  </svg>
                  <span className="text-xs font-medium">Listening</span>
                </>
              ) : (
                <>
                  <svg
                    className="mb-1 h-8 w-8"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                    />
                  </svg>
                  <span className="text-xs font-medium">Start</span>
                </>
              )}
            </span>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-center text-sm text-red-400">
            {error.message}
          </div>
        )}

        {/* Words Config */}
        <div className="mb-6 rounded-2xl border border-zinc-700/50 bg-zinc-800/30 p-6">
          {/* Add new word */}
          <div className="mb-4 flex gap-2">
            <input
              type="text"
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addWord()}
              placeholder={
                wordType === "wake" ? "Add wake word..." : "Add stop word..."
              }
              disabled={isListening}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
            />
            <select
              value={newLanguage}
              onChange={(e) => setNewLanguage(e.target.value)}
              disabled={isListening}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
            >
              {languageOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              value={wordType}
              onChange={(e) => setWordType(e.target.value as "wake" | "stop")}
              disabled={isListening}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
            >
              <option value="wake">Wake</option>
              <option value="stop">Stop</option>
            </select>
            <button
              type="button"
              onClick={addWord}
              disabled={isListening || !newWord.trim()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 transition-colors"
            >
              Add
            </button>
          </div>

          {/* Wake Words */}
          <div className="mb-4">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Wake Words
            </div>
            <div className="flex flex-wrap gap-2">
              {wakeWords.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No wake words configured.
                </p>
              ) : (
                wakeWords.map((w) => (
                  <span
                    key={w.word}
                    className="group flex items-center gap-2 rounded-full border border-emerald-700/50 bg-emerald-900/20 py-1.5 pl-4 pr-2 text-sm text-emerald-300"
                  >
                    {w.word}
                    <span className="text-xs text-emerald-500/70">
                      {w.language.split("-")[0]}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeWakeWord(w.word)}
                      disabled={isListening}
                      className="flex h-5 w-5 items-center justify-center rounded-full text-emerald-500/70 hover:bg-emerald-700/50 hover:text-emerald-300 disabled:opacity-50 transition-colors"
                    >
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Stop Words */}
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Stop Words
            </div>
            <div className="flex flex-wrap gap-2">
              {stopWords.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No stop words configured.
                </p>
              ) : (
                stopWords.map((w) => (
                  <span
                    key={w.word}
                    className="group flex items-center gap-2 rounded-full border border-red-700/50 bg-red-900/20 py-1.5 pl-4 pr-2 text-sm text-red-300"
                  >
                    {w.word}
                    <span className="text-xs text-red-500/70">
                      {w.language.split("-")[0]}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeStopWord(w.word)}
                      disabled={isListening}
                      className="flex h-5 w-5 items-center justify-center rounded-full text-red-500/70 hover:bg-red-700/50 hover:text-red-300 disabled:opacity-50 transition-colors"
                    >
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Options */}
        <div className="mb-6 flex items-center justify-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={screenLock}
              onChange={(e) => setScreenLock(e.target.checked)}
              disabled={isListening}
              className="h-4 w-4 rounded border-zinc-600 bg-zinc-700 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
            />
            <span>Prevent screen sleep</span>
          </label>
        </div>

        {/* Transcript */}
        <div className="mb-6 rounded-2xl border border-zinc-700/50 bg-zinc-800/30 p-6">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
            Transcript
          </div>
          <div className="min-h-[48px] text-lg text-zinc-200">
            {transcript || (
              <span className="text-zinc-600">Waiting for speech...</span>
            )}
          </div>
        </div>

        {/* Detection Log */}
        <div className="rounded-2xl border border-zinc-700/50 bg-zinc-800/30 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Detection Log
            </div>
            {detectedWords.length > 0 && (
              <button
                type="button"
                onClick={() => setDetectedWords([])}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          <div className="max-h-[240px] min-h-[100px] overflow-y-auto">
            {detectedWords.length === 0 ? (
              <div className="flex h-[100px] items-center justify-center text-zinc-600">
                No detections yet
              </div>
            ) : (
              <div className="space-y-2">
                {detectedWords.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-3 rounded-lg bg-zinc-700/30 px-4 py-3"
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        entry.type === "stop"
                          ? "bg-red-500/20 text-red-400"
                          : "bg-emerald-500/20 text-emerald-400"
                      }`}
                    >
                      {entry.type === "stop" ? (
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="h-4 w-4"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                          aria-hidden="true"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-medium ${
                            entry.type === "stop"
                              ? "text-red-400"
                              : "text-emerald-400"
                          }`}
                        >
                          {entry.word}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            entry.type === "stop"
                              ? "bg-red-500/20 text-red-400"
                              : "bg-emerald-500/20 text-emerald-400"
                          }`}
                        >
                          {entry.type === "stop" ? "STOP" : "WAKE"}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {entry.time}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-sm text-zinc-400">
                        {entry.transcript}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-zinc-600">
          Built with Web Speech API
        </div>
      </div>

      {/* iOS PWA Prompt */}
      <PWAPrompt
        promptOnVisit={1}
        timesToShow={3}
        permanentlyHideOnDismiss={false}
      />
    </div>
  );
}
