/**
 * Tests for the incremental (segment-cached) status-bar text metrics.
 *
 * The contract: `createMetricsCache()(content)` must produce the same
 * numbers as the direct pipeline `computeTextMetrics(stripMarkdown(content))`
 * for realistic markdown. The one documented divergence is charsWithSpaces
 * when stray invisible whitespace sits at block edges next to a blank line —
 * the incremental version counts exactly one blank-line separator (2 chars)
 * between non-empty blocks (see module header of incrementalTextMetrics.ts).
 */
import { describe, expect, it } from "vitest";
import { computeTextMetrics, stripMarkdown } from "./statusTextMetrics";
import { createMetricsCache } from "./incrementalTextMetrics";
import { generateCjkMarkdown, generateMarkdown } from "@/bench/helpers";

/** Direct (non-cached) reference pipeline — the behavior we must match. */
function reference(content: string) {
  return computeTextMetrics(stripMarkdown(content));
}

function expectEquivalent(content: string) {
  const compute = createMetricsCache();
  expect(compute(content)).toEqual(reference(content));
}

describe("createMetricsCache — equivalence with the direct pipeline", () => {
  it("empty document", () => {
    expectEquivalent("");
  });

  it("whitespace-only document", () => {
    expectEquivalent("\n\n  \n\n");
  });

  it("single paragraph", () => {
    expectEquivalent("Hello world, this is one paragraph.");
  });

  it("multiple paragraphs", () => {
    expectEquivalent("First paragraph.\n\nSecond paragraph.\n\nThird one.");
  });

  it("headings, lists, quotes, hr, emphasis, links, images", () => {
    expectEquivalent(
      [
        "# Title",
        "Some **bold** and *italic* text with `inline code`.",
        "- item one\n- item two",
        "1. numbered\n2. list",
        "> a quote",
        "---",
        "[link text](https://example.com) and ![alt](img.png)",
      ].join("\n\n"),
    );
  });

  it("fenced code block is stripped entirely", () => {
    expectEquivalent("Before.\n\n```\ncode here\n```\n\nAfter.");
  });

  it("fenced code block containing blank lines stays atomic", () => {
    // The fence interior contains \n\n — a naive blank-line split would
    // break the fence pair and stop stripping it.
    expectEquivalent("A\n\n```\nfirst\n\nsecond\n\nthird\n```\n\nB");
  });

  it("unpaired trailing fence marker is literal text", () => {
    expectEquivalent("A\n\n```\nunclosed\n\nB");
  });

  it("four-backtick fence pairs like the reference regex", () => {
    expectEquivalent("````\nx\n````");
  });

  it("multiple fences with prose between", () => {
    expectEquivalent(
      "P1\n\n```js\na\n\nb\n```\n\nP2\n\n```py\nc\n```\n\nP3",
    );
  });

  it("blank-line runs of 3+ newlines collapse identically", () => {
    expectEquivalent("A\n\n\n\nB\n\n\nC");
  });

  it("leading and trailing blank lines", () => {
    expectEquivalent("\n\nA\n\nB\n\n");
  });

  it("repeated identical paragraphs (duplicate cache keys)", () => {
    expectEquivalent("Same text.\n\nSame text.\n\nSame text.");
  });

  it("CJK content: words, cjk chars, punctuation", () => {
    expectEquivalent(
      "第一段：中文内容，包含标点。\n\n第二段：日本語のテキストです。\n\nMixed 中英 paragraph!",
    );
  });

  it("emoji and astral characters count once", () => {
    expectEquivalent("Emoji ✨🚀 here.\n\nAstral 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 and 𠀀 ideograph.");
  });

  it("realistic English corpus (bench generator)", () => {
    expectEquivalent(generateMarkdown(300));
  });

  it("realistic CJK corpus (bench generator)", () => {
    expectEquivalent(generateCjkMarkdown(300));
  });
});

describe("createMetricsCache — incremental behavior", () => {
  it("same content twice returns identical results", () => {
    const compute = createMetricsCache();
    const doc = generateMarkdown(100);
    const first = compute(doc);
    const second = compute(doc);
    expect(second).toEqual(first);
    expect(second).toEqual(reference(doc));
  });

  it("editing one paragraph updates totals correctly", () => {
    const compute = createMetricsCache();
    const blocks = ["Alpha one.", "Beta two.", "Gamma three."];
    compute(blocks.join("\n\n"));
    const edited = ["Alpha one.", "Beta two edited with more words.", "Gamma three."];
    expect(compute(edited.join("\n\n"))).toEqual(reference(edited.join("\n\n")));
  });

  it("inserting and deleting blocks stays correct", () => {
    const compute = createMetricsCache();
    compute("A\n\nB\n\nC");
    expect(compute("A\n\nC")).toEqual(reference("A\n\nC"));
    expect(compute("A\n\nX\n\nB\n\nC")).toEqual(reference("A\n\nX\n\nB\n\nC"));
  });

  it("opening a fence mid-document reflows downstream blocks correctly", () => {
    const compute = createMetricsCache();
    const before = "A\n\nB\n\n```\ncode\n```\n\nC";
    compute(before);
    // Adding a lone ``` after A re-pairs all following fences.
    const after = "A\n\n```\n\nB\n\n```\ncode\n```\n\nC";
    expect(compute(after)).toEqual(reference(after));
  });

  it("switching to a completely different document (tab switch)", () => {
    const compute = createMetricsCache();
    compute(generateMarkdown(50));
    const other = generateCjkMarkdown(50);
    expect(compute(other)).toEqual(reference(other));
  });

  it("cache entries from two generations ago are evicted but results stay correct", () => {
    const compute = createMetricsCache();
    const docA = "One.\n\nTwo.";
    const docB = "Three.\n\nFour.";
    compute(docA);
    compute(docB);
    // docA's segments were dropped after the docB pass; recompute must still match.
    expect(compute(docA)).toEqual(reference(docA));
  });
});

describe("createMetricsCache — CRLF content", () => {
  it("CRLF documents match the direct pipeline exactly", () => {
    expectEquivalent("A\r\n\r\nB\r\n\r\n- item\r\n\r\n```\r\ncode\r\n```");
  });

  it("CRLF content bypasses segmentation (kernel never invoked)", () => {
    // \n{2,} separators never occur in CRLF text, so segmentation would
    // produce one giant segment and defeat the cache. The implementation
    // must detect \r and fall back to the direct pipeline instead.
    let kernelCalls = 0;
    const compute = createMetricsCache({
      onSegmentComputed: () => kernelCalls++,
    });
    const crlf = "A\r\n\r\nB";
    expect(compute(crlf)).toEqual(reference(crlf));
    expect(kernelCalls).toBe(0);
  });
});

describe("createMetricsCache — cache effectiveness (kernel invocation counts)", () => {
  it("recomputes only the edited block on a warm pass", () => {
    let kernelCalls = 0;
    const compute = createMetricsCache({
      onSegmentComputed: () => kernelCalls++,
    });
    const blocks = ["Alpha one.", "Beta two.", "Gamma three."];
    compute(blocks.join("\n\n"));
    expect(kernelCalls).toBe(3);

    kernelCalls = 0;
    const edited = ["Alpha one.", "Beta two EDITED.", "Gamma three."];
    compute(edited.join("\n\n"));
    expect(kernelCalls).toBe(1); // only the edited block pays the kernel cost
  });

  it("duplicate segments share one kernel invocation within a pass", () => {
    let kernelCalls = 0;
    const compute = createMetricsCache({
      onSegmentComputed: () => kernelCalls++,
    });
    compute("Same text.\n\nSame text.\n\nSame text.");
    expect(kernelCalls).toBe(1);
  });

  it("entries unused for two generations are evicted", () => {
    let kernelCalls = 0;
    const compute = createMetricsCache({
      onSegmentComputed: () => kernelCalls++,
    });
    compute("One.\n\nTwo.");
    compute("Three.\n\nFour.");
    kernelCalls = 0;
    compute("One.\n\nTwo."); // dropped after the docB pass — must recompute
    expect(kernelCalls).toBe(2);
  });
});

describe("createMetricsCache — documented charsWithSpaces separator semantics", () => {
  it("counts exactly one blank-line separator between non-empty blocks", () => {
    const compute = createMetricsCache();
    // "A \n\n B": the direct pipeline keeps the stray spaces adjacent to the
    // blank line (8 chars); the incremental version counts trimmed blocks
    // plus a 2-char separator (4 chars). Deliberate, documented divergence:
    // invisible edge whitespace is not counted.
    expect(compute("A \n\n B").charsWithSpaces).toBe(4);
  });

  it("whitespace-insensitive metrics are exact even with stray edge whitespace", () => {
    const compute = createMetricsCache();
    const doc = "A \n\n B";
    const ref = reference(doc);
    const got = compute(doc);
    expect(got.words).toBe(ref.words);
    expect(got.charsNoSpaces).toBe(ref.charsNoSpaces);
    expect(got.cjkChars).toBe(ref.cjkChars);
    expect(got.charsNoPunctuation).toBe(ref.charsNoPunctuation);
  });
});
