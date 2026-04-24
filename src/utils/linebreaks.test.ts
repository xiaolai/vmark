import { describe, it, expect } from "vitest";
import {
  resolveHardBreakStyle,
  resolveLineEndingOnSave,
  normalizeHardBreaks,
  normalizeLineEndings,
  softContentEquals,
} from "./linebreaks";

describe("linebreaks helpers", () => {
  it("resolves hard break style from explicit preference", () => {
    // Explicit preference always wins, regardless of document style
    expect(resolveHardBreakStyle("unknown", "backslash")).toBe("backslash");
    expect(resolveHardBreakStyle("unknown", "twoSpaces")).toBe("twoSpaces");
    expect(resolveHardBreakStyle("twoSpaces", "backslash")).toBe("backslash");
    expect(resolveHardBreakStyle("backslash", "twoSpaces")).toBe("twoSpaces");
    expect(resolveHardBreakStyle("mixed", "backslash")).toBe("backslash");
    expect(resolveHardBreakStyle("mixed", "twoSpaces")).toBe("twoSpaces");
  });

  it("preserves detected document style when preference is preserve", () => {
    expect(resolveHardBreakStyle("twoSpaces", "preserve")).toBe("twoSpaces");
    expect(resolveHardBreakStyle("backslash", "preserve")).toBe("backslash");
  });

  it("defaults to twoSpaces for unknown/new documents (wider compatibility)", () => {
    expect(resolveHardBreakStyle("unknown", "preserve")).toBe("twoSpaces");
    expect(resolveHardBreakStyle("mixed", "preserve")).toBe("twoSpaces");
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

  it("skips non-fence lines inside a fenced block when normalizing (inFence=true path)", () => {
    // Lines inside fence reach `if (inFence) continue` with inFence=true
    const input = ["```", "inside content", "```", "outside  "].join("\n");
    expect(normalizeHardBreaks(input, "backslash")).toBe(
      ["```", "inside content", "```", "outside\\"].join("\n")
    );
  });

  it("ignores mismatched fence type inside a fenced block when normalizing", () => {
    // Opening ``` but encountering ~~~ inside — fenceChar mismatch → else-if false branch
    // The ~~~ does NOT close the ``` block; trailing spaces inside block are NOT converted
    const input = ["```", "~~~", "inside  ", "```", "outside  "].join("\n");
    expect(normalizeHardBreaks(input, "backslash")).toBe(
      ["```", "~~~", "inside  ", "```", "outside\\"].join("\n")
    );
  });

  it("does not convert whitespace-only lines with trailing spaces to backslash", () => {
    // "    \n" line: trailing spaces but before.trim() === "" → false branch of trim check
    const input = "    \nnext";
    expect(normalizeHardBreaks(input, "backslash")).toBe("    \nnext");
  });
});

describe("softContentEquals", () => {
  it("returns true for byte-identical content", () => {
    expect(softContentEquals("hello world", "hello world")).toBe(true);
    expect(softContentEquals("", "")).toBe(true);
  });

  it("ignores line-ending differences (CRLF vs LF vs CR)", () => {
    expect(softContentEquals("a\r\nb\r\nc", "a\nb\nc")).toBe(true);
    expect(softContentEquals("a\rb\rc", "a\nb\nc")).toBe(true);
    expect(softContentEquals("line1\r\nline2", "line1\nline2")).toBe(true);
  });

  it("ignores a leading UTF-8 BOM", () => {
    expect(softContentEquals("﻿hello", "hello")).toBe(true);
    expect(softContentEquals("hello", "﻿hello")).toBe(true);
  });

  it("ignores a single trailing newline", () => {
    expect(softContentEquals("hello\n", "hello")).toBe(true);
    expect(softContentEquals("hello", "hello\r\n")).toBe(true);
  });

  it("folds BOM + CRLF + trailing newline together (OneDrive scenario)", () => {
    // Typical OneDrive rewrite: adds BOM, converts LF→CRLF, adds trailing \r\n
    const original = "# Title\n\nBody";
    const synced = "﻿# Title\r\n\r\nBody\r\n";
    expect(softContentEquals(original, synced)).toBe(true);
  });

  it("does NOT ignore real content differences", () => {
    expect(softContentEquals("hello", "hello!")).toBe(false);
    expect(softContentEquals("a\nb", "a\nc")).toBe(false);
    expect(softContentEquals("x", "y")).toBe(false);
  });

  it("does NOT fold trailing whitespace changes (trailing spaces are semantic in Markdown)", () => {
    // Two trailing spaces in Markdown = hard line break — user-meaningful
    expect(softContentEquals("line  \n", "line\n")).toBe(false);
  });

  it("does NOT fold multiple trailing newlines (only a single one)", () => {
    // Only one trailing \n is stripped; content with different paragraph counts stays distinct
    expect(softContentEquals("a\n\n", "a")).toBe(false);
  });

  it("treats empty vs single-newline as equal", () => {
    expect(softContentEquals("", "\n")).toBe(true);
  });
});
