import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEar } from "../src";

describe("useEar", () => {
  it("returns the expected shape", () => {
    const { result } = renderHook(() => useEar({ wakeWords: ["hello"] }));
    expect(result.current).toMatchObject({
      isListening: expect.any(Boolean),
      isSupported: expect.any(Boolean),
      start: expect.any(Function),
      stop: expect.any(Function),
    });
  });

  it("reports unsupported when SpeechRecognition is missing", () => {
    expect(
      (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition,
    ).toBeUndefined();
    const { result } = renderHook(() => useEar({ wakeWords: ["hello"] }));
    expect(result.current.isSupported).toBe(false);
  });

  it("start() is a no-op when unsupported", () => {
    const { result } = renderHook(() => useEar({ wakeWords: ["hello"] }));
    expect(() => result.current.start()).not.toThrow();
    expect(result.current.isListening).toBe(false);
  });

  it("accepts object wake-word inputs", () => {
    const { result } = renderHook(() =>
      useEar({ wakeWords: [{ word: "hello", language: "en-US" }] }),
    );
    expect(result.current.isSupported).toBe(false);
  });
});
