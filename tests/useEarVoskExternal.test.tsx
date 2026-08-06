import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEarVosk } from "../src";

// vosk-browser は WASM を Worker で動かすため、テストでは偽物に差し替える。
// 見たいのは「マイクを触らないこと」「フレームの流し込み」「区切りの抑止」であって
// 認識そのものではない。
type Handlers = {
  error?: (m: { error: string }) => void;
  partialresult?: (m: { result: { partial: string } }) => void;
  result?: (m: { result: { text: string } }) => void;
};

class FakeRecognizer {
  static instances: FakeRecognizer[] = [];
  finalResultCalls = 0;
  frames: { length: number; sampleRate: number }[] = [];
  handlers: Handlers = {};
  removed = false;

  constructor(public sampleRate: number) {
    FakeRecognizer.instances.push(this);
  }

  acceptWaveform(): void {}

  acceptWaveformFloat(buffer: Float32Array, sampleRate: number): void {
    this.frames.push({ length: buffer.length, sampleRate });
  }

  on(event: keyof Handlers, cb: unknown): void {
    this.handlers[event] = cb as never;
  }

  remove(): void {
    this.removed = true;
  }

  retrieveFinalResult(): void {
    this.finalResultCalls += 1;
  }
}

const fakeModel = {
  KaldiRecognizer: FakeRecognizer,
  terminate: (): void => {},
};

vi.mock("vosk-browser", () => ({
  createModel: vi.fn(async () => fakeModel),
}));

const MODELS = { "ja-JP": "http://models.test/ja.tar.gz" };
const WAKE_WORDS = ["食事記録を開始", "飲料記録を開始"];

function renderExternal(onWakeWord: (word: string, text: string) => void) {
  return renderHook(() =>
    useEarVosk({
      audioSource: "external",
      models: MODELS,
      onWakeWord,
      similarityThreshold: 0.8,
      wakeWords: WAKE_WORDS,
    }),
  );
}

/** いま生きている認識器に確定結果を届ける。 */
function emitResult(text: string): void {
  const live = FakeRecognizer.instances.filter((r) => !r.removed);
  // 対象が0件のまま「発火しなかった」を確かめても何も検証していない。
  expect(live.length).toBeGreaterThan(0);
  for (const r of live) r.handlers.result?.({ result: { text } });
}

describe("useEarVosk (audioSource: external)", () => {
  beforeEach(() => {
    FakeRecognizer.instances = [];
    // ensureModels は進捗のために本体を読むが、失敗しても続行する作りなので
    // 中身は返さなくてよい。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no network in tests");
      }),
    );
  });

  it("start() がマイクを取りに行かない", async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: { getUserMedia },
    });

    const { result } = renderExternal(vi.fn());
    await act(async () => {
      await result.current.start();
    });

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.status).toBe("listening");
  });

  it("start() より前の pushAudio は捨てる", async () => {
    const { result } = renderExternal(vi.fn());

    act(() => {
      result.current.pushAudio(new Float32Array(512), 48000);
    });
    expect(FakeRecognizer.instances).toHaveLength(0);

    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.pushAudio(new Float32Array(512), 48000);
    });
    expect(FakeRecognizer.instances).toHaveLength(1);
    expect(FakeRecognizer.instances[0].frames).toEqual([
      { length: 512, sampleRate: 48000 },
    ]);
  });

  it("サンプルレートが変わったら認識器を作り直す", async () => {
    const { result } = renderExternal(vi.fn());
    await act(async () => {
      await result.current.start();
    });

    act(() => {
      result.current.pushAudio(new Float32Array(256), 48000);
      result.current.pushAudio(new Float32Array(256), 48000);
    });
    expect(FakeRecognizer.instances).toHaveLength(1);
    expect(FakeRecognizer.instances[0].sampleRate).toBe(48000);

    act(() => {
      result.current.pushAudio(new Float32Array(256), 16000);
    });
    expect(FakeRecognizer.instances).toHaveLength(2);
    expect(FakeRecognizer.instances[0].removed).toBe(true);
    expect(FakeRecognizer.instances[1].sampleRate).toBe(16000);
  });

  it("flush() で切った区切りの確定テキストではウェイクワードを発火しない", async () => {
    const onWakeWord = vi.fn();
    const { result } = renderExternal(onWakeWord);
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.pushAudio(new Float32Array(256), 48000);
    });

    // 供給を止めている間に溜まっていた発話が、再開の区切りで出てくる状況。
    act(() => {
      result.current.flush();
    });
    expect(FakeRecognizer.instances[0].finalResultCalls).toBe(1);

    act(() => {
      emitResult("食事記録を開始");
    });
    expect(onWakeWord).not.toHaveBeenCalled();

    // 抑止は区切りの1回だけ。次に本当に検出したぶんは通す。
    act(() => {
      emitResult("飲料記録を開始");
    });
    expect(onWakeWord).toHaveBeenCalledTimes(1);
    expect(onWakeWord).toHaveBeenCalledWith("飲料記録を開始", "飲料記録を開始");
  });

  it("stop() のあとの pushAudio は認識器へ届かない", async () => {
    const { result } = renderExternal(vi.fn());
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.pushAudio(new Float32Array(256), 48000);
    });
    const recognizer = FakeRecognizer.instances[0];

    act(() => {
      result.current.stop();
    });
    act(() => {
      result.current.pushAudio(new Float32Array(256), 48000);
    });

    expect(recognizer.removed).toBe(true);
    expect(recognizer.frames).toHaveLength(1);
    expect(FakeRecognizer.instances).toHaveLength(1);
  });
});
