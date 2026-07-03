// Web Speech API 版 (追加依存なし)
export { useEar } from "./hooks/useEar";
export type {
  UseEarVoskOptions,
  UseEarVoskReturn,
  VoskMetrics,
  VoskStatus,
} from "./hooks/useEarVosk";
// オンデバイス STT 版 (vosk-browser を optional peer dependency として要求)
export { DEFAULT_MODELS, useEarVosk } from "./hooks/useEarVosk";
export type {
  MatchOptions,
  NormalizedWakeWord,
} from "./hooks/wakeWordMatch";
// 共有の照合ユーティリティ (認識バックエンド非依存の純粋関数)
export {
  fuzzyIncludes,
  getUniqueLanguages,
  levenshtein,
  matchWord,
  normalizeText,
  normalizeWakeWords,
  transformForMatch,
} from "./hooks/wakeWordMatch";
export type {
  UseEarOptions,
  UseEarReturn,
  WakeWord,
  WakeWordInput,
} from "./types";
