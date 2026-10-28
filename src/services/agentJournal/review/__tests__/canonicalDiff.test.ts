// WI-AL2.1 (WI-AL2.1a) — The canonical diff pipeline (diff-match-patch with semantic cleanup, or the O(n) trimmed fallback → scalar-boundary repair → merge of touching changes → line-start placement of pure insertions and deletions → canonical assertion): maximal changed runs, never splitting a surrogate pair, never two changes that touch, never a same-line merge of independent changes; lone surrogates are refused INVALID_TEXT.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { exactCanonicalDiff, trimmedCanonicalDiff } from "../canonicalDiff";
import { InvalidTextError, applyChanges, assertCanonical, type TextChange } from "../textChanges";
import unicode from "@/test/fixtures/agentJournal/unicode.json";

const change = (fromA: number, toA: number, fromB: number, toB: number): TextChange => ({ fromA, toA, fromB, toB });
const PIPELINES = { exact: exactCanonicalDiff, trimmed: trimmedCanonicalDiff } as const;

describe("R42 Unicode fixtures", () => {
  it.each(Object.entries(PIPELINES))("a😀b → a😁b (%s): one change covering the whole emoji", (_, diff) => {
    // diff-match-patch alone keeps "a\uD83D" and replaces only the low surrogate.
    const changes = diff("a😀b", "a😁b");
    expect(changes).toEqual([change(1, 3, 1, 3)]);
    expect("a😀b".slice(1, 3)).toBe("😀");
    expect("a😁b".slice(1, 3)).toBe("😁");
  });

  it("😀😀 → 😁😁: the two widened changes touch and merge into one", () => {
    expect(exactCanonicalDiff("😀😀", "😁😁")).toEqual([change(0, 4, 0, 4)]);
    expect(trimmedCanonicalDiff("😀😀", "😁😁")).toEqual([change(0, 4, 0, 4)]);
  });

  it("ab12cd → aX12Yd: two independent changes on one line stay two", () => {
    expect(exactCanonicalDiff("ab12cd", "aX12Yd")).toEqual([change(1, 2, 1, 2), change(4, 5, 4, 5)]);
  });

  it("the trimmed fallback is one changed run for the same input", () => {
    expect(trimmedCanonicalDiff("ab12cd", "aX12Yd")).toEqual([change(1, 5, 1, 5)]);
  });

  it("CJK: a replaced ideograph is one BMP-unit change", () => {
    expect(exactCanonicalDiff("甲乙丙丁", "甲乙戊丁")).toEqual([change(2, 3, 2, 3)]);
  });

  it("CJK supplementary plane: a replaced 𠀀-range character is widened to its pair", () => {
    // U+20000 and U+20001 share their high surrogate.
    const changes = exactCanonicalDiff("甲\u{20000}乙", "甲\u{20001}乙");
    expect(changes).toEqual([change(1, 3, 1, 3)]);
  });

  it("RTL: an appended Hebrew word is a pure insertion placed at its leftmost slide position", () => {
    // " עולם" can slide one unit left (the final ם repeats); no line start in range → leftmost.
    expect(exactCanonicalDiff("שלום", "שלום עולם")).toEqual([change(3, 3, 3, 8)]);
  });

  it("RTL mixed with an emoji ZWJ sequence keeps every boundary on a code point", () => {
    const a = "مرحبا 👩‍👩‍👧 שלום";
    const b = "مرحبا 👩‍👩‍👦 שלום!";
    const changes = exactCanonicalDiff(a, b);
    assertCanonical(a, b, changes);
    expect(applyChanges(a, b, changes)).toBe(b);
  });
});

describe("canonical placement of pure insertions and deletions", () => {
  it("an inserted line goes to the last line start of its slide range", () => {
    expect(exactCanonicalDiff("a\nb\n", "a\nb\nb\n")).toEqual([change(4, 4, 4, 6)]);
  });

  it("a deleted line goes to the last line start of its slide range", () => {
    expect(exactCanonicalDiff("x\ny\ny\n", "x\ny\n")).toEqual([change(4, 6, 4, 4)]);
  });

  it("the trimmed fallback places it the same way", () => {
    expect(trimmedCanonicalDiff("a\nb\n", "a\nb\nb\n")).toEqual([change(4, 4, 4, 6)]);
    expect(trimmedCanonicalDiff("x\ny\ny\n", "x\ny\n")).toEqual([change(4, 6, 4, 4)]);
  });

  it("never inside a surrogate pair", () => {
    // Slide range [0, 2]; 1 is mid-pair; 0 is the document start.
    expect(exactCanonicalDiff("😀", "😀😀")).toEqual([change(0, 0, 0, 2)]);
  });

  it("never so that it touches a neighbouring change", () => {
    const a = "q\nz\nz\nw";
    const b = "Q\nz\nw";
    const changes = exactCanonicalDiff(a, b);
    assertCanonical(a, b, changes);
    for (let i = 1; i < changes.length; i++) expect(changes[i].fromA).toBeGreaterThan(changes[i - 1].toA);
  });
});

describe("edges", () => {
  it.each(Object.entries(PIPELINES))("%s: equal texts have no change, empty sides are one change", (_, diff) => {
    expect(diff("", "")).toEqual([]);
    expect(diff("same", "same")).toEqual([]);
    expect(diff("", "abc")).toEqual([change(0, 0, 0, 3)]);
    expect(diff("abc", "")).toEqual([change(0, 3, 0, 0)]);
  });

  it.each(Object.entries(PIPELINES))("%s: a lone surrogate on either side is INVALID_TEXT", (_, diff) => {
    for (const [a, b] of [["a\uD83Db", "ab"], ["ab", "a\uDE00b"]]) {
      let thrown: unknown = null;
      try {
        diff(a, b);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(InvalidTextError);
      expect((thrown as InvalidTextError).code).toBe("INVALID_TEXT");
    }
  });

  it.each(unicode.cases.map((c) => [c.name, c] as const))("unicode.json %s: refused exactly when not well-formed", (_, c) => {
    const text = String.fromCharCode(...c.utf16);
    const run = () => exactCanonicalDiff("x", text);
    if (c.wellFormed) expect(run).not.toThrow();
    else expect(run).toThrow(InvalidTextError);
  });

  it("U+FFFD is ordinary text", () => {
    expect(exactCanonicalDiff("a�b", "a?b")).toEqual([change(1, 2, 1, 2)]);
  });
});

describe("assertCanonical fails loud", () => {
  it.each([
    ["splits a pair", "a😀b", "a😁b", [change(2, 3, 2, 3)]],
    ["touching changes", "abcd", "aXYd", [change(1, 2, 1, 2), change(2, 3, 2, 3)]],
    ["an empty change", "ab", "ab", [change(1, 1, 1, 1)]],
    ["does not reconstruct b", "abc", "aXc", [change(0, 1, 0, 1)]],
    ["out of order", "abcd", "aXcY", [change(3, 4, 3, 4), change(1, 2, 1, 2)]],
  ] as const)("%s", (_, a, b, changes) => {
    expect(() => assertCanonical(a, b, changes)).toThrow(/not canonical/);
  });
});

/** mulberry32: a seeded, exactly reproducible stand-in for Math.random. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("seeded fuzz over emoji, CJK, RTL and newlines", () => {
  const ALPHABET = ["a", "b", "\n", "😀", "😁", "\u{20000}", "甲", "ש", "👩‍👧", " "];
  const text = (rand: () => number, n: number) =>
    Array.from({ length: n }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join("");
  const mutate = (rand: () => number, s: string) => {
    const units = Array.from(s); // by code point, so the result stays well-formed
    for (let k = 0; k < 3; k++) {
      const at = Math.floor(rand() * (units.length + 1));
      units.splice(at, Math.floor(rand() * 3), ...Array.from(text(rand, Math.floor(rand() * 3))));
    }
    return units.join("");
  };

  it.each(Object.entries(PIPELINES))("%s output is canonical for 400 seeded pairs", (_, diff) => {
    const rand = seeded(2026);
    for (let i = 0; i < 400; i++) {
      const a = text(rand, Math.floor(rand() * 24));
      const b = mutate(rand, a);
      const changes = diff(a, b);
      assertCanonical(a, b, changes);
      if (diff === trimmedCanonicalDiff) expect(changes.length).toBeLessThanOrEqual(1);
    }
  });
});
