import { describe, it, expect } from "vitest";
import { detectLinebreaks } from "./linebreakDetection";

function normalizeResult(result: ReturnType<typeof detectLinebreaks>) {
  return { lineEnding: result.lineEnding, hardBreakStyle: result.hardBreakStyle };
}

describe("linebreakDetection", () => {
  it("detects LF line endings", () => {
    const input = "a\n\n b\n";
    expect(normalizeResult(detectLinebreaks(input)).lineEnding).toBe("lf");
  });

  it("detects CRLF line endings", () => {
    const input = "a\r\n\r\n b\r\n";
    expect(normalizeResult(detectLinebreaks(input)).lineEnding).toBe("crlf");
  });

  it("treats mixed line endings as CRLF when present", () => {
    const input = "a\nb\r\nc\r";
    expect(normalizeResult(detectLinebreaks(input)).lineEnding).toBe("crlf");
  });

  it("treats bare CR as CRLF", () => {
    const input = "a\rb\r";
    expect(normalizeResult(detectLinebreaks(input)).lineEnding).toBe("crlf");
  });

  it("returns unknown when no line endings exist", () => {
    const input = "single line";
    expect(normalizeResult(detectLinebreaks(input)).lineEnding).toBe("unknown");
  });

  it("returns unknown for empty text", () => {
    expect(normalizeResult(detectLinebreaks("")).lineEnding).toBe("unknown");
    expect(normalizeResult(detectLinebreaks("")).hardBreakStyle).toBe("unknown");
  });

  it("detects backslash hard breaks", () => {
    const input = "line\\\nnext";
    expect(normalizeResult(detectLinebreaks(input)).hardBreakStyle).toBe("backslash");
  });

  it("detects two-space hard breaks", () => {
    const input = "line  \nnext";
    expect(normalizeResult(detectLinebreaks(input)).hardBreakStyle).toBe("twoSpaces");
  });

  it("detects mixed hard break styles", () => {
    const input = "line  \nnext\\\nfinal";
    expect(normalizeResult(detectLinebreaks(input)).hardBreakStyle).toBe("mixed");
  });

  it("ignores fenced code blocks when detecting hard break style", () => {
    const input = [
      "```",
      "code line  ",
      "code line\\",
      "```",
      "text line\\",
    ].join("\n");

    expect(normalizeResult(detectLinebreaks(input)).hardBreakStyle).toBe("backslash");
  });
});
