import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEarVosk } from "../src";

// 周囲で人が話し続ける環境では Vosk が発話を確定しないまま partial が伸び続け、
// 新しい発話が直前の文脈に引きずられてウェイクワードが検出できなくなる。
// ここで見るのは「伸びきったら認識器を作り直すこと」と、
// 「作り直した先に音声が届き、検出が戻ること」。認識そのものは偽物で置き換える。

type Handlers = {
  error?: (m: { error: string }) => void;
  partialresult?: (m: { result: { partial: string } }) => void;
  result?: (m: { result: { text: string } }) => void;
};

class FakeRecognizer {
  static instances: FakeRecognizer[] = [];
  finalResultCalls = 0;
  frames: number[] = [];
  handlers: Handlers = {};
  removed = false;

  constructor(public sampleRate: number) {
    FakeRecognizer.instances.push(this);
  }

  acceptWaveform(buffer: { length: number }): void {
    this.frames.push(buffer.length);
  }

  acceptWaveformFloat(buffer: Float32Array): void {
    this.frames.push(buffer.length);
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
const WAKE_WORDS = ["食事記録を開始"];

/** 差し替えは setTimeout(0) 越しに走る。実タイマーなので1周待つ。 */
async function settleRecreate(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function live(): FakeRecognizer[] {
  return FakeRecognizer.instances.filter((r) => !r.removed);
}

/** いま生きている認識器へ partial を届ける。 */
function emitPartial(text: string): void {
  const targets = live();
  // 対象が0件のまま「作り直された」を確かめても何も検証していない。
  expect(targets.length).toBeGreaterThan(0);
  for (const r of targets)
    r.handlers.partialresult?.({ result: { partial: text } });
}

function renderExternal(
  onWakeWord: (word: string, text: string) => void,
  maxPartialChars?: number,
) {
  return renderHook(() =>
    useEarVosk({
      audioSource: "external",
      maxPartialChars,
      models: MODELS,
      onWakeWord,
      similarityThreshold: 0.8,
      wakeWords: WAKE_WORDS,
    }),
  );
}

beforeEach(() => {
  FakeRecognizer.instances = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("no network in tests");
    }),
  );
});

describe("伸びきった partial で認識器を作り直す (external)", () => {
  it("上限を超えたら作り直し、古い認識器は解放する", async () => {
    const { result } = renderExternal(vi.fn(), 40);
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.pushAudio(new Float32Array(256), 48000);
    });
    const first = FakeRecognizer.instances[0];

    // 上限に届かないうちは作り直さない。
    act(() => {
      emitPartial("あ".repeat(39));
    });
    await settleRecreate();
    expect(FakeRecognizer.instances).toHaveLength(1);
    expect(first.removed).toBe(false);

    act(() => {
      emitPartial("あ".repeat(40));
    });
    await settleRecreate();
    expect(FakeRecognizer.instances).toHaveLength(2);
    expect(first.removed).toBe(true);
    expect(FakeRecognizer.instances[1].sampleRate).toBe(48000);
  });

  it("作り直したあとの音声は新しい認識器に届く", async () => {
    const { result } = renderExternal(vi.fn(), 40);
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.pushAudio(new Float32Array(256), 48000);
    });

    act(() => {
      emitPartial("あ".repeat(40));
    });
    await settleRecreate();

    act(() => {
      result.current.pushAudio(new Float32Array(128), 48000);
    });
    const [first, second] = FakeRecognizer.instances;
    expect(second.frames).toEqual([128]);
    // 解放した側へ流し続けると、同じ音が二重に入って認識が伸びる。
    expect(first.frames).toEqual([256]);
  });

  it("作り直した直後のウェイクワードを飲み込まない", async () => {
    const onWakeWord = vi.fn();
    const { result } = renderExternal(onWakeWord, 40);
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.pushAudio(new Float32Array(256), 48000);
    });

    // 伸びきった partial にウェイクワードが乗っていた場合、その1回で発火済みが立つ。
    act(() => {
      emitPartial(`${"あ".repeat(40)}食事記録を開始`);
    });
    expect(onWakeWord).toHaveBeenCalledTimes(1);
    await settleRecreate();

    // 作り直した認識器は何も抱えていない。発火済みを持ち越すと、次に本当に言った
    // ウェイクワードを1回ぶん飲み込む。
    act(() => {
      emitPartial("食事記録を開始");
    });
    expect(onWakeWord).toHaveBeenCalledTimes(2);
    expect(onWakeWord).toHaveBeenLastCalledWith(
      "食事記録を開始",
      "食事記録を開始",
    );
  });

  it("伸びきった partial の末尾に乗ったウェイクワードは切る前に拾う", async () => {
    const onWakeWord = vi.fn();
    const { result } = renderExternal(onWakeWord, 40);
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.pushAudio(new Float32Array(256), 48000);
    });

    act(() => {
      emitPartial(`${"あ".repeat(40)}食事記録を開始`);
    });
    expect(onWakeWord).toHaveBeenCalledTimes(1);
    await settleRecreate();
    expect(FakeRecognizer.instances).toHaveLength(2);
  });

  it("maxPartialChars: 0 なら作り直さない", async () => {
    const { result } = renderExternal(vi.fn(), 0);
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.pushAudio(new Float32Array(256), 48000);
    });

    act(() => {
      emitPartial("あ".repeat(400));
    });
    await settleRecreate();
    expect(FakeRecognizer.instances).toHaveLength(1);
    expect(FakeRecognizer.instances[0].removed).toBe(false);
  });

  it("stop() のあとに作り直しは走らない", async () => {
    const { result } = renderExternal(vi.fn(), 40);
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.pushAudio(new Float32Array(256), 48000);
    });

    act(() => {
      emitPartial("あ".repeat(40));
      result.current.stop();
    });
    await settleRecreate();
    expect(FakeRecognizer.instances).toHaveLength(1);
  });
});

describe("伸びきった partial で認識器を作り直す (microphone)", () => {
  let processor: { onaudioprocess: ((e: unknown) => void) | null };

  function stubAudioEnvironment(): void {
    processor = { onaudioprocess: null };
    const node = {
      connect: (): void => {},
      disconnect: (): void => {},
      ...processor,
    };
    // onaudioprocess は本体が代入するので、同じ器を見せる。
    Object.defineProperty(node, "onaudioprocess", {
      get: () => processor.onaudioprocess,
      set: (v: ((e: unknown) => void) | null) => {
        processor.onaudioprocess = v;
      },
    });

    class FakeAudioContext {
      destination = {};
      sampleRate = 16000;
      state = "running";
      close = async (): Promise<void> => {};
      createGain = (): unknown => ({
        connect: (): void => {},
        disconnect: (): void => {},
        gain: { value: 1 },
      });
      createMediaStreamSource = (): unknown => ({
        connect: (): void => {},
        disconnect: (): void => {},
      });
      createScriptProcessor = (): unknown => node;
      resume = async (): Promise<void> => {};
    }

    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({
          getTracks: (): unknown[] => [{ stop: (): void => {} }],
        })),
      },
    });
  }

  it("作り直したあとも、音声グラフから新しい認識器へ音が届く", async () => {
    stubAudioEnvironment();
    const onWakeWord = vi.fn();
    const { result } = renderHook(() =>
      useEarVosk({
        maxPartialChars: 40,
        models: MODELS,
        onWakeWord,
        similarityThreshold: 0.8,
        wakeWords: WAKE_WORDS,
      }),
    );

    await act(async () => {
      await result.current.start();
    });
    expect(processor.onaudioprocess).not.toBeNull();

    const feed = (length: number): void => {
      processor.onaudioprocess?.({
        inputBuffer: {
          getChannelData: (): Float32Array => new Float32Array(length),
          length,
        },
      });
    };

    act(() => {
      feed(256);
    });
    expect(FakeRecognizer.instances).toHaveLength(1);

    act(() => {
      emitPartial("あ".repeat(40));
    });
    await settleRecreate();
    expect(FakeRecognizer.instances).toHaveLength(2);

    // 音声を流す側は起動時に作った配列を掴んだままなので、配列ごと差し替えると
    // ここで新しい認識器に音が届かなくなる。
    act(() => {
      feed(128);
    });
    const [first, second] = FakeRecognizer.instances;
    expect(second.frames).toEqual([128]);
    expect(first.frames).toEqual([256]);

    act(() => {
      emitPartial("食事記録を開始");
    });
    expect(onWakeWord).toHaveBeenCalledTimes(1);
  });
});
