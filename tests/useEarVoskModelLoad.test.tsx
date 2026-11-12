import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// モデルの読み込みの成否だけを見る。vosk-browser の createModel は "error" を受けても
// 解決しないので、フックは Model を直に作って "load" と "error" の両方を待つ。
// ここが壊れると、モデルの URL が 404 のときに "loading-model" のまま止まる。
type Outcome =
  | { kind: "error"; error: string }
  | { kind: "load"; result: boolean };

let outcome: Outcome = { kind: "load", result: true };
const terminated: string[] = [];

class FakeRecognizer {
  acceptWaveform(): void {}
  acceptWaveformFloat(): void {}
  on(): void {}
  remove(): void {}
  retrieveFinalResult(): void {}
}

class FakeModel {
  KaldiRecognizer = FakeRecognizer;
  // Model.terminate() は Worker に止まれと送るだけで、読み込めていない Worker はそれで落ちる。
  // 失敗したときは Worker を直に止めることを見る。
  worker = { terminate: (): number => terminated.push(this.url) };

  constructor(public url: string) {}

  on(
    event: string,
    cb: (m: { error?: string; result?: boolean }) => void,
  ): void {
    const now = outcome;
    if (event !== now.kind) return;
    queueMicrotask(() =>
      cb(now.kind === "error" ? { error: now.error } : { result: now.result }),
    );
  }

  terminate(): void {
    terminated.push(`model.terminate: ${this.url}`);
  }
}

vi.mock("vosk-browser", () => ({ Model: FakeModel }));

const MODEL_URL = "http://models.test/ja.tar.gz";

// 読み込んだモデルは言語ごとにモジュールの中で共有され、しばらく残る。前のテストの
// モデルを使い回さないよう、テストごとにモジュールを読み直す。
async function renderVosk() {
  vi.resetModules();
  const { useEarVosk } = await import("../src");
  return renderHook(() =>
    useEarVosk({
      audioSource: "external",
      models: { "ja-JP": MODEL_URL },
      onWakeWord: () => {},
      wakeWords: ["食事記録を開始"],
    }),
  );
}

describe("useEarVosk のモデルの読み込み", () => {
  beforeEach(() => {
    outcome = { kind: "load", result: true };
    terminated.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no network in tests");
      }),
    );
  });

  it("Worker が error を送ったら error になり、Worker を止める", async () => {
    outcome = { kind: "error", error: "HTTP error! status: 404" };
    const { result } = await renderVosk();

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toContain("HTTP error! status: 404");
    expect(terminated).toEqual([MODEL_URL]);
  });

  it("load が失敗を返したら error になる", async () => {
    outcome = { kind: "load", result: false };
    const { result } = await renderVosk();

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(terminated).toEqual([MODEL_URL]);
  });

  it("load が成功したら聞き始め、Worker は止めない", async () => {
    const { result } = await renderVosk();

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.status).toBe("listening"));
    expect(result.current.error).toBeNull();
    expect(terminated).toEqual([]);
  });

  it("失敗のあと start() し直すと、もう一度読み込む", async () => {
    outcome = { kind: "error", error: "HTTP error! status: 404" };
    const { result } = await renderVosk();
    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.status).toBe("error"));

    outcome = { kind: "load", result: true };
    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.status).toBe("listening"));
  });
});
