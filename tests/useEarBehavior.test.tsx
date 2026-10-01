import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEar } from "../src";

/** A stand-in for the browser's SpeechRecognition that tests drive by hand. */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 1;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string; message: string }) => void) | null = null;
  onresult: ((event: unknown) => void) | null = null;
  onstart: (() => void) | null = null;
  started = false;
  stopped = false;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start(): void {
    this.started = true;
    this.onstart?.();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.onend?.();
  }

  abort(): void {
    this.stop();
  }

  /** Pretend a result arrived. `alternatives[0]` is the top candidate. */
  result(alternatives: string[], { isFinal = true, index = 0 } = {}): void {
    const result = Object.assign(
      alternatives.map((transcript) => ({ confidence: 1, transcript })),
      { isFinal },
    );
    const results: unknown[] = [];
    results[index] = result;
    this.onresult?.({ resultIndex: index, results });
  }

  /** Browsers fire `error`, then `end`. */
  fail(error: string): void {
    this.onerror?.({ error, message: "" });
    this.stopped = true;
    this.onend?.();
  }

  /** The session ended on its own, as browsers do after a pause. */
  end(): void {
    this.stopped = true;
    this.onend?.();
  }
}

function latest(): FakeRecognition {
  const instance = FakeRecognition.instances.at(-1);
  if (!instance) throw new Error("no recognition was created");
  return instance;
}

beforeEach(() => {
  FakeRecognition.instances = [];
  vi.stubGlobal("SpeechRecognition", FakeRecognition);
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition =
    FakeRecognition;
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown })
    .SpeechRecognition;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function startedHook(
  options: Partial<Parameters<typeof useEar>[0]> = {},
) {
  const onWakeWord = vi.fn();
  const hook = renderHook(() =>
    useEar({
      keepAlive: false,
      onWakeWord,
      wakeWords: ["こんにちは"],
      ...options,
    }),
  );
  await act(async () => {
    await hook.result.current.start();
  });
  return { ...hook, onWakeWord };
}

describe("useEar with a speech engine", () => {
  it("reports supported and starts a continuous, interim session", async () => {
    const { result } = await startedHook({ language: "ja-JP" });
    expect(result.current.isSupported).toBe(true);
    expect(result.current.isListening).toBe(true);
    expect(latest()).toMatchObject({
      continuous: true,
      interimResults: true,
      lang: "ja-JP",
      maxAlternatives: 3,
    });
  });

  it("fires onWakeWord once per result, matching normalized text", async () => {
    const { onWakeWord, result } = await startedHook();
    act(() => latest().result(["コンニチハ 世界"], { isFinal: false }));
    act(() => latest().result(["コンニチハ 世界"], { isFinal: true }));

    expect(onWakeWord).toHaveBeenCalledTimes(1);
    expect(onWakeWord).toHaveBeenCalledWith("こんにちは", "コンニチハ 世界");
    expect(result.current.transcript).toBe("コンニチハ 世界");
  });

  it("matches against the alternatives too", async () => {
    const { onWakeWord } = await startedHook();
    act(() => latest().result(["こんばんは", "こんにちは"]));
    expect(onWakeWord).toHaveBeenCalledWith("こんにちは", "こんにちは");
  });

  it("ignores an empty wake word instead of firing on any speech", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { onWakeWord } = await startedHook({ wakeWords: ["", "こんにちは"] });
    act(() => latest().result(["なにか別の話"]));
    expect(onWakeWord).not.toHaveBeenCalled();
    act(() => latest().result(["こんにちは"]));
    expect(onWakeWord).toHaveBeenCalledWith("こんにちは", "こんにちは");
    warn.mockRestore();
  });

  it("does not fire on unrelated speech", async () => {
    const { onWakeWord } = await startedHook();
    act(() => latest().result(["さようなら"]));
    expect(onWakeWord).not.toHaveBeenCalled();
  });

  it("stops on a stop word without restarting", async () => {
    vi.useFakeTimers();
    const onStopWord = vi.fn();
    const { onWakeWord, result } = await startedHook({
      onStopWord,
      stopWords: ["おわり"],
    });
    await act(async () => latest().result(["おわり こんにちは"]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(onStopWord).toHaveBeenCalledWith("おわり", "おわり こんにちは");
    expect(onWakeWord).not.toHaveBeenCalled();
    expect(result.current.isListening).toBe(false);
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it("restarts after a session ends, rotating through the languages", async () => {
    vi.useFakeTimers();
    await startedHook({
      wakeWords: [
        { language: "ja-JP", word: "こんにちは" },
        { language: "en-US", word: "hello" },
      ],
    });
    expect(latest().lang).toBe("ja-JP");

    act(() => latest().end());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(latest().lang).toBe("en-US");
  });

  it("restarts after a recoverable error", async () => {
    vi.useFakeTimers();
    await startedHook();
    act(() => latest().fail("no-speech"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(FakeRecognition.instances).toHaveLength(2);
  });

  it.each(["not-allowed", "service-not-allowed", "audio-capture"])(
    "stops for good and surfaces %s",
    async (code) => {
      vi.useFakeTimers();
      const { result } = await startedHook();
      await act(async () => latest().fail(code));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      // Restarting would fail the same way every 100 ms.
      expect(FakeRecognition.instances).toHaveLength(1);
      expect(result.current.isListening).toBe(false);
      expect(result.current.error?.message).toBe(
        `Speech recognition error: ${code}`,
      );
    },
  );

  it("does not restart after stop()", async () => {
    vi.useFakeTimers();
    const { result } = await startedHook();
    await act(async () => {
      await result.current.stop();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(result.current.isListening).toBe(false);
  });
});

describe("useEar screen wake lock", () => {
  class FakeSentinel extends EventTarget {
    released = false;
    async release(): Promise<void> {
      if (this.released) return;
      this.released = true;
      this.dispatchEvent(new Event("release"));
    }
  }

  let sentinels: FakeSentinel[];
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sentinels = [];
    request = vi.fn(async () => {
      const sentinel = new FakeSentinel();
      sentinels.push(sentinel);
      return sentinel;
    });
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request },
    });
  });

  afterEach(() => {
    delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
  });

  function setVisibility(state: DocumentVisibilityState): void {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => state,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  it("takes the lock again when the page comes back after the browser released it", async () => {
    await startedHook({ screenLock: true });
    expect(request).toHaveBeenCalledTimes(1);

    // The browser releases the lock on its own when the page is hidden.
    await act(async () => {
      setVisibility("hidden");
      await sentinels[0]?.release();
    });
    await act(async () => {
      setVisibility("visible");
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(sentinels[1]?.released).toBe(false);
  });

  it("does not take a second lock while the first is still held", async () => {
    await startedHook({ screenLock: true });
    await act(async () => {
      setVisibility("visible");
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("releases the lock on stop and does not take it back", async () => {
    const { result } = await startedHook({ screenLock: true });
    await act(async () => {
      await result.current.stop();
    });
    expect(sentinels[0]?.released).toBe(true);

    await act(async () => {
      setVisibility("visible");
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
