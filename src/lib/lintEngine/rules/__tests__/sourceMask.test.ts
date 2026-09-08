// @vitest-environment node
//
// The one masking model the source-scanning rules share. Each case here is a
// false positive one of E01/E04/E05/W03 shipped while it carried its own
// half-model (audit 20260907 round 3).
import { describe, it, expect } from "vitest";
import { createMarkdownProcessor } from "@/utils/markdownPipeline/parser";
import type { Root } from "mdast";
import { maskCodeSpans, maskedLines, unparsedLines } from "../sourceMask";

function parse(source: string): Root {
  const processor = createMarkdownProcessor();
  return processor.runSync(processor.parse(source) as Root) as Root;
}

function masked(source: string): string[] {
  return maskedLines(source.split("\n"), parse(source));
}

describe("maskCodeSpans", () => {
  it("blanks a single-backtick span but keeps every offset", () => {
    const out = maskCodeSpans("a `b` c");
    expect(out).toBe("a     c");
    expect(out.length).toBe(7);
  });

  it("closes on a run of the SAME length, not the first backtick", () => {
    expect(maskCodeSpans("``a ` b`` c")).toBe("          c");
  });

  it("spans line endings — a code span is not a per-line thing", () => {
    expect(maskCodeSpans("a `x\ny` b")).toBe("a   \n   b");
  });

  it("stops at a blank line, so an unmatched run cannot eat the document", () => {
    expect(maskCodeSpans("a `x\n\n** bold **")).toBe("a `x\n\n** bold **");
  });

  it("treats an escaped backtick as literal text", () => {
    expect(maskCodeSpans("a \\` b ` c ` d")).toBe("a \\` b       d");
  });

  it("leaves an unmatched run alone and keeps scanning past it", () => {
    // The trailing run has no partner, so it stays literal and the scan goes on.
    expect(maskCodeSpans("a `b` c ` d")).toBe("a     c ` d");
  });
});

describe("unparsedLines", () => {
  it("covers a fenced block that a container prefixes", () => {
    const source = "> ```\n> code\n> ```\n";
    expect([...unparsedLines(parse(source))].sort()).toEqual([1, 2, 3]);
  });

  it("covers YAML front matter", () => {
    const source = "---\ntitle: x\n---\n\ntext\n";
    expect(unparsedLines(parse(source)).has(2)).toBe(true);
  });

  it("covers a raw HTML block but not an inline html span", () => {
    expect(unparsedLines(parse("<div>\nx\n</div>\n")).has(2)).toBe(true);
    expect(unparsedLines(parse("a <b>c</b> d\n")).size).toBe(0);
  });
});

describe("maskedLines", () => {
  it("blanks fenced code before the code-span scan, so its fences cannot open a span", () => {
    expect(masked("```\n`x\n```\n\n`y` z")).toEqual(["   ", "  ", "   ", "", "    z"]);
  });

  it("preserves every line's length", () => {
    const source = "a `b` c\n> ```\n> ** x **\n> ```\n";
    for (const [i, line] of masked(source).entries()) {
      expect(line.length).toBe(source.split("\n")[i].length);
    }
  });
});
