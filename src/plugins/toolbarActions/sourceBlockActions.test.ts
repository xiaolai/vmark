/**
 * Multi-cursor list actions apply the SAME toggle/create semantics as the
 * single-cursor path, to every cursor, exactly once per structural block.
 *
 * The old short-circuit returned one boolean that conflated "no
 * multi-selection", "nothing applied", and "handled" — so a multi-cursor action
 * whose cursors were all outside lists fell through and marked only the main
 * cursor's line, and cursors in a list got conversion-only semantics with no
 * toggle and no dedupe.
 *
 * These are integration tests over FINAL DOCUMENTS, not booleans.
 *
 * @coordinates-with sourceBlockActions.ts — handleListAction
 * @module plugins/toolbarActions/sourceBlockActions.test
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { handleListAction } from "./sourceBlockActions";

vi.mock("@/plugins/sourcePopup/sourcePopupUtils", () => ({
  getAnchorRectFromRange: vi.fn(() => ({ top: 0, bottom: 20, left: 0, right: 100 })),
  getEditorBounds: vi.fn(() => ({ horizontal: { left: 0, right: 800 }, vertical: { top: 0, bottom: 600 } })),
  toHostCoordsForDom: vi.fn((_: unknown, pos: unknown) => pos),
}));

const views: EditorView[] = [];

function createView(doc: string, cursors: number[]): EditorView {
  const parent = document.createElement("div");
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.create(cursors.map((pos) => EditorSelection.cursor(pos))),
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

describe("multi-cursor list creation reaches EVERY cursor", () => {
  it.each([
    { action: "bulletList", expected: "- alpha\n- beta" },
    { action: "orderedList", expected: "1. alpha\n1. beta" },
    { action: "taskList", expected: "- [ ] alpha\n- [ ] beta" },
  ] as const)("$action marks both plain lines, not just the main cursor's", ({ action, expected }) => {
    const view = createView("alpha\nbeta", [2, 8]);
    expect(handleListAction(view, action)).toBe(true);
    expect(view.state.doc.toString()).toBe(expected);
  });

  it("keeps both cursors alive after the edit", () => {
    const view = createView("alpha\nbeta", [2, 8]);
    handleListAction(view, "bulletList");
    const ranges = view.state.selection.ranges;
    expect(ranges.length).toBe(2);
    expect(ranges.map((r) => r.from)).toEqual([4, 12]);
  });

  it("applies the toggle to a listed cursor AND creation to a plain one", () => {
    const view = createView("- item\n\npara", [2, 9]);
    expect(handleListAction(view, "bulletList")).toBe(true);
    expect(view.state.doc.toString()).toBe("item\n\n- para");
  });
});

describe("cursors sharing one structural block are processed once", () => {
  it("two cursors in ONE item toggle it off once, not twice", () => {
    const view = createView("- one\n- two", [2, 4]);
    expect(handleListAction(view, "bulletList")).toBe(true);
    expect(view.state.doc.toString()).toBe("one\n\n- two");
  });

  it("two cursors in one list convert it once — the second must not re-toggle it off", () => {
    const view = createView("1. one\n1. two", [3, 10]);
    expect(handleListAction(view, "bulletList")).toBe(true);
    expect(view.state.doc.toString()).toBe("- one\n- two");
  });
});

describe("per-item structure actions run at every distinct item", () => {
  it("removeList unlists both items", () => {
    const view = createView("- one\n- two", [2, 8]);
    expect(handleListAction(view, "removeList")).toBe(true);
    expect(view.state.doc.toString()).toBe("one\n\ntwo");
  });

  it("indent indents both items", () => {
    const view = createView("- one\n- two", [2, 8]);
    expect(handleListAction(view, "indent")).toBe(true);
    expect(view.state.doc.toString()).toMatch(/^\s+- one\n\s+- two$/);
  });

  it("outdent at the outermost level reports false and leaves the document alone", () => {
    const view = createView("- one\n- two", [2, 8]);
    expect(handleListAction(view, "outdent")).toBe(false);
    expect(view.state.doc.toString()).toBe("- one\n- two");
  });

  it("indent/outdent/removeList outside any list change nothing and do NOT fall through", () => {
    const view = createView("alpha\nbeta", [2, 8]);
    for (const action of ["indent", "outdent", "removeList"] as const) {
      expect(handleListAction(view, action)).toBe(false);
    }
    expect(view.state.doc.toString()).toBe("alpha\nbeta");
  });
});

describe("single-cursor semantics are unchanged", () => {
  it("converts the whole list to ordered from one cursor", () => {
    const view = createView("- one\n- two", [2]);
    expect(handleListAction(view, "orderedList")).toBe(true);
    expect(view.state.doc.toString()).toBe("1. one\n2. two");
  });

  it("outdent outside a list reports false", () => {
    const view = createView("plain", [2]);
    expect(handleListAction(view, "outdent")).toBe(false);
    expect(view.state.doc.toString()).toBe("plain");
  });
});
