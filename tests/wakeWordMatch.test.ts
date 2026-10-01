import { describe, expect, it } from "vitest";
import {
  fuzzyIncludes,
  getUniqueLanguages,
  levenshtein,
  matchWord,
  normalizeText,
  normalizeWakeWords,
  transformForMatch,
} from "../src";

describe("normalizeText", () => {
  it("removes whitespace the engine inserts", () => {
    expect(normalizeText("こん に ち\tは")).toBe("こんにちは");
  });

  it("folds full-width to half-width", () => {
    expect(normalizeText("ＡＢＣ１２３")).toBe("ABC123");
  });

  it("turns katakana into hiragana", () => {
    expect(normalizeText("バイタル")).toBe("ばいたる");
  });

  it("reads を as お", () => {
    expect(normalizeText("でんきをつけて")).toBe("でんきおつけて");
  });
});

describe("levenshtein", () => {
  it.each([
    ["", "", 0],
    ["", "abc", 3],
    ["abc", "", 3],
    ["kitten", "sitting", 3],
    ["こんにちは", "こんにちわ", 1],
    ["same", "same", 0],
  ])("%j to %j is %i", (a, b, distance) => {
    expect(levenshtein(a, b)).toBe(distance);
  });
});

describe("fuzzyIncludes", () => {
  it("accepts an exact substring without scoring", () => {
    expect(fuzzyIncludes("ねえこんにちはさん", "こんにちは", 1)).toBe(true);
  });

  it("accepts a near miss inside longer text above the threshold", () => {
    // One substitution in five characters is 0.8 similar.
    expect(fuzzyIncludes("あのこんにちわです", "こんにちは", 0.8)).toBe(true);
  });

  it("rejects it when the threshold is stricter", () => {
    expect(fuzzyIncludes("あのこんにちわです", "こんにちは", 0.85)).toBe(false);
  });

  it("absorbs a dropped character", () => {
    expect(fuzzyIncludes("おーけーぐるぐる", "おーけーぐーぐる", 0.8)).toBe(
      true,
    );
  });

  it("raises the threshold for words of three characters or fewer", () => {
    // 2 of 3 characters is 0.67 similar, under the forced 0.9.
    expect(fuzzyIncludes("あいう", "あいえ", 0.5)).toBe(false);
  });

  it("compares the whole text when it is shorter than the word", () => {
    expect(fuzzyIncludes("こんにち", "こんにちは", 0.8)).toBe(true);
    expect(fuzzyIncludes("こん", "こんにちは", 0.8)).toBe(false);
  });

  // Locks in current behavior: the substring check runs first, and every string
  // contains "". An empty wake word therefore fires on any speech.
  it("treats an empty word as contained in anything", () => {
    expect(fuzzyIncludes("なにか", "", 0.5)).toBe(true);
    expect(fuzzyIncludes("", "", 0.5)).toBe(true);
  });
});

describe("matchWord", () => {
  it("requires an exact substring without a threshold", () => {
    expect(matchWord("あのこんにちわです", "こんにちは")).toBe(false);
    expect(matchWord("あのこんにちはです", "こんにちは")).toBe(true);
  });

  it("goes fuzzy with a threshold in (0, 1]", () => {
    expect(matchWord("あのこんにちわです", "こんにちは", 0.8)).toBe(true);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "ignores the out-of-range threshold %s",
    (threshold) => {
      expect(matchWord("あのこんにちわです", "こんにちは", threshold)).toBe(
        false,
      );
    },
  );
});

describe("transformForMatch", () => {
  it("lowercases and normalizes by default", () => {
    expect(transformForMatch("Hey ＡＩ")).toBe("heyai");
  });

  it("keeps case when asked", () => {
    expect(transformForMatch("Hey", { caseSensitive: true })).toBe("Hey");
  });

  it("skips normalization when turned off", () => {
    expect(transformForMatch("ハイ ハイ", { normalize: false })).toBe(
      "ハイ ハイ",
    );
  });
});

describe("normalizeWakeWords / getUniqueLanguages", () => {
  it("gives plain strings the default language", () => {
    expect(
      normalizeWakeWords(
        ["hello", { language: "ja-JP", word: "やあ" }],
        "en-US",
      ),
    ).toEqual([
      { language: "en-US", word: "hello" },
      { language: "ja-JP", word: "やあ" },
    ]);
  });

  it("lists each language once, in first-seen order", () => {
    expect(
      getUniqueLanguages([
        { language: "ja-JP", word: "a" },
        { language: "en-US", word: "b" },
        { language: "ja-JP", word: "c" },
      ]),
    ).toEqual(["ja-JP", "en-US"]);
  });
});
