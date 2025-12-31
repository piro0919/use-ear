export interface WakeWord {
  /** ウェイクワード */
  word: string;
  /** このワード用の言語設定 */
  language: string;
}

export type WakeWordInput = string | WakeWord;

export interface UseEarOptions {
  /** 検出するウェイクアップワードの配列 */
  wakeWords: WakeWordInput[];
  /** ウェイクワード検出時に呼ばれるコールバック */
  onWakeWord: (word: string, transcript: string) => void;
  /** リッスンを停止するワードの配列 */
  stopWords?: WakeWordInput[];
  /** ストップワード検出時に呼ばれるコールバック */
  onStopWord?: (word: string, transcript: string) => void;
  /** 継続的にリッスンするか (default: true) */
  continuous?: boolean;
  /** デフォルトの言語設定 (default: 'ja-JP') */
  language?: string;
  /** 大文字小文字を区別しない (default: false) */
  caseSensitive?: boolean;
  /** モバイルでバックグラウンド時もオーディオセッションを維持する (default: true) */
  keepAlive?: boolean;
  /** 画面の自動ロックを防ぐ (default: false) */
  screenLock?: boolean;
}

export interface UseEarReturn {
  /** 現在リッスン中かどうか */
  isListening: boolean;
  /** ブラウザがWeb Speech APIをサポートしているか */
  isSupported: boolean;
  /** リッスンを開始 */
  start: () => void;
  /** リッスンを停止 */
  stop: () => void;
  /** エラー情報 */
  error: Error | null;
  /** 最後に認識されたテキスト */
  transcript: string;
}
