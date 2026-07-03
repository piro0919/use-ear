import type { WakeWordInput } from "../types";

/**
 * テキスト正規化: ウェイクワード照合の安定性を上げるための前処理
 * - 空白除去 (認識エンジンが任意位置にスペースを挿入することがある)
 * - NFKC: 全角↔半角統一
 * - カタカナ→ひらがな: 「ばいたる」「バイタル」を等価に扱う
 * - 「を」→「お」: 助詞の同音異字 (認識エンジンは「を/お」を頻繁に取り違える)
 *
 * NOTE: 認識バックエンド (Web Speech API / vosk-browser 等) から独立した純粋関数。
 */
export const normalizeText = (s: string): string =>
  s
    .replace(/\s+/g, "")
    .normalize("NFKC")
    .replace(/[ァ-ヶ]/g, (m) => String.fromCharCode(m.charCodeAt(0) - 0x60))
    .replace(/を/g, "お");

// Levenshtein 距離 (1文字の挿入/削除/置換の最小回数)
export const levenshtein = (a: string, b: string): number => {
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
export const fuzzyIncludes = (
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

export interface NormalizedWakeWord {
  word: string;
  language: string;
}

export const normalizeWakeWords = (
  wakeWords: WakeWordInput[],
  defaultLanguage: string,
): NormalizedWakeWord[] =>
  wakeWords.map((w) =>
    typeof w === "string" ? { word: w, language: defaultLanguage } : w,
  );

export const getUniqueLanguages = (
  wakeWords: NormalizedWakeWord[],
): string[] => [...new Set(wakeWords.map((w) => w.language))];

export interface MatchOptions {
  caseSensitive?: boolean;
  normalize?: boolean;
  similarityThreshold?: number;
}

/**
 * 照合用にテキストを変換: 大文字小文字 + 任意の正規化処理。
 */
export const transformForMatch = (
  s: string,
  { caseSensitive = false, normalize = true }: MatchOptions = {},
): string => {
  let out = caseSensitive ? s : s.toLowerCase();
  if (normalize) out = normalizeText(out);
  return out;
};

/**
 * 変換済みテキストに変換済みワードが含まれるかを判定する。
 * similarityThreshold が有効ならあいまい一致、無効なら完全部分一致。
 */
export const matchWord = (
  text: string,
  word: string,
  similarityThreshold?: number,
): boolean => {
  if (
    typeof similarityThreshold === "number" &&
    similarityThreshold > 0 &&
    similarityThreshold <= 1
  ) {
    return fuzzyIncludes(text, word, similarityThreshold);
  }
  return text.includes(word);
};
