/**
 * Source-mode block placement: caret mapping and explicit ranges.
 *
 * A template's `cursorOffset` is measured against the UNINDENTED text, but
 * `insertBlockText` prefixes every line with the enclosing structure's
 * continuation prefix — so inside a list or quote the caret landed short by one
 * prefix per line, ending up in the markup instead of the first table cell.
 *
 * @coordinates-with sourceBlockPlacement.ts — insertBlockText, prependLineMarker
 * @coordinates-with sourceInsertActions.ts — insertTable integration
 * @module plugins/toolbarActions/sourceBlockPlacement.test
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { insertBlockText, prependLineMarker, replaceLinesWithBlock } from "./sourceBlockPlacement";
import { insertTable } from "./sourceInsertActions";

vi.mock("@/plugins/sourcePopup/sourcePopupUtils", () => ({
  getAnchorRectFromRange: vi.fn(() => ({ top: 0, bottom: 20, left: 0, right: 100 })),
  getEditorBounds: vi.fn(() => ({ horizontal: { left: 0, right: 800 }, vertical: { top: 0, bottom: 600 } })),
  toHostCoordsForDom: vi.fn((_: unknown, pos: unknown) => pos),
}));

const views: EditorView[] = [];

function createView(doc: string, ranges: Array<{ from: number; to?: number }>): EditorView {
  const parent = document.createElement("div");
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.create(ranges.map((r) => EditorSelection.range(r.from, r.to ?? r.from))),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    }),
    parent,
  });
  views.push(view);
  return view;
}

afterEach(() => {
  views.forEach((v) => {
    try {
      v.destroy();
    } catch {
      /* already destroyed */
    }
  });
  views.length = 0;
});

// Audit R2 (#870): only the PREFIXED path bounded the offset (at its loop's
// end). The unprefixed early return forwarded the caller's number as an
// anchor, and these offsets are computed — `sourceInsertActions` adds a quote
// prefix per line — so one past the block's end throws on the selection.
describe("insertBlockText clamps a cursor offset that is out of range", () => {
  it.each([
    { name: "past the end of the block", offset: 999 },
    { name: "negative", offset: -5 },
    { name: "not a number at all", offset: Number.NaN },
  ])("$name lands inside the document", ({ offset }) => {
    const view = createView("text", [{ from: 4 }]);
    expect(() => insertBlockText(view, "[TOC]", offset)).not.toThrow();
    const { anchor } = view.state.selection.main;
    expect(anchor).toBeGreaterThanOrEqual(0);
    expect(anchor).toBeLessThanOrEqual(view.state.doc.length);
  });

  it("clamps inside a quote too, where the prefix mapping runs", () => {
    const view = createView("> quoted", [{ from: 8 }]);
    insertBlockText(view, "[TOC]", 999);
    const { anchor } = view.state.selection.main;
    expect(anchor).toBeLessThanOrEqual(view.state.doc.length);
  });
});

describe("insertBlockText maps the caret offset through the continuation prefix", () => {
  it("lands the table caret in the first header cell inside a blockquote", () => {
    const view = createView("> quoted", [{ from: 3 }]);
    insertTable(view);
    const doc = view.state.doc.toString();
    expect(doc.startsWith("> quoted\n> |")).toBe(true);
    // First cell: after the quote prefix AND the template's own `| `.
    expect(view.state.selection.main.from).toBe("> quoted\n> | ".length);
  });

  it("keeps the caret on the same template character across a crossed newline", () => {
    const view = createView("- item", [{ from: 2 }]);
    insertBlockText(view, "AA\nBB", 4);
    expect(view.state.doc.toString()).toBe("- item\n  AA\n  BB");
    // Offset 4 sits between the two Bs; the mapped caret must too.
    expect(view.state.selection.main.from).toBe("- item\n  AA\n  B".length);
  });

  it("counts a blank line's TRIMMED prefix, not the full one", () => {
    const view = createView("> quoted", [{ from: 3 }]);
    insertBlockText(view, "$$\n\n$$", 3);
    expect(view.state.doc.toString()).toBe("> quoted\n> $$\n>\n> $$");
    // The caret lands at the end of the bare `>` continuation line.
    expect(view.state.selection.main.from).toBe("> quoted\n> $$\n>".length);
  });

  it("clamps an offset past the template's end to the body's end", () => {
    const view = createView("> q", [{ from: 1 }]);
    insertBlockText(view, "AB", 99);
    expect(view.state.doc.toString()).toBe("> q\n> AB");
    expect(view.state.selection.main.from).toBe("> q\n> AB".length);
  });

  it("keeps the raw offset when there is no prefix to cross", () => {
    const view = createView("para", [{ from: 2 }]);
    insertBlockText(view, "AA\nBB", 4);
    expect(view.state.doc.toString()).toBe("para\nAA\nBB");
    expect(view.state.selection.main.from).toBe("para\nAA\nB".length);
  });
});

describe("replaceLinesWithBlock replaces exactly the supplied range", () => {
  it("replaces the range and offsets the caret from its start", () => {
    const view = createView("one\ntwo\nthree", [{ from: 5 }]);
    replaceLinesWithBlock(view, "X", 1, { from: 4, to: 7 });
    expect(view.state.doc.toString()).toBe("one\nX\nthree");
    expect(view.state.selection.main.from).toBe(5);
  });
});

describe("prependLineMarker with an explicit position", () => {
  it("marks the line at pos, not the main selection's line", () => {
    const view = createView("alpha\nbeta", [{ from: 0 }]);
    prependLineMarker(view, "- ", 8);
    expect(view.state.doc.toString()).toBe("alpha\n- beta");
  });

  it("preserves the other cursors of a multi-selection", () => {
    const view = createView("alpha\nbeta", [{ from: 2 }, { from: 8 }]);
    prependLineMarker(view, "- ", 8);
    expect(view.state.doc.toString()).toBe("alpha\n- beta");
    const ranges = view.state.selection.ranges;
    expect(ranges.length).toBe(2);
    expect(ranges[0].from).toBe(2);
    expect(ranges[1].from).toBe(10);
  });
});

// WI-FL3.10 — `[TOC]` is paragraph-level markdown: without a blank line above
// it, it lazily continues the paragraph and is never its own block. The setext
// separator already existed for `---`; this is the second member of the class.
describe("insertBlockText keeps a standalone block off the text line above it", () => {
  it("opens a blank line between a paragraph and the block", () => {
    const view = createView("The quick brown fox", [{ from: 4 }]);
    insertBlockText(view, "[TOC]\n", undefined, { standalone: true });
    expect(view.state.doc.toString()).toBe("The quick brown fox\n\n[TOC]\n");
  });

  it("quotes the separator inside a blockquote so the quote continues", () => {
    const view = createView("> quoted", [{ from: 3 }]);
    insertBlockText(view, "[TOC]\n", undefined, { standalone: true });
    // The trailing blank line carries the trimmed `>` too (a bare blank line
    // would end the quote) — the same shape `---` already produces here.
    expect(view.state.doc.toString()).toBe("> quoted\n>\n> [TOC]\n>");
  });

  it("indents under a list item and keeps the gap from the item's text", () => {
    const view = createView("- item", [{ from: 3 }]);
    insertBlockText(view, "[TOC]\n", undefined, { standalone: true });
    expect(view.state.doc.toString()).toBe("- item\n\n  [TOC]\n");
  });

  it("keeps the gap when the block replaces the only empty line between two paragraphs", () => {
    const view = createView("prev\n\nnext", [{ from: 5 }]);
    insertBlockText(view, "[TOC]\n", undefined, { standalone: true });
    expect(view.state.doc.toString()).toBe("prev\n\n[TOC]\n\nnext");
  });

  it("adds no separator when the line above is already blank", () => {
    const view = createView("prev\n\n\nnext", [{ from: 6 }]);
    insertBlockText(view, "[TOC]\n", undefined, { standalone: true });
    expect(view.state.doc.toString()).toBe("prev\n\n[TOC]\n\nnext");
  });

  it("adds no separator on the first line of the document", () => {
    const view = createView("", [{ from: 0 }]);
    insertBlockText(view, "[TOC]\n", undefined, { standalone: true });
    expect(view.state.doc.toString()).toBe("[TOC]\n");
  });

  it("leaves a non-standalone block attached directly below the line", () => {
    const view = createView("The quick brown fox", [{ from: 4 }]);
    insertBlockText(view, "```\ncode\n```\n");
    expect(view.state.doc.toString()).toBe("The quick brown fox\n```\ncode\n```\n");
  });

  it("no longer turns the paragraph above an empty line into a setext heading for `---`", () => {
    const view = createView("prev\n\nnext", [{ from: 5 }]);
    insertBlockText(view, "---\n");
    expect(view.state.doc.toString()).toBe("prev\n\n---\n\nnext");
  });
});

/**
 * Audit R2 #869/#872 — CommonMark whitespace, not `\s` / `.trim()`.
 *
 * `.trim()` and `\s` both treat NBSP and the ideographic space as whitespace;
 * CommonMark treats neither as blank. Reading such a line as empty made the
 * insertion REPLACE it, and reading `###` + NBSP as a heading run deleted the
 * literal hashes.
 */
describe("blankness and heading runs follow CommonMark, not Unicode whitespace", () => {
  const NBSP = "\u00a0";
  const IDEOGRAPHIC_SPACE = "\u3000";

  it("does not delete a line holding only an ideographic space", () => {
    const view = createView(`prev\n${IDEOGRAPHIC_SPACE}\nnext`, [{ from: 5 }]);
    insertBlockText(view, "---\n");
    expect(view.state.doc.toString()).toContain(IDEOGRAPHIC_SPACE);
  });

  it("still replaces a line holding only spaces and tabs", () => {
    const view = createView("prev\n \t \nnext", [{ from: 5 }]);
    insertBlockText(view, "---\n");
    expect(view.state.doc.toString()).toBe("prev\n\n---\n\nnext");
  });

  it("protects a NBSP-only line above with a separator", () => {
    const view = createView(`${NBSP}\n\nnext`, [{ from: 2 }]);
    insertBlockText(view, "---\n");
    expect(view.state.doc.toString()).toBe(`${NBSP}\n\n---\n\nnext`);
  });

  it("keeps the literal hashes when `###` is followed by a NBSP", () => {
    const view = createView(`###${NBSP}Title`, [{ from: 8 }]);
    prependLineMarker(view, "- ");
    expect(view.state.doc.toString()).toBe(`- ###${NBSP}Title`);
  });

  it("still replaces a real ATX heading run", () => {
    const view = createView("### Title", [{ from: 8 }]);
    prependLineMarker(view, "- ");
    expect(view.state.doc.toString()).toBe("- Title");
  });

  it("does not treat a leading NBSP as indentation before the marker", () => {
    const view = createView(`${NBSP}text`, [{ from: 3 }]);
    prependLineMarker(view, "- ");
    expect(view.state.doc.toString()).toBe(`- ${NBSP}text`);
  });
});

// Audit R3 #871 — the continuation prefix reimplemented container grammar and
// got three things wrong. `containerPrefixParts` (plugins/shared) is the ONE
// walk that already knows how containers nest; the prefix now derives from it.
// A plain one-line block is used throughout: `---` is underline-shaped and
// attracts a separator line, which is a different rule.
describe("continuation prefix — the container grammar, not a second copy of it", () => {
  function prefixedLine(doc: string): string {
    const view = createView(doc, [{ from: doc.length }]);
    insertBlockText(view, "NOTE\n");
    return view.state.doc.line(2).text;
  }

  it("does not count a task checkbox as list indentation", () => {
    // `- [ ] ` is six characters but the item's content column is 2. Six spaces
    // of continuation inside a two-column item is four spaces past it — an
    // INDENTED CODE BLOCK, so the inserted block rendered as literal text.
    expect(prefixedLine("- [ ] task")).toBe("  NOTE");
  });

  it("keeps a block inside a blockquote nested in a list item", () => {
    // Containers nest in any order. Matching quotes-then-one-list read `- > x`
    // as a bare list item, so the block left the quote.
    expect(prefixedLine("- > quoted")).toBe("  > NOTE");
  });

  it("keeps a block inside a list nested in a list", () => {
    expect(prefixedLine("- - deep")).toBe("    NOTE");
  });

  it("does not read a four-space-indented line as a list continuation", () => {
    // `^\s*` accepted any indent, so an indented code line beginning with `-`
    // contributed a marker. CommonMark caps a list marker's indent at three.
    expect(prefixedLine("    - not a list")).toBe("NOTE");
  });

  it("does not read a ten-digit ordered marker as a list", () => {
    // CommonMark caps an ordered marker at nine digits; `\d+` accepted any run.
    expect(prefixedLine("1234567890. not a list")).toBe("NOTE");
  });

  it("still indents inside an ordinary ordered item", () => {
    expect(prefixedLine("1. first")).toBe("   NOTE");
  });

  it("still repeats a blockquote marker verbatim", () => {
    expect(prefixedLine("> quoted")).toBe("> NOTE");
  });

  it("measures a tab-indented list item in COLUMNS, not characters", () => {
    // `-\t` advances to column 4, so the continuation is four spaces. Copying
    // the marker's character count would have given two.
    expect(prefixedLine("-\titem")).toBe("    NOTE");
  });
});
