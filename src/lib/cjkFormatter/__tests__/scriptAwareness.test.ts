// @vitest-environment node
/**
 * WI-CJKF5.2 / WI-CJKF5.3 — the rules whose correct output differs by script.
 *
 * The ellipsis was the same in every language: `...` plus a trailing space.
 * That is wrong for two of the three:
 *
 * | | Chinese | Japanese | Korean | Latin |
 * |---|---|---|---|---|
 * | glyph | `……` (GB/T 15834) | `……` (JIS X 4051) | `…` | `...` |
 * | space after | no | no | no | yes |
 *
 * So `然后...继续` came back as `然后... 继续` — wrong glyph AND a space that
 * fullwidth punctuation never takes.
 *
 * The script is decided from the ellipsis's ADJACENT characters, not from the
 * document. A document-level guess would rewrite the `...` inside an English
 * quotation in a Chinese file, which is the same segment-granularity trap the
 * plan records for `fixSlashSpacing` — segments span everything between
 * protected regions, so "the document's script" is usually the whole file's.
 * Adjacency is the same principle WI-CJKF3.1 uses for punctuation width.
 *
 * @coordinates-with ../rules/universal.ts — normalizeEllipsis
 * @coordinates-with ../rules/script.ts — adjacentScript
 * @module lib/cjkFormatter/__tests__/scriptAwareness.test
 */
import { describe, it, expect } from "vitest";
import { adjacentScript } from "../rules/script";
import { normalizeEllipsis } from "../rules";
import { formatMarkdown } from "../formatter";
import { DEFAULT_CJK_FORMATTING } from "../types";

const C = DEFAULT_CJK_FORMATTING;
const fmt = (s: string) => formatMarkdown(s, C, { preserveTwoSpaceHardBreaks: true });
const corner = { ...C, cjkCornerQuotes: true };

describe("adjacentScript", () => {
  it.each([
    ["Han on the left", "中...", 1, 4, "han"],
    ["Han on the right", "...中", 0, 3, "han"],
    ["Hiragana", "そして...", 3, 6, "han"],
    ["Katakana", "カナ...", 2, 5, "han"],
    ["Bopomofo", "ㄅ...", 1, 4, "han"],
    ["Hangul", "그리고...", 3, 6, "hangul"],
    ["Latin both sides", "wait...ok", 4, 7, "none"],
    ["nothing either side", "...", 0, 3, "none"],
    ["Han beyond the BMP", "𠮷...", 2, 5, "han"],
  ])("%s", (_label, text, start, end, expected) => {
    expect(adjacentScript(text, start, end)).toBe(expected);
  });

  it("does not look across whitespace", () => {
    // Same rule as punctuation width: a mark separated by a space is not
    // attached to what is beyond it.
    expect(adjacentScript("中文 ... English", 3, 6)).toBe("none");
  });

  it("does not look across a line break", () => {
    expect(adjacentScript("中文\n...", 3, 6)).toBe("none");
  });
});

describe("WI-CJKF5.2 — the ellipsis takes the shape its script uses", () => {
  it("Chinese gets 六点省略号 and no trailing space", () => {
    expect(normalizeEllipsis("然后...继续")).toBe("然后……继续");
  });

  it("Japanese gets the same", () => {
    expect(normalizeEllipsis("そして...続く")).toBe("そして……続く");
  });

  it("Korean gets a single ellipsis character", () => {
    expect(normalizeEllipsis("그리고...계속")).toBe("그리고…계속");
  });

  it("Latin keeps three dots and gains its space", () => {
    expect(normalizeEllipsis("wait...ok")).toBe("wait... ok");
  });

  it("normalises the spaced form in CJK context too", () => {
    expect(normalizeEllipsis("等等. . .继续")).toBe("等等……继续");
  });

  it("normalises the spaced form in Latin context as before", () => {
    expect(normalizeEllipsis("wait. . .ok")).toBe("wait... ok");
  });

  it("leaves an already-correct 六点省略号 alone", () => {
    expect(normalizeEllipsis("然后……继续")).toBe("然后……继续");
  });

  it("handles an ellipsis at end of line without adding a space", () => {
    expect(normalizeEllipsis("然后...\n下一行")).toBe("然后……\n下一行");
  });

  it("handles an ellipsis at end of text", () => {
    expect(normalizeEllipsis("然后...")).toBe("然后……");
  });

  it("handles an ellipsis at the start of text", () => {
    expect(normalizeEllipsis("...然后")).toBe("……然后");
  });

  it("does not split a run of four or more dots", () => {
    expect(normalizeEllipsis("wait.... ok")).toBe("wait.... ok");
  });

  it("leaves an ellipsis inside inline code alone, end to end", () => {
    expect(fmt("中文 `a...b` 结束")).toBe("中文 `a...b` 结束");
  });

  it("does nothing when the rule is off", () => {
    expect(formatMarkdown("然后...继续", { ...C, ellipsisNormalization: false })).toBe("然后...继续");
  });

  it("is idempotent for every shape", () => {
    for (const input of ["然后...继续", "そして...続く", "그리고...계속", "wait...ok", "等等. . .继续"]) {
      const once = fmt(input);
      expect(fmt(once)).toBe(once);
    }
  });
});

describe("WI-CJKF5.3 — corner quotes reach kana-only Japanese", () => {
  // The published guide claims Hiragana-only and Katakana-only content stays
  // curly. That table describes `convertToCJKCornerQuotes`, which is NOT in
  // the pipeline — `applyContextualQuotes` is, and it uses `isCJKLetter`,
  // which covers kana. The code is right and the docs are wrong; these pin the
  // real behaviour so the docs can be corrected against it.
  it.each([
    ["hiragana only", '彼は"こんにちは"と言った', "彼は「こんにちは」と言った"],
    ["katakana only", '"カタカナ"です', "「カタカナ」です"],
    ["with kanji", '彼は"日本語"と言った', "彼は「日本語」と言った"],
    ["chinese", '他说"中文"结束', "他说「中文」结束"],
  ])("%s", (_label, input, expected) => {
    expect(formatMarkdown(input, corner, { preserveTwoSpaceHardBreaks: true })).toBe(expected);
  });

  it("leaves Korean quotes straight — Hangul is not a corner-quote context", () => {
    expect(formatMarkdown('그는 "한글"이라고', corner, { preserveTwoSpaceHardBreaks: true })).toBe(
      '그는 "한글"이라고'
    );
  });

  it("leaves pure Latin quotes straight", () => {
    expect(formatMarkdown('he said "hello"', corner, { preserveTwoSpaceHardBreaks: true })).toBe(
      'he said "hello"'
    );
  });
});

describe("Korean is deliberately untouched by the spacing rules", () => {
  // Korean uses native word spacing, and particles attach directly to the
  // preceding word — `VMark에는`, not `VMark 에는`. Inserting a space is a
  // GRAMMAR error, not a typography preference. Hangul is therefore absent
  // from CJK_NO_KOREAN and from isCJKLetter, and this pins that so a future
  // reader who notices the omission does not "fix" it.
  it.each([
    ["particles after Latin", "VMark에는 Python으로 iPhone을"],
    ["halfwidth punctuation", "한국어입니다,그리고 English."],
    ["sentence period", "한국어입니다."],
    ["question mark", "무엇입니까?"],
    ["parentheses", "한국어(설명)입니다"],
    ["straight quotes", '그는 "안녕"이라고 했다'],
  ])("%s", (_label, input) => {
    expect(fmt(input)).toBe(input);
  });

  it("still formats Han that appears in a Korean document", () => {
    expect(fmt("한국어 中文,English 혼합")).toBe("한국어 中文，English 혼합");
  });
});
