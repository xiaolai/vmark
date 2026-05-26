// "Copy unwrapped" — joins display-wrapped terminal lines back into logical
// flow. Opt-in: the user selects what they know is one paragraph; we collapse
// the hard newlines a program inserted at the terminal width.

import { describe, it, expect } from "vitest";
import { unwrapTerminalSelection } from "./unwrapSelection";

describe("unwrapTerminalSelection — Latin text", () => {
  it("joins wrapped lines of one paragraph with single spaces", () => {
    const input = [
      "Translation: Search for existing solutions on the market that",
      "help non-native English speakers learn English in order to",
      "teach their children English.",
    ].join("\n");
    expect(unwrapTerminalSelection(input)).toBe(
      "Translation: Search for existing solutions on the market that help non-native English speakers learn English in order to teach their children English.",
    );
  });

  it("returns a single line unchanged", () => {
    expect(unwrapTerminalSelection("just one line")).toBe("just one line");
  });

  it("returns empty string for empty input", () => {
    expect(unwrapTerminalSelection("")).toBe("");
  });

  it("trims trailing whitespace from each wrapped line before joining", () => {
    // xterm pads cells; hard-wrapped lines often carry trailing spaces.
    const input = "the market that   \nhelp non-native";
    expect(unwrapTerminalSelection(input)).toBe("the market that help non-native");
  });

  it("does not double-space when a wrapped line already ends mid-word", () => {
    expect(unwrapTerminalSelection("foo\nbar")).toBe("foo bar");
  });

  it("handles CRLF line endings", () => {
    expect(unwrapTerminalSelection("foo\r\nbar")).toBe("foo bar");
  });
});

describe("unwrapTerminalSelection — paragraph breaks", () => {
  it("preserves a blank line as a paragraph break", () => {
    const input = [
      "First paragraph wraps",
      "across two lines.",
      "",
      "Second paragraph also",
      "wraps.",
    ].join("\n");
    expect(unwrapTerminalSelection(input)).toBe(
      "First paragraph wraps across two lines.\n\nSecond paragraph also wraps.",
    );
  });

  it("collapses multiple consecutive blank lines into one break", () => {
    const input = "para one\n\n\n\npara two";
    expect(unwrapTerminalSelection(input)).toBe("para one\n\npara two");
  });

  it("ignores leading and trailing blank lines", () => {
    const input = "\n\nhello\nworld\n\n";
    expect(unwrapTerminalSelection(input)).toBe("hello world");
  });
});

describe("unwrapTerminalSelection — CJK text", () => {
  it("joins wrapped CJK lines WITHOUT inserting a space", () => {
    const input = "在市场上搜索现有的\n解决方案";
    expect(unwrapTerminalSelection(input)).toBe("在市场上搜索现有的解决方案");
  });

  it("joins without a space when the previous line ends with a CJK char", () => {
    // CJK end, Latin start → still no space (CJK boundary dominates).
    expect(unwrapTerminalSelection("中文\nABC")).toBe("中文ABC");
  });

  it("joins without a space when the next line starts with a CJK char", () => {
    expect(unwrapTerminalSelection("ABC\n中文")).toBe("ABC中文");
  });

  it("joins Latin↔Latin with a space even in a CJK-heavy selection", () => {
    expect(unwrapTerminalSelection("hello\nworld 中文")).toBe("hello world 中文");
  });

  it("treats Korean like Latin (space-joined), since Hangul uses word spacing", () => {
    expect(unwrapTerminalSelection("안녕\n하세요")).toBe("안녕 하세요");
  });
});
