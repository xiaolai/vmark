// @vitest-environment node
// WI-AL1.4 — The block map certifies a WYSIWYG window block by block: an identity window has no breaks; every break is named by why it broke — a touched block (pm-touched), a block inserted (pm-inserted) or removed (pm-removed), a paired block whose serialization changed (serialization-changed), or only a separator between paired blocks (separator); multi-block inserts, deletes and a reorder each stay bounded; empty spans are adjacency glue only, but a touched block with no characters is a zero-width break (WI-AL2.0: a net-zero edit of an empty document is never an identity); head and tail text join a run only at the document edge; CJK and astral text are measured in UTF-16 units; and pairs that cannot tile both images (an invariant failure upstream) yield a problem, never ranges.
import { describe, expect, it } from "vitest";
import type { BlockSpan } from "@/utils/markdownPipeline/serializerSpans";
import { blockRanges, type SpannedText } from "../blockMap";

/** Blocks joined by `sep` (one per gap, or one string for all), with a trailing newline. */
function md(blocks: readonly string[], sep: string | readonly string[] = "\n\n"): SpannedText {
  const spans: BlockSpan[] = [];
  let markdown = "";
  blocks.forEach((b, i) => {
    if (i > 0) markdown += typeof sep === "string" ? sep : sep[i - 1];
    spans.push({ from: markdown.length, to: markdown.length + b.length });
    markdown += b;
  });
  return { markdown: markdown + "\n", spans };
}

const all = (n: number) => Array.from({ length: n }, (_, i) => [i, i] as const);

describe("blockRanges", () => {
  it("an identity window has no breaks", () => {
    const t = md(["# A", "b", "c"]);
    expect(blockRanges(t, t, all(3), "w")).toEqual([]);
  });

  it("a touched block is one bounded pm-touched break between its paired neighbours", () => {
    const base = md(["aa", "bb", "cc"]);
    const head = md(["aa", "bXb", "cc"]);
    expect(blockRanges(base, head, [[0, 0], [2, 2]], "w")).toEqual([{ from: 2, to: 8, insert: 7, origin: "w:pm-touched" }]);
  });

  it("an inserted block is a pm-inserted break that replaces only the separator", () => {
    const base = md(["aa", "bb"]);
    const head = md(["aa", "new", "bb"]);
    expect(blockRanges(base, head, [[0, 0], [1, 2]], "w")).toEqual([{ from: 2, to: 4, insert: 7, origin: "w:pm-inserted" }]);
  });

  it("a removed block is a pm-removed break", () => {
    const base = md(["aa", "bb", "cc"]);
    const head = md(["aa", "cc"]);
    expect(blockRanges(base, head, [[0, 0], [2, 1]], "w")).toEqual([{ from: 2, to: 8, insert: 2, origin: "w:pm-removed" }]);
  });

  it("several blocks replaced at once stay one bounded break", () => {
    const base = md(["aa", "bb", "cc", "dd"]);
    const head = md(["aa", "x", "y", "z", "dd"]);
    expect(blockRanges(base, head, [[0, 0], [3, 4]], "w")).toEqual([{ from: 2, to: 12, insert: 11, origin: "w:pm-touched" }]);
  });

  it("a reorder breaks where the moved block left and where it landed, certifying the rest", () => {
    const base = md(["aa", "bb", "cc"]);
    const head = md(["bb", "cc", "aa"]);
    expect(blockRanges(base, head, [[1, 0], [2, 1]], "w")).toEqual([
      { from: 0, to: 4, insert: 0, origin: "w:pm-removed" },
      { from: 10, to: 11, insert: 5, origin: "w:pm-inserted" },
    ]);
  });

  it("a paired block whose serialization changed is a serialization-changed break", () => {
    const base = md(["aa", "1. b", "cc"]);
    const head = md(["aa", "1) b", "cc"]);
    expect(blockRanges(base, head, all(3), "w")).toEqual([{ from: 2, to: 10, insert: 8, origin: "w:serialization-changed" }]);
  });

  it("a changed separator between paired blocks is a separator break", () => {
    const base = md(["aa", "bb"]);
    const head = md(["aa", "bb"], "\n\n\n");
    expect(blockRanges(base, head, all(2), "w")).toEqual([{ from: 2, to: 4, insert: 3, origin: "w:separator" }]);
  });

  it("a changed trailing text is a separator break at the edge only", () => {
    const base = md(["aa", "bb"]);
    const head: SpannedText = { markdown: `${base.markdown}\n`, spans: base.spans };
    expect(blockRanges(base, head, all(2), "w")).toEqual([{ from: 6, to: 7, insert: 2, origin: "w:separator" }]);
  });

  it("an empty span is adjacency glue: it certifies nothing itself, and losing it breaks the separator it sat in", () => {
    const base = md(["aa", "", "bb"], ["\n\n", ""]);
    expect(base.spans[1]).toEqual({ from: 4, to: 4 });
    expect(blockRanges(base, base, all(3), "w")).toEqual([]);
    const head = md(["aa", "bb"]);
    expect(blockRanges(base, head, [[0, 0], [2, 1]], "w")).toEqual([{ from: 2, to: 4, insert: 2, origin: "w:separator" }]);
  });

  it("a touched block with no characters of its own is a zero-width break, never an identity", () => {
    const empty: SpannedText = { markdown: "", spans: [{ from: 0, to: 0 }] };
    expect(blockRanges(empty, empty, [], "w")).toEqual([{ from: 0, to: 0, insert: 0, origin: "w:pm-touched" }]);
    // A paired empty block is glue: still nothing.
    expect(blockRanges(empty, empty, [[0, 0]], "w")).toEqual([]);
  });

  it("an empty document against a non-empty one is one break", () => {
    const empty: SpannedText = { markdown: "", spans: [] };
    expect(blockRanges(empty, md(["aa"]), [], "w")).toEqual([{ from: 0, to: 0, insert: 3, origin: "w:pm-inserted" }]);
    expect(blockRanges(md(["aa"]), empty, [], "w")).toEqual([{ from: 0, to: 3, insert: 0, origin: "w:pm-removed" }]);
    expect(blockRanges(empty, empty, [], "w")).toEqual([]);
  });

  it("measures CJK and astral text in UTF-16 units", () => {
    const base = md(["读书", "😀😀", "末"]);
    const head = md(["读书", "😀中😀", "末"]);
    expect(blockRanges(base, head, [[0, 0], [2, 2]], "w")).toEqual([{ from: 2, to: 10, insert: 9, origin: "w:pm-touched" }]);
  });

  it("pairs that cannot tile both images are a problem, never ranges", () => {
    const base = md(["aa", "bb"]);
    const head = md(["bb", "aa"]);
    const out = blockRanges(base, head, [[0, 1], [1, 0]], "w");
    expect(out).toEqual({ problem: expect.stringMatching(/misplaced/) });
  });
});
