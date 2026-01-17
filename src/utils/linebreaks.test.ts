import { describe, it, expect } from "vitest";
import {
  resolveHardBreakStyle,
  resolveLineEndingOnSave,
  normalizeHardBreaks,
  normalizeLineEndings,
} from "./linebreaks";

describe("linebreaks helpers", () => {
  it("resolves hard break style from preference", () => {
    expect(resolveHardBreakStyle("unknown", "backslash")).toBe("backslash");
    expect(resolveHardBreakStyle("unknown", "twoSpaces")).toBe("twoSpaces");
    expect(resolveHardBreakStyle("twoSpaces", "preserve")).toBe("twoSpaces");
    expect(resolveHardBreakStyle("unknown", "preserve")).toBe("backslash");
  });

  it("resolves line ending on save", () => {
    expect(resolveLineEndingOnSave("unknown", "lf")).toBe("lf");
    expect(resolveLineEndingOnSave("unknown", "crlf")).toBe("crlf");
    expect(resolveLineEndingOnSave("crlf", "preserve")).toBe("crlf");
    expect(resolveLineEndingOnSave("unknown", "preserve")).toBe("lf");
  });

  it("normalizes line endings to target", () => {
    expect(normalizeLineEndings("a\r\nb\rc\n", "lf")).toBe("a\nb\nc\n");
    expect(normalizeLineEndings("a\nb\n", "crlf")).toBe("a\r\nb\r\n");
  });

  it("normalizes hard breaks to two-space style", () => {
    const input = "a\\\nb\n";
    expect(normalizeHardBreaks(input, "twoSpaces")).toBe("a  \nb\n");
  });

  it("normalizes hard breaks to backslash style", () => {
    const input = "a  \nb\n";
    expect(normalizeHardBreaks(input, "backslash")).toBe("a\\\nb\n");
  });

  it("does not touch fenced code blocks", () => {
    const input = [
      "```",
      "code  ",
      "code\\",
      "```",
      "text  ",
    ].join("\n");

    expect(normalizeHardBreaks(input, "backslash")).toBe(
      ["```", "code  ", "code\\", "```", "text\\"].join("\n")
    );
  });
});
