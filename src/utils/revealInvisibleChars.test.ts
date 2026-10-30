// @vitest-environment node
/**
 * Tests for revealInvisibleChars: every character that draws nothing becomes a
 * visible escape, and every character that draws something is left alone.
 */
import { describe, expect, it } from "vitest";
import { revealInvisibleChars } from "./revealInvisibleChars";

describe("revealInvisibleChars", () => {
  it.each([
    ["right-to-left override", 0x202e],
    ["first strong isolate", 0x2068],
    ["Arabic letter mark", 0x061c],
    ["zero-width space", 0x200b],
    ["zero-width joiner", 0x200d],
    ["word joiner", 0x2060],
    ["byte-order mark", 0xfeff],
    ["soft hyphen", 0x00ad],
    ["Mongolian vowel separator", 0x180e],
    ["tag letter", 0xe0041],
    ["variation selector 16", 0xfe0f],
    ["ideographic variation selector", 0xe0100],
    ["combining grapheme joiner", 0x034f],
    ["Hangul filler", 0x3164],
    ["halfwidth Hangul filler", 0xffa0],
    ["Khmer inherent vowel", 0x17b4],
    ["Braille blank", 0x2800],
  ])("reveals a %s", (_label, cp) => {
    const hex = cp.toString(16).toUpperCase();
    expect(revealInvisibleChars(`a${String.fromCodePoint(cp)}b`)).toBe(`a\\u{${hex}}b`);
  });

  it("reveals every occurrence, not only the first", () => {
    expect(revealInvisibleChars("​1​")).toBe("\\u{200B}1\\u{200B}");
  });

  it.each([
    ["empty text", ""],
    ["ASCII", "fetch('/ok')"],
    ["a precomposed accent", "héllo"],
    ["a combining accent", "héllo"],
    ["CJK", "你好，世界"],
    ["an emoji with a skin-tone modifier", "👍🏽"],
    ["ideographic and no-break spaces", "a　b c"],
    ["Arabic and Hebrew letters", "مرحبا שלום"],
  ])("leaves %s unchanged", (_label, text) => {
    expect(revealInvisibleChars(text)).toBe(text);
  });
});
