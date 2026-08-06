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
