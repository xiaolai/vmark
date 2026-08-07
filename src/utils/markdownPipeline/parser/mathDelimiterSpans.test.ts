// @vitest-environment node
// Tests for the `\[ \]` / `\( \)` math-delimiter span finder and the
// normalization built on it (issue #1180). The finder is a single
// forward scan (no regex backtracking — a document of unpaired openers
// or escaped closers must not go quadratic) over an opaque-region mask:
// code, YAML frontmatter, inline-link destinations, and HTML tags are
// never rewritten (Codex audit H1/M4/M5).

import { describe, it, expect } from "vitest";
import { expectBoundedTime } from "@/test/timeBudget";
import {
  findMathDelimiterSpans,
  normalizeMathDelimiters,
} from "./mathDelimiterSpans";

describe("normalizeMathDelimiters — conversions", () => {
  it("converts standalone \\[ ... \\] to a $$ fence", () => {
    expect(normalizeMathDelimiters("\\[ \\alpha=0 \\]")).toBe(
      ["$$", "\\alpha=0", "$$"].join("\n"),
    );
  });

  it("converts a multi-line display span", () => {
    const input = ["\\[", "\\alpha = 0", "\\]"].join("\n");
    expect(normalizeMathDelimiters(input)).toBe(
      ["$$", "\\alpha = 0", "$$"].join("\n"),
    );
  });

  it("converts an indented display span, preserving the indent", () => {
    expect(normalizeMathDelimiters("  \\[ x \\]")).toBe(
      ["  $$", "x", "$$"].join("\n"),
    );
  });

  it("converts inline \\( ... \\) to single-dollar math", () => {
    expect(normalizeMathDelimiters("Given \\( x^2 \\) here.")).toBe(
      "Given $x^2$ here.",
    );
  });

  it("picks a longer dollar run when the content contains a dollar", () => {
    // `$\text{\$5}$` would close at the inner dollar (Codex H4) — the
    // delimiter run must exceed the longest run in the content, like
    // mdast-util-math's serializer.
    expect(normalizeMathDelimiters("\\( \\text{\\$5} \\)")).toBe(
      "$$\\text{\\$5}$$",
    );
  });

  it("display: lengthens the fence when the content has a dollar-only line", () => {
    const input = ["\\[", "x", "$$", "y", "\\]"].join("\n");
    expect(normalizeMathDelimiters(input)).toBe(
      ["$$$", "x", "$$", "y", "$$$"].join("\n"),
    );
  });

  it("converts CJK-adjacent inline math without surrounding spaces", () => {
    // The reporter writes Chinese — CJK text routinely omits spaces
    // around math, and the guard must not require them.
    expect(normalizeMathDelimiters("值\\(x\\)是")).toBe("值$x$是");
  });

  it("CRLF: a standalone display span converts", () => {
    expect(normalizeMathDelimiters("\\[ \\alpha=0 \\]\r\ntext")).toBe(
      "$$\n\\alpha=0\n$$\r\ntext",
    );
  });
});

describe("normalizeMathDelimiters — refusals", () => {
  it("leaves inline code spans untouched", () => {
    const input = "Use `\\( x \\)` verbatim.";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("leaves fenced code untouched", () => {
    const input = ["```tex", "\\[ x \\]", "```"].join("\n");
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("rejects a span that CROSSES an inline code region", () => {
    // Endpoints are outside code, but converting would swallow the
    // code span into math (Codex M4).
    const input = "\\( a `code` b \\)";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("leaves escaped parens inside a link destination untouched (Codex H1)", () => {
    const input = "[x](foo\\(bar\\))";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("leaves a literal autolink URL untouched", () => {
    // GFM literal autolinks put the URL in the child span — tail-only
    // masking would expose it.
    const input = "See https://example.test/\\(x\\) for details.";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("leaves an angle autolink URL untouched", () => {
    const input = "See <https://example.test/\\(x\\)> for details.";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("leaves a SHORTCUT reference label untouched — it is also the id", () => {
    // Converting the label would break the match to its definition.
    const input = "[\\(x\\)]\n\n[\\(x\\)]: https://example.test";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("leaves a COLLAPSED reference label untouched — same id semantics", () => {
    const input = "[\\(x\\)][]\n\n[\\(x\\)]: https://example.test";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("converts a FULL reference label — the id does the matching", () => {
    const input = "[\\( x \\)][id]\n\n[id]: https://example.test";
    const out = normalizeMathDelimiters(input);
    expect(out).toContain("[$x$][id]");
    expect(out).toContain("[id]: https://example.test");
  });

  it("leaves YAML frontmatter untouched", () => {
    const input = ["---", "title: \\[ x \\]", "---", "", "body"].join("\n");
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("leaves delimiters inside an HTML tag untouched", () => {
    const input = '<img alt="\\(x\\)" src="a.png">';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("does not touch LaTeX row-spacing \\\\[4pt] (double backslash)", () => {
    const input = ["$$", "a \\\\[4pt] b", "$$"].join("\n");
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("leaves an unpaired opener alone", () => {
    const input = "A lone \\( with no closer.";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("does not pair across a blank line", () => {
    const input = ["\\[ a", "", "b \\]"].join("\n");
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("CRLF: does not pair across a \\r\\n blank line", () => {
    const input = "\\[ a\r\n\r\nb \\]";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("leaves mid-sentence escaped brackets alone (corpus: \\[not a link\\])", () => {
    const input = "Backslash escapes: \\*not italic\\*, and \\[not a link\\].";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("leaves a link reference definition untouched", () => {
    const input = "[id]: foo\\(bar\\)";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("leaves a reference definition with an escaped label bracket untouched", () => {
    const input = "[a\\]]: foo\\(bar\\)";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("leaves a processing-instruction HTML block untouched", () => {
    const input = ["<?target", "\\(x\\)", "?>"].join("\n");
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("leaves a quoted attribute containing > untouched", () => {
    const input = '<span title="> \\(x\\)">label</span>';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("leaves an unterminated comment untouched (runs to EOF)", () => {
    const input = "<!-- open comment\n\\( x \\)";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("leaves HTML comments untouched", () => {
    const input = "<!-- \\( x \\) -->";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("leaves raw HTML block bodies (script/style) untouched", () => {
    const input = ['<script>', 'let a = "\\( x \\)";', "</script>"].join("\n");
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("does not pair across a backslash hard-break into a blank line", () => {
    // The trailing backslash before the newline must not swallow the
    // blank-line boundary check (Codex M6).
    const input = "\\(a\\\n\nb\\)";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("treats an escaped closer as content, not a terminator", () => {
    // `\\)` is backslash-escaped — no closer exists, so no span; and
    // the scan must terminate promptly (no quadratic rescans).
    const input = "\\( a \\\\) b";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("empty input passes through", () => {
    expect(normalizeMathDelimiters("")).toBe("");
  });
});

describe("findMathDelimiterSpans", () => {
  it("reports offsets usable for escape protection", () => {
    const text = "Given \\( x \\) end.";
    const spans = findMathDelimiterSpans(text);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0].start, spans[0].start + 2)).toBe("\\(");
    expect(text.slice(spans[0].end - 2, spans[0].end)).toBe("\\)");
    expect(spans[0].kind).toBe("inline");
  });

  it("skips display spans that are not standalone", () => {
    expect(findMathDelimiterSpans("mid \\[ x \\] sentence")).toHaveLength(0);
  });

  it("finds a standalone display span", () => {
    const spans = findMathDelimiterSpans("\\[ x \\]");
    expect(spans).toHaveLength(1);
    expect(spans[0].kind).toBe("display");
  });

  it("survives a flood of unpaired openers (linearity smoke)", () => {
    const flood = "\\( ".repeat(20000);
    const started = performance.now();
    expect(findMathDelimiterSpans(flood)).toHaveLength(0);
    expectBoundedTime(performance.now() - started, {
      budgetMs: 5000, livenessMs: 15_000,
      label: "mathDelimiterSpans over a pathological input",
    });
  });

  it("survives a flood of openers whose only closer is inside code", () => {
    // Codex M5 — the masked closer must not send every opener on a
    // fresh scan to it.
    const flood = "\\( ".repeat(20000) + "`\\)`";
    const started = performance.now();
    expect(findMathDelimiterSpans(flood)).toHaveLength(0);
    expectBoundedTime(performance.now() - started, {
      budgetMs: 5000, livenessMs: 15_000,
      label: "mathDelimiterSpans over a pathological input",
    });
  });
});
