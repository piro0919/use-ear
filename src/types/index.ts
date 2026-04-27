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
  /**
   * 1認識結果あたりに評価する代替候補の最大数 (default: 3)
   * Web Speech API はトップ候補以外の代替認識を返す。多くするほど検出感度が上がるが、
   * 誤検出のリスクも上がる
   */
  maxAlternatives?: number;
  /**
   * テキスト正規化を有効にするか (default: true)
   * 有効時は照合前に以下の処理を行う:
   * - 空白除去
   * - NFKC (全角↔半角)
   * - カタカナ→ひらがな
   * - 「を」→「お」 (助詞の同音異字吸収)
   */
  normalize?: boolean;
  /**
   * 認識テキスト更新時に呼ばれるコールバック
   * 観測・デバッグ用途で使用する。alternatives にはトップ候補以下の代替認識が入る
   */
  onTranscript?: (
    text: string,
    info: { alternatives: string[]; isFinal: boolean },
  ) => void;
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
