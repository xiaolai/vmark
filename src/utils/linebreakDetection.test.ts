// @vitest-environment node
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

  it("skips non-fence lines inside a fenced block (inFence=true path)", () => {
    // Lines inside the fence are not fence openers/closers, so they reach `if (inFence) continue`
    // with inFence=true — the true branch (skip)
    const input = ["```", "inside the fence", "```", "outside\\"].join("\n");
    expect(normalizeResult(detectLinebreaks(input)).hardBreakStyle).toBe("backslash");
  });

  it("ignores mismatched fence type inside a fenced block", () => {
    // Opening ``` but encountering ~~~ inside — the else-if condition is false (fenceChar mismatch)
    // so it does NOT exit the fence
    const input = ["```", "~~~", "code  ", "```", "outside\\"].join("\n");
    // The ~~~ line does NOT close the ``` block; code  is inside the block; ``` closes it
    // Only "outside\\" is outside — detected as backslash
    expect(normalizeResult(detectLinebreaks(input)).hardBreakStyle).toBe("backslash");
  });

  it("does not count whitespace-only lines with trailing spaces as two-space breaks", () => {
    // Line "    " has trailing spaces but before.trim() === "" → false branch of before.trim().length > 0
    const input = "    \nnext";
    expect(normalizeResult(detectLinebreaks(input)).hardBreakStyle).toBe("unknown");
  });
});
