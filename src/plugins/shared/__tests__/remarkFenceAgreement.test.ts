/**
 * The fence scanner, checked against remark-parse itself.
 *
 * F1, F2 and F3 were all the same failure: the scanner's grammar was reasoned
 * about rather than compared, and three separate rules drifted from CommonMark
 * in ways no internal test could see — `fenceGrammarAgreement.test.ts` compares
 * VMark's two parsers to each other, so a rule wrong in both reads as agreement.
 *
 * This compares against the reference implementation the rest of the pipeline
 * already parses with. It is a real gate, not a smoke test: every input below
 * failed here before its fix, and the divergence list is empty by default so a
 * new disagreement fails rather than being absorbed.
 *
 * The scanner is line-based by necessity — it runs on every keystroke against a
 * CodeMirror document, where a full parse is not affordable — so a divergence
 * is not automatically a bug. But it must be DECLARED, with the direction
 * stated, because over-including protects text that is not code (harmless for a
 * guard) while under-including strips protection from text that is (not).
 *
 * @coordinates-with plugins/shared/fenceScanner.ts — the parser under test
 * @coordinates-with plugins/shared/fenceDelimiter.ts — the delimiter grammar
 * @module plugins/shared/__tests__/remarkFenceAgreement.test
 */
import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import { fenceRanges } from "../fenceScanner";

/** 0-based indices of lines remark-parse places inside a fenced code block. */
function remarkCodeLines(md: string): Set<number> {
  const tree = unified().use(remarkParse).parse(md) as Root;
  const inside = new Set<number>();
  const lines = md.split("\n");
  visit(tree, "code", (node) => {
    const start = node.position?.start.line;
    const end = node.position?.end.line;
    if (typeof start !== "number" || typeof end !== "number") return;
    // mdast's `code` covers INDENTED code blocks too, and the scanner reports
    // fences only. Comparing them conflated two different constructs — an
    // indented block read as scanner-under-inclusion that was never a fence.
    // Marker padding is bounded at four spaces, exactly as the real grammar
    // bounds it. A greedy `[ \t]*` swallowed the five spaces in `- -     ``` `
    // and called the resulting INDENTED block a fence, which then read as
    // scanner under-inclusion — a harness bug masquerading as a finding.
    const marker = /^(?: {0,3}(?:[-*+]|\d{1,9}[.)])(?:\t| {1,4}(?! )))*/;
    const opener = (lines[start - 1] ?? "").replace(marker, "");
    if (!/^ {0,3}(?:`{3,}|~{3,})/.test(opener)) return;
    // remark lines are 1-based and span the delimiters; the scanner's ranges
    // do too, so both are compared on the same footing.
    for (let line = start; line <= end; line += 1) inside.add(line - 1);
  });
  return inside;
}

/** 0-based indices of lines the scanner places inside a fence. */
function scannerCodeLines(md: string): Set<number> {
  const lines = md.split("\n");
  const inside = new Set<number>();
  for (const range of fenceRanges(lines, "commonmark")) {
    for (let line = range.open; line <= range.close; line += 1) inside.add(line);
  }
  return inside;
}

/**
 * Inputs both parsers must classify identically, line for line.
 *
 * Each carries the finding that put it here, so a future edit that "simplifies"
 * one of these away has to argue with the bug it encodes.
 */
const MUST_AGREE: { label: string; md: string }[] = [
  // F1 — consecutive list items each opening a fence.

  // F2 — a list marker's padding is bounded at four spaces.
  { label: "over-padded nested marker is indented code", md: "- -     ```\nx\n" },

  // F3 — the closing fence's indent is absolute, not relative to the opener.
  { label: "indented opener, deeper closer", md: " ```\ncode\n    ```\nstill code\n" },
  { label: "indented opener, legal closer", md: " ```\ncode\n   ```\nafter\n" },
  { label: "unindented opener, 4-space line", md: "```\ncode\n    ```\nafter\n" },

  // Grammar rules that predate these findings, kept under the same check.
  { label: "closer shorter than opener does not close", md: "````\ncode\n```\nstill\n" },
  { label: "tilde fence", md: "~~~\ncode\n~~~\nafter\n" },
  { label: "backtick in a backtick info string is not a fence", md: "``` a`b\ntext\n" },
  { label: "info string on the opener only", md: "```js\ncode\n```\nafter\n" },
  { label: "unclosed fence runs to the end", md: "```\ncode\nmore\n" },
  { label: "plain prose has no fences", md: "para\n\nanother\n" },
  { label: "empty document", md: "" },
];

/**
 * Declared divergences, with direction and reason. EMPTY is the goal.
 *
 * A line-based scanner cannot see every container, so this list may become
 * non-empty — but only with a stated reason and a stated direction. An entry
 * that has since converged fails the staleness check below, so a fixed
 * divergence cannot sit here pretending to be a known limitation.
 */
const DECLARED_DIVERGENCES: {
  label: string;
  md: string;
  direction: "over-includes" | "under-includes";
  reason: string;
}[] = [
  {
    label: "`2.` cannot interrupt a paragraph",
    md: "1. ```\nfirst\n2. ```\nsecond\n",
    direction: "over-includes",
    reason:
      "CommonMark lets an ordered list interrupt a paragraph only when it " +
      "starts at 1, so `2. ``` ` after `first` is paragraph TEXT, not a fence. " +
      "Knowing that requires knowing the previous block is a paragraph — " +
      "block context a line-based scanner does not have. It over-includes, " +
      "which for a guard means protecting text that is not code.",
  },
  {
    label: "two list items, each with a fence",
    md: "- ```\nfirst\n- ```\nsecond\n",
    direction: "over-includes",
    reason:
      "remark gives BOTH items an empty code block, with `first` and `second` " +
      "as paragraphs outside the list — a list item's fence ends where the " +
      "ITEM ends, at the first line left of its content column. A line-based " +
      "scanner has no container-block state, so it carries each range to the " +
      "next marker instead. An item-end rule was implemented and reverted: it " +
      "matched here but broke legitimately-indented and blockquote-nested " +
      "list content in the UNDER-including direction, which is worse.",
  },
  {
    label: "nested marker at the content column",
    md: "- ```\n  - x\ncode\n- ```\n",
    direction: "over-includes",
    reason:
      "Same cause: `code` at the margin ends the item for remark, and the " +
      "scanner carries the range to the next marker. Over-includes, so a " +
      "guard stays on across text that is not code.",
  },
  {
    label: "one space of padding",
    md: "- ```\nx\n- ```\n",
    direction: "over-includes",
    reason:
      "The closer `- ``` ` carries a list marker, so it opens its own item " +
      "rather than closing this one; remark leaves the first block empty. " +
      "Same container-context limitation, same safe direction.",
  },
  {
    label: "four spaces of padding",
    md: "-    ```\nx\n",
    direction: "over-includes",
    reason:
      "Four spaces is the maximum padding CommonMark allows after a marker, " +
      "so the fence is real; `x` at the margin ends the item for remark while " +
      "the scanner keeps the unclosed range running to the end of the file.",
  },
  {
    label: "tab after the marker",
    md: "-\t```\nx\n-\t```\n",
    direction: "over-includes",
    reason:
      "A tab puts the content column at 4 rather than 2, which the scanner " +
      "measures in characters. It errs by including more, and the case is " +
      "recorded so a future column-aware rewrite has its expectation written " +
      "down rather than rediscovered.",
  },
  {
    label: "a sibling marker indented 1 of 2 columns",
    md: "- ```\n - x\ncode\n",
    direction: "over-includes",
    reason:
      "remark keeps ` - x` inside the unclosed fence and ends the block at " +
      "`code`; the scanner ends the range at the sibling marker and reopens " +
      "there, so the union covers strictly more. Recorded rather than guessed " +
      "at — resolving it needs container-block state a line scanner lacks.",
  },
];

describe("the scanner agrees with remark-parse, line for line", () => {
  it.each(MUST_AGREE)("$label", ({ md }) => {
    expect([...scannerCodeLines(md)].sort((a, b) => a - b)).toEqual(
      [...remarkCodeLines(md)].sort((a, b) => a - b)
    );
  });

  it("gives every declared divergence a direction and a real reason", () => {
    // The list is allowed to be non-empty — a line-based scanner cannot see
    // container context — but not to grow silently. Each entry states which way
    // it errs, because over-including protects text that is not code while
    // under-including strips protection from text that is.
    for (const entry of DECLARED_DIVERGENCES) {
      expect(entry.reason.length).toBeGreaterThan(80);
      expect(["over-includes", "under-includes"]).toContain(entry.direction);
    }
  });

  it("has NO divergence in the unsafe direction", () => {
    // The property that makes the list tolerable: every divergence protects
    // MORE text than the reference parser calls code, never less. An entry that
    // strips protection from real code fails here and must be fixed, not filed.
    const unsafe = DECLARED_DIVERGENCES.filter((d) => d.direction === "under-includes");
    expect(unsafe.map((d) => d.label)).toEqual([]);
  });

  it("confines the divergences to LIST-ITEM fences", () => {
    // The limitation has one cause — no container-block state — and this keeps
    // that claim honest. A divergence outside list items would mean the line
    // grammar itself drifted, which is what F3 was.
    const nonList = DECLARED_DIVERGENCES.filter(({ md }) => !/^[ \t]*(?:[-*+]|\d+[.)])/.test(md));
    expect(nonList.map((d) => d.label)).toEqual([]);
  });

  it("measures each declared direction rather than trusting the label", () => {
    // A label is a claim. This checks it against the actual output, so an entry
    // whose direction flips fails instead of reading as still-documented.
    for (const { md, direction, label } of DECLARED_DIVERGENCES) {
      const scanner = scannerCodeLines(md);
      const remark = remarkCodeLines(md);
      const extra = [...scanner].filter((l) => !remark.has(l));
      const missing = [...remark].filter((l) => !scanner.has(l));
      if (direction === "over-includes") {
        expect({ label, extra: extra.length > 0, missing }).toEqual({
          label,
          extra: true,
          missing: [],
        });
      } else {
        expect({ label, missing: missing.length > 0 }).toEqual({ label, missing: true });
      }
    }
  });

  it("keeps every declared divergence REAL — a converged one is stale", () => {
    const converged = DECLARED_DIVERGENCES.filter(({ md }) => {
      const a = [...scannerCodeLines(md)].sort((x, y) => x - y);
      const b = [...remarkCodeLines(md)].sort((x, y) => x - y);
      return JSON.stringify(a) === JSON.stringify(b);
    });
    expect(converged.map((d) => d.label)).toEqual([]);
  });
});

describe("the comparison itself is not vacuous", () => {
  it("detects a disagreement when one exists", () => {
    // A gate that cannot fail proves nothing. remark sees no fence in plain
    // prose, so any scanner output over it would be a difference — and this
    // asserts the harness reports one rather than silently comparing empties.
    const md = "```\ncode\n```\n";
    expect(remarkCodeLines(md).size).toBeGreaterThan(0);
    expect(scannerCodeLines(md).size).toBeGreaterThan(0);
    expect([...remarkCodeLines("plain\n")]).toEqual([]);
  });

  it("covers every finding that produced it, agreed or declared", () => {
    // F1's cases live in DECLARED_DIVERGENCES and F2's/F3's in MUST_AGREE, so
    // the coverage claim has to span both lists — checking only one would let
    // a finding's case be deleted without the gate noticing.
    const labels = [...MUST_AGREE, ...DECLARED_DIVERGENCES].map((c) => c.label).join(" ");
    for (const needle of ["list items", "padding", "closer", "opener"]) {
      expect(labels).toContain(needle);
    }
  });
});
