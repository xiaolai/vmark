// @vitest-environment node
import { describe, it, expect } from "vitest";
import { sourceBlockSpan, selectionBlockSpan } from "./blockSpan";

/** `sourceBlockSpan` works on lines, so the fixtures are line arrays. */
const lines = (s: string): string[] => s.split("\n");

describe("sourceBlockSpan", () => {
  it("expands a mid-paragraph selection to the whole paragraph", () => {
    expect(sourceBlockSpan(lines("The quick brown fox"), 0, 0)).toEqual({ start: 0, end: 0 });
  });

  it("expands to every line of a multi-line paragraph", () => {
    const l = lines("one\ntwo\nthree");
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 0, end: 2 });
  });

  it("stops at a blank line — a blank separates blocks", () => {
    const l = lines("First para\n\nSecond para\n\nThird para");
    expect(sourceBlockSpan(l, 2, 2)).toEqual({ start: 2, end: 2 });
  });

  it("takes the WHOLE list when the selection is in one item", () => {
    // Wrapping a single item shatters the list into list / wrapped-item / list.
    const l = lines("- one\n- two\n- three");
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 0, end: 2 });
  });

  it("takes the whole list including nested items", () => {
    const l = lines("- outer\n  - inner\n- last");
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 0, end: 2 });
  });

  it("spans every block a multi-block selection touches", () => {
    const l = lines("First para\n\nSecond para\n\nThird para");
    expect(sourceBlockSpan(l, 0, 2)).toEqual({ start: 0, end: 2 });
  });

  it("keeps a blockquote whole", () => {
    const l = lines("> quoted one\n> quoted two");
    expect(sourceBlockSpan(l, 0, 0)).toEqual({ start: 0, end: 1 });
  });

  it("handles a selection already covering the whole document", () => {
    const l = lines("only line");
    expect(sourceBlockSpan(l, 0, 0)).toEqual({ start: 0, end: 0 });
  });

  it("returns the blank line itself when the selection is on one", () => {
    const l = lines("a\n\nb");
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 1, end: 1 });
  });

  it("clamps out-of-range indices rather than throwing", () => {
    const l = lines("a\nb");
    expect(sourceBlockSpan(l, -5, 99)).toEqual({ start: 0, end: 1 });
  });

  it("accepts a REVERSED range, since a selection can be dragged upward", () => {
    const l = lines("a\n\nb\nc");
    expect(sourceBlockSpan(l, 3, 2)).toEqual({ start: 2, end: 3 });
  });

  it("handles a document of one blank line", () => {
    expect(sourceBlockSpan([""], 0, 0)).toEqual({ start: 0, end: 0 });
  });

  it("handles a genuinely EMPTY array", () => {
    // The case above passes `[""]` — one empty string, not an empty array — so
    // it went on passing against the implementation that threw here.
    expect(sourceBlockSpan([], 0, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe("selectionBlockSpan", () => {
  // "alpha" @0, "" @6, "beta" @7. A selection of exactly `alpha\n` ends at
  // offset 6 — the START of the blank line. Reading the last line from `to`
  // lands on that blank, widens through it, and swallows `beta`; reading from
  // `to - 1` stays on `alpha`. The two answers DIFFER here, which is what makes
  // this a regression test rather than a restatement.
  const lines = ["alpha", "", "beta"];
  const lineNumberAt = (offset: number): number => (offset < 6 ? 1 : offset < 7 ? 2 : 3);

  it("stops at the block boundary when the selection ends at a line start", () => {
    expect(selectionBlockSpan(lines, 0, 6, lineNumberAt)).toEqual({ start: 0, end: 0 });
  });

  it("differs from the naive reading, proving the off-by-one is what is tested", () => {
    // The naive version resolved the last line from `to` rather than `to - 1`,
    // landing on the blank separator. It used to swallow `beta` outright; the
    // per-endpoint blank rule now stops that, but the naive span still drags
    // the separator line in — which is what the `to - 1` rule exists to avoid.
    const naive = sourceBlockSpan(lines, lineNumberAt(0) - 1, lineNumberAt(6) - 1);
    expect(naive).not.toEqual(selectionBlockSpan(lines, 0, 6, lineNumberAt));
    expect(naive).toEqual({ start: 0, end: 1 }); // includes the separator
  });

  it("treats a caret as a single point, not a range", () => {
    expect(selectionBlockSpan(lines, 7, 7, lineNumberAt)).toEqual({ start: 2, end: 2 });
  });

  it("widens to the whole block a mid-line selection sits in", () => {
    expect(selectionBlockSpan(lines, 1, 3, lineNumberAt)).toEqual({ start: 0, end: 0 });
  });
});

describe("sourceBlockSpan treats a fence as a hard boundary", () => {
  it("does not widen up through a closing fence", () => {
    // Markdown does not require a blank line after ```, so the paragraph below
    // one used to expand across the whole code block and hand it to the action.
    const l = lines("```js\ncode();\n```\nparagraph here");
    expect(sourceBlockSpan(l, 3, 3)).toEqual({ start: 3, end: 3 });
  });

  it("does not widen down through an opening fence", () => {
    const l = lines("paragraph here\n```js\ncode();\n```");
    expect(sourceBlockSpan(l, 0, 0)).toEqual({ start: 0, end: 0 });
  });

  it("keeps a fence containing a blank line whole", () => {
    const l = lines("```\na\n\nb\n```");
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 0, end: 4 });
  });

  it("still widens normally where no fence is involved", () => {
    expect(sourceBlockSpan(lines("one\ntwo\nthree"), 1, 1)).toEqual({ start: 0, end: 2 });
  });

  it("does not let a tilde run close a backtick fence", () => {
    const l = lines("```\n~~~\ncode\n```\nafter");
    expect(sourceBlockSpan(l, 4, 4)).toEqual({ start: 4, end: 4 });
  });
});

describe("sourceBlockSpan resolves each ENDPOINT independently", () => {
  // Blank endpoints were honoured only for collapsed selections; a range with
  // one blank end expanded straight through it into a block the user never
  // touched.
  it("a blank START endpoint stays on the blank line", () => {
    // Selecting the separator and "b" must not swallow "a".
    expect(sourceBlockSpan(["a", "", "b"], 1, 2)).toEqual({ start: 1, end: 2 });
  });

  it("a blank END endpoint stays on the blank line", () => {
    // Selecting "a" and the separator must not swallow "b".
    expect(sourceBlockSpan(["a", "", "b"], 0, 1)).toEqual({ start: 0, end: 1 });
  });

  it("a mixed fence/paragraph selection widens the paragraph END too", () => {
    // The fence branch returned early with only the fence side expanded,
    // leaving the paragraph endpoint mid-block — a partial replacement.
    const l = ["```", "x", "```", "para one", "para two"];
    expect(sourceBlockSpan(l, 1, 3)).toEqual({ start: 0, end: 4 });
  });

  it("a mixed paragraph/fence selection widens the paragraph START too", () => {
    const l = ["para one", "para two", "```", "x", "```"];
    expect(sourceBlockSpan(l, 1, 3)).toEqual({ start: 0, end: 4 });
  });
});

// Audit 20260907 (#440/#443): a blank line was the only paragraph boundary, so
// a caret in `para` above `# heading` handed BOTH lines to a block action — the
// heading's markup was then stripped into a fence, or the heading wrapped into
// a note the user never selected. Two block kinds are one line by grammar and
// never continue a paragraph: an ATX heading and a thematic break. Each is its
// own block and a boundary for its neighbours. `---` alone is ambiguous — under
// a paragraph line it is a setext underline — and stays with that paragraph.
// #440/#443, round 3: a blockquote is a CONTAINER, and a paragraph directly
// above one is not inside it. Resolving the two as one span handed
// `insertCodeBlock` a "block" whose `>` markers it then stripped — a quote the
// user never selected, destroyed. Depth, not the marker: `> a` / `> b` are one
// block, `para` / `> a` are two.
// #440/#443, round 3 (fallout): once the opening `---` became a one-line block,
// a caret inside YAML frontmatter produced a span starting at the first KEY.
// Every consumer anchors frontmatter at offset 0 of the slice it gets, so the
// keys read as prose and CJK formatting rewrote `title:` into `title：`.
describe("sourceBlockSpan keeps leading frontmatter whole", () => {
  const doc = lines("---\ntitle: post\nslug: my-post\n---\n\nbody");

  it("resolves any line of the frontmatter to the whole of it, delimiters included", () => {
    for (const line of [0, 1, 2, 3]) {
      expect(sourceBlockSpan(doc, line, line), `line ${line}`).toEqual({ start: 0, end: 3 });
    }
  });

  it("extends the START only — a selection reaching into the body keeps its end", () => {
    expect(sourceBlockSpan(doc, 1, 5)).toEqual({ start: 0, end: 5 });
  });

  it("leaves the body alone", () => {
    expect(sourceBlockSpan(doc, 5, 5)).toEqual({ start: 5, end: 5 });
  });

  it("is not frontmatter when the opener never closes — that is a thematic break", () => {
    const l = lines("---\njust text\nmore text");
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 1, end: 2 });
  });

  it("is not frontmatter mid-document: `---` there is a thematic break", () => {
    const l = lines("intro\n\n---\nkey: value\n---\n\nouttro");
    expect(sourceBlockSpan(l, 3, 3)).toEqual({ start: 3, end: 4 });
  });
});

describe("sourceBlockSpan bounds a span at a blockquote depth change (#440/#443)", () => {
  it("a quote directly under a paragraph is a block of its own", () => {
    const l = lines("para\n> quoted\nafter");
    expect(sourceBlockSpan(l, 0, 0)).toEqual({ start: 0, end: 0 });
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 1, end: 1 });
    expect(sourceBlockSpan(l, 2, 2)).toEqual({ start: 2, end: 2 });
  });

  it("keeps consecutive lines at the SAME depth together", () => {
    const l = lines("> one\n> two\n> three");
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 0, end: 2 });
  });

  it("stops at a nesting change instead of folding the outer quote in", () => {
    const l = lines("> one\n> > deeper");
    expect(sourceBlockSpan(l, 0, 0)).toEqual({ start: 0, end: 0 });
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 1, end: 1 });
  });

  it("a RANGE across the change still covers both, since the user selected both", () => {
    const l = lines("para\n> quoted");
    expect(sourceBlockSpan(l, 0, 1)).toEqual({ start: 0, end: 1 });
  });
});

describe("sourceBlockSpan treats one-line blocks as boundaries (#440/#443)", () => {
  it("a caret in a paragraph does not widen down into the ATX heading below it", () => {
    expect(sourceBlockSpan(lines("para\n# heading"), 0, 0)).toEqual({ start: 0, end: 0 });
  });

  it("a caret on an ATX heading resolves to the heading line alone", () => {
    expect(sourceBlockSpan(lines("para\n# heading\nmore"), 1, 1)).toEqual({ start: 1, end: 1 });
  });

  it("a caret in a paragraph does not widen up into the heading above it", () => {
    expect(sourceBlockSpan(lines("# heading\npara\nmore"), 2, 2)).toEqual({ start: 1, end: 2 });
  });

  it("adjacent headings are separate blocks", () => {
    const l = lines("## a\n### b");
    expect(sourceBlockSpan(l, 0, 0)).toEqual({ start: 0, end: 0 });
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 1, end: 1 });
  });

  it.each([
    ["a closed ATX heading", "# title #"],
    ["a heading indented up to three spaces", "   ## title"],
    ["an empty heading", "#"],
  ])("%s bounds the paragraph above it", (_label, heading) => {
    expect(sourceBlockSpan(lines(`para\n${heading}`), 0, 0)).toEqual({ start: 0, end: 0 });
  });

  it.each([
    ["a hashtag with no space is not a heading", "#hashtag"],
    ["seven hashes are not a heading", "####### seven"],
    ["four spaces of indent is code, not a heading", "    # code"],
  ])("%s, so the line stays in the paragraph", (_label, line) => {
    expect(sourceBlockSpan(lines(`para\n${line}`), 0, 0)).toEqual({ start: 0, end: 1 });
  });

  it.each(["***", "___", "* * *", "_ _ _", "  ****"])("a %s thematic break bounds the paragraph above and below", (rule) => {
    const l = lines(`para\n${rule}\nnext`);
    expect(sourceBlockSpan(l, 0, 0)).toEqual({ start: 0, end: 0 });
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 1, end: 1 });
    expect(sourceBlockSpan(l, 2, 2)).toEqual({ start: 2, end: 2 });
  });

  it("a `---` directly under a paragraph line is a setext underline and stays with it", () => {
    const l = lines("para\n---\nnext");
    expect(sourceBlockSpan(l, 0, 0)).toEqual({ start: 0, end: 1 });
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 0, end: 1 });
    expect(sourceBlockSpan(l, 2, 2)).toEqual({ start: 2, end: 2 });
  });

  it("a `---` under a heading cannot be an underline, so it is a break of its own", () => {
    const l = lines("# h\n---\npara");
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 1, end: 1 });
    expect(sourceBlockSpan(l, 2, 2)).toEqual({ start: 2, end: 2 });
  });

  it("a `---` after a blank line is a break, and a spaced `- - -` too", () => {
    expect(sourceBlockSpan(lines("a\n\n---\nb"), 3, 3)).toEqual({ start: 3, end: 3 });
    expect(sourceBlockSpan(lines("a\n\n- - -\nb"), 3, 3)).toEqual({ start: 3, end: 3 });
  });

  it("a `---` directly below a closing fence is a break", () => {
    expect(sourceBlockSpan(lines("```\nx\n```\n---\npara"), 4, 4)).toEqual({ start: 4, end: 4 });
  });

  it("a range the user dragged across a heading still spans everything it touches", () => {
    expect(sourceBlockSpan(lines("para\n# heading\nmore"), 0, 2)).toEqual({ start: 0, end: 2 });
  });

  it("a `#` line inside a fence is code, not a heading", () => {
    expect(sourceBlockSpan(lines("```\n# comment\n```"), 1, 1)).toEqual({ start: 0, end: 2 });
  });

  it("a `***` line inside a fence is code, not a break", () => {
    expect(sourceBlockSpan(lines("```\n***\nx\n```"), 2, 2)).toEqual({ start: 0, end: 3 });
  });
});
