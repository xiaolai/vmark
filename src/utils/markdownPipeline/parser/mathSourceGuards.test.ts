// @vitest-environment node
// Tests for the `$$` fence guard (issue #1181).
//
// #1181 — an unclosed `$$` opener swallowed every following paragraph
// into one giant math block (micromark math flow runs to the next
// closing fence line or EOF, like an unclosed code fence). The guard
// applies pandoc's display-math rule at the source layer: a `$$` block
// must close before a blank line; an opener that doesn't is escaped so
// it parses as literal text and the content behind it survives as
// normal blocks. Delimiter normalization (#1180) is covered in
// mathDelimiterSpans.test.ts; adapter-level round trips in
// mathGuards.integration.test.ts.

import { describe, it, expect } from "vitest";
import { expectBoundedTime } from "@/test/timeBudget";
import { escapeUnclosedMathFences } from "./mathSourceGuards";

describe("escapeUnclosedMathFences (#1181)", () => {
  it("escapes an opener that never closes before a blank line", () => {
    const input = ["$$", "E=mc^2", "", "A normal paragraph."].join("\n");
    const out = escapeUnclosedMathFences(input);
    expect(out).toBe(["\\$$", "E=mc^2", "", "A normal paragraph."].join("\n"));
  });

  it("keeps a well-formed multi-line block untouched", () => {
    const input = ["$$", "E=mc^2", "\\alpha + \\beta", "$$"].join("\n");
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("a later, well-paired block after a broken opener still parses as math", () => {
    const input = [
      "$$",
      "E=mc^2",
      "",
      "A normal paragraph.",
      "",
      "$$",
      "F=ma",
      "$$",
    ].join("\n");
    const out = escapeUnclosedMathFences(input);
    expect(out.startsWith("\\$$")).toBe(true);
    expect(out).toContain(["$$", "F=ma", "$$"].join("\n"));
  });

  it("applies pandoc's rule: a blank line followed by more content is not display math", () => {
    const input = ["$$", "a", "", "b", "$$"].join("\n");
    const out = escapeUnclosedMathFences(input);
    expect(out.startsWith("\\$$")).toBe(true);
  });

  it("tolerates the app's empty-math template: $$ / blank / $$", () => {
    // Source-mode insertMath produces exactly this shape (opener, blank
    // caret line, closer) — behavioral parity requires it to keep
    // parsing as an empty math block. A blank tail followed directly by
    // the closer swallows nothing, so the pandoc rule stands down.
    const input = ["The quick brown fox", "$$", "", "$$", ""].join("\n");
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("tolerates trailing blank lines before the closer", () => {
    const input = ["$$", "a", "", "", "$$"].join("\n");
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("ignores $$ inside fenced code blocks", () => {
    const input = ["```", "$$", "not math", "```", "", "text"].join("\n");
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("ignores single-line inline math", () => {
    const input = "The value $$x$$ stays inline.";
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("empty input passes through", () => {
    expect(escapeUnclosedMathFences("")).toBe("");
  });

  it("CRLF: a well-formed block with \\r\\n endings stays untouched", () => {
    // The trailing paragraph keeps the closer OFF the final line, so it
    // carries a real "\r" (split("\n") leaves it there).
    const input = ["$$", "E=mc^2", "$$", "", "after"].join("\r\n");
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("CRLF: a blank \\r\\n line still triggers the pandoc rule", () => {
    const input = ["$$", "E=mc^2", "", "text"].join("\r\n");
    expect(escapeUnclosedMathFences(input).startsWith("\\$$")).toBe(true);
  });

  it("lone CR: a blank \\r line still triggers the pandoc rule", () => {
    // CommonMark accepts classic-Mac \r endings; the guard must not go
    // blind on them.
    const input = ["$$", "x", "", "paragraph"].join("\r");
    expect(escapeUnclosedMathFences(input).startsWith("\\$$")).toBe(true);
  });

  it("lone CR: a well-formed block stays untouched", () => {
    const input = ["$$", "x", "$$", "", "after"].join("\r");
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("honors micromark's run-length grammar: $$$ closes only with 3+ dollars", () => {
    // Codex H3 — a valid $$$ block must not be escaped…
    const valid = ["$$$", "x $$ y", "$$$"].join("\n");
    expect(escapeUnclosedMathFences(valid)).toBe(valid);
    // …a longer closer is fine…
    const longCloser = ["$$", "x", "$$$"].join("\n");
    expect(escapeUnclosedMathFences(longCloser)).toBe(longCloser);
    // …and a too-short closer does not close.
    const shortCloser = ["$$$", "x", "$$", "", "text"].join("\n");
    expect(escapeUnclosedMathFences(shortCloser).startsWith("\\$$$")).toBe(
      true,
    );
  });

  it("treats $$$x$$$ on one line as inline, not a fence", () => {
    const input = "The value $$$x$$$ stays inline.";
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("guards blockquoted math: an unclosed > $$ is escaped in place", () => {
    // Codex H2 — micromark opens math flow behind container prefixes
    // too; without the guard it swallows the rest of the blockquote.
    const input = ["> $$", "> E=mc^2", "", "after"].join("\n");
    const out = escapeUnclosedMathFences(input);
    expect(out).toBe(["> \\$$", "> E=mc^2", "", "after"].join("\n"));
  });

  it("keeps a well-formed blockquoted block untouched", () => {
    const input = ["> $$", "> E=mc^2", "> $$"].join("\n");
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("a blockquote ending before the closer counts as unclosed", () => {
    const input = ["> $$", "> E=mc^2", "plain paragraph"].join("\n");
    const out = escapeUnclosedMathFences(input);
    expect(out.startsWith("> \\$$")).toBe(true);
  });

  it("leaves $$ inside YAML frontmatter untouched", () => {
    const input = ["---", "price: $$", "---", "", "body"].join("\n");
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("leaves $$ inside a raw HTML block untouched", () => {
    const input = ["<script>", "$$", "foo()", "</script>", "", "text"].join("\n");
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("a bare - $$ before a sibling item swallows nothing and stays as typed", () => {
    // micromark ends the math node at the item boundary (value "") —
    // the sibling item is NOT swallowed, so the empty-value courtesy
    // applies, same as the mid-typing case.
    const input = ["- $$", "- next item"].join("\n");
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("guards list-item math that swallows past a blank line", () => {
    const input = ["- $$", "  x", "", "  swallowed"].join("\n");
    const out = escapeUnclosedMathFences(input);
    expect(out).toContain("- \\$$");
  });

  it("keeps a well-formed bullet-list math block untouched", () => {
    const input = ["- $$", "  E=mc^2", "  $$"].join("\n");
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("keeps a well-formed ordered-list math block untouched", () => {
    const input = ["1. $$", "   x", "   $$"].join("\n");
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("an unclosed quoted code fence does not disarm the guard afterwards (Codex M7)", () => {
    const input = ["> ```", "> code", "", "$$", "x", "", "text"].join("\n");
    const out = escapeUnclosedMathFences(input);
    expect(out).toBe(["> ```", "> code", "", "\\$$", "x", "", "text"].join("\n"));
  });

  it("guards nested-list math: an unclosed deep opener is escaped in place", () => {
    // micromark opens math flow at any container depth — the probe
    // parse sees exactly what it sees, so nesting needs no scanner.
    const input = ["- outer", "  - $$", "    x", "  - next"].join("\n");
    const out = escapeUnclosedMathFences(input);
    expect(out).toContain("- \\$$");
  });

  it("leaves tab-indented $$ alone — it is indented code, not math", () => {
    const input = "\t$$\n\tstill code";
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("leaves $$ inside a tilde fence within a list item untouched", () => {
    const input = ["- ~~~", "  $$", "  code", "  ~~~"].join("\n");
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("leaves $$ inside a generic HTML block untouched", () => {
    const input = ["<div>", "$$", "</div>", "", "text"].join("\n");
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("a `` ```info` `` line is prose, not a fence — the guard stays armed", () => {
    // CommonMark bans backticks in a backtick fence's info string; a
    // scanner that accepted it would treat the following $$ as code.
    const input = ["```foo`", "", "$$", "x", "", "text"].join("\n");
    const out = escapeUnclosedMathFences(input);
    expect(out).toContain("\\$$");
  });

  it("an over-indented $$ line is content, not a closer", () => {
    // micromark reports the "    $$" line inside the node's value —
    // the value-based closure check needs no indent grammar to agree.
    const input = ["$$", "x", "    $$", "", "paragraph"].join("\n");
    const out = escapeUnclosedMathFences(input);
    expect(out.startsWith("\\$$")).toBe(true);
  });

  it("keeps an empty dangling opener as typed (mid-typing courtesy)", () => {
    // An empty-value node swallows nothing; escaping while the user is
    // still typing the block would be hostile.
    const input = ["text", "", "$$"].join("\n");
    expect(escapeUnclosedMathFences(input)).toBe(input);
  });

  it("a deeper-quoted $$ line is content, not a closer", () => {
    // micromark reports value "x\n> $$" (one quote marker consumed) —
    // the line belongs to the (unclosed) block, so the opener escapes.
    const input = ["> $$", "> x", ">> $$", "", "paragraph"].join("\n");
    const out = escapeUnclosedMathFences(input);
    expect(out.startsWith("> \\$$")).toBe(true);
  });

  it("a valid $$$ block containing a shorter dollar line is NOT unclosed", () => {
    // Suffix-based closure checks collided here: the real "$$$" closer
    // ends with the value's "$$" line. Line counts do not collide.
    const input = ["$$$", "x", "$$", "$$$"].join("\n");
    expect(escapeUnclosedMathFences(input)).toBe(input);
    const singleDollar = ["$$", "x", "$", "$$"].join("\n");
    expect(escapeUnclosedMathFences(singleDollar)).toBe(singleDollar);
    const quoted = ["> $$$", "> x", "> $$", "> $$$"].join("\n");
    expect(escapeUnclosedMathFences(quoted)).toBe(quoted);
  });

  it("fails closed past the healing budget: no violating opener survives (bounded time)", () => {
    const flood = Array.from({ length: 2000 }, () => "$$ meta").join("\n");
    const input = `${flood}\n\nsurvivor paragraph`;
    const started = performance.now();
    const out = escapeUnclosedMathFences(input);
    expectBoundedTime(performance.now() - started, {
      budgetMs: 5000, livenessMs: 15_000,
      label: "escapeUnclosedMathFences over a 2000-line opener flood",
    });
    // Every opener-shaped line is escaped — partial healing must not
    // leave an active swallower in front of the paragraph.
    expect(/^\$\$/m.test(out)).toBe(false);
    expect(out).toContain("survivor paragraph");
  });

  it("the fail-closed sweep also escapes list-prefixed openers", () => {
    const flood = Array.from({ length: 15 }, (_, i) =>
      ["$$ b" + i, "x", "", ""].join("\n"),
    ).join("");
    const input = `${flood}- $$\n  x\n\n  survivor`;
    const out = escapeUnclosedMathFences(input);
    expect(out).toContain("- \\$$");
    expect(out).toContain("survivor");
  });

  it("the fail-closed sweep still respects code fences (math-disabled probe)", () => {
    const flood = Array.from({ length: 15 }, (_, i) =>
      ["$$ b" + i, "x", "", ""].join("\n"),
    ).join("");
    const input = `${flood}~~~\n$$\n~~~`;
    const out = escapeUnclosedMathFences(input);
    expect(out).toContain("~~~\n$$\n~~~");
  });
});
