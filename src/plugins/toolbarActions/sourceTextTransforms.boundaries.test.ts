/**
 * Boundary behaviour of the source line operations, with the REAL transform
 * utils.
 *
 * The sibling test file mocks `@/utils/textTransformations` with INCLUSIVE-`to`
 * reimplementations. The real utils honour CodeMirror's exclusive `to` (a
 * selection ending at a line start does not include that line), so those mocks
 * cannot see the class of bug where the handler's own line arithmetic disagrees
 * with what the util actually operates on. These tests use the real thing.
 *
 * @coordinates-with sourceTextTransforms.ts
 * @coordinates-with sourceBlockMove.ts
 * @module plugins/toolbarActions/sourceTextTransforms.boundaries.test
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: { getState: vi.fn(() => ({ getDocument: vi.fn(() => null) })) },
}));

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  handleMoveLineDown,
  handleMoveLineUp,
  handleDuplicateLine,
  handleJoinLines,
  handleSortLinesAsc,
  handleSortLinesDesc,
} from "./sourceTextTransforms";

function createView(doc: string, from: number, to?: number): EditorView {
  const parent = document.createElement("div");
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to ?? from),
  });
  return new EditorView({ state, parent });
}

describe("exclusive-to: a selection ending at a line START does not include that line", () => {
  it("move down moves only the line actually selected", () => {
    // "a\n" is offsets 0-1; "b" starts at 2. Selecting 0..2 covers exactly
    // "a\n" — the caret merely TOUCHES b's start. lineAt(to) resolved to b's
    // line and moved an untouched line.
    const view = createView("a\nb\nc", 0, 2);
    expect(handleMoveLineDown(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("b\na\nc");
    view.destroy();
  });

  it("duplicate classifies the SELECTED line for the hard break, not the next one", () => {
    // Selecting "para\n" (0..5) duplicates line 0 only — the util already
    // honours the exclusive `to`. The hard-break decision read lineAt(to),
    // classified "# head", and skipped the break the paragraph needs.
    const view = createView("para\n# head", 0, 5);
    expect(handleDuplicateLine(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("para\\\npara\n# head");
    view.destroy();
  });

  it("join is not refused by a structural line the selection only touches", () => {
    // "a\nb\n" = 0..3, "- c" starts at 4. Selecting 0..4 joins a and b only;
    // reading the end line from `to` saw the list item and refused a valid join.
    const view = createView("a\nb\n- c", 0, 4);
    expect(handleJoinLines(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("a b\n- c");
    view.destroy();
  });
});

describe("move selection restore targets the MOVED block, not the first identical text", () => {
  it("keeps the selection on the moved copy when an earlier duplicate exists", () => {
    // "dup\na\ndup\nb" — moving line 2's "dup" down swaps it with "b".
    // indexOf(movedText) found line 0's identical "dup" and warped the
    // selection to the top of the file.
    const view = createView("dup\na\ndup\nb", 6, 6);
    expect(handleMoveLineDown(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("dup\na\nb\ndup");
    const { from, to } = view.state.selection.main;
    // The moved "dup" now occupies offsets 8..11.
    expect(view.state.doc.sliceString(from, to)).toBe("dup");
    expect(from).toBe(8);
    view.destroy();
  });
});

describe("sorting respects fence delimiters", () => {
  it("refuses a selection that includes a fence opener", () => {
    // Sorting "```" into the middle of its own content destroys the fence and
    // exposes the rest of the file as code. The sibling duplicate/delete
    // handlers already refuse this; sort was missing the same guard.
    const doc = "```\nb\na\n```";
    const view = createView(doc, 0, doc.length);
    expect(handleSortLinesAsc(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });

  it("refuses descending as well", () => {
    const doc = "a\n```\nz\n```";
    const view = createView(doc, 0, doc.length);
    expect(handleSortLinesDesc(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });

  it("still sorts CONTENT lines inside a fence — literal-line semantics", () => {
    // The reason sort is on the code-block allow-list at all.
    const view = createView("```\nb\na\n```", 4, 7);
    expect(handleSortLinesAsc(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("```\na\nb\n```");
    view.destroy();
  });

  it("still sorts plain lines outside any fence", () => {
    const view = createView("b\na", 0, 3);
    expect(handleSortLinesAsc(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("a\nb");
    view.destroy();
  });
});

describe("blank-line selections do not move", () => {
  it("refuses to swap a blank separator with a paragraph", () => {
    // ["a", "", "b"] — moving the blank up gave ["", "a", "b"], fusing a and b
    // into one paragraph: the exact structural damage this module exists to
    // prevent.
    const view = createView("a\n\nb", 2, 2);
    expect(handleMoveLineUp(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("a\n\nb");
    view.destroy();
  });

  it("refuses downward too", () => {
    const view = createView("a\n\nb", 2, 2);
    expect(handleMoveLineDown(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("a\n\nb");
    view.destroy();
  });
});

describe("a list item moves WITH its continuation lines", () => {
  it("moving the marker line down keeps the continuation attached", () => {
    const view = createView("- parent\n  continuation\n- next", 0, 0);
    expect(handleMoveLineDown(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- next\n- parent\n  continuation");
    view.destroy();
  });

  it("moving the item below an item-with-continuation hops the WHOLE item", () => {
    const doc = "- parent\n  continuation\n- next";
    // caret on "- next" (offset 25)
    const view = createView(doc, 25, 25);
    expect(handleMoveLineUp(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- next\n- parent\n  continuation");
    view.destroy();
  });

  it("a nested child travels with its parent", () => {
    const view = createView("- a\n  - a1\n- b", 0, 0);
    expect(handleMoveLineDown(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- b\n- a\n  - a1");
    view.destroy();
  });
});
