/**
 * Source-mode block builders must not lose text.
 *
 * `sourceAdapter.test.ts` covers the whole-document selection, where the
 * selected text and the replaced line range coincide so nothing can be lost. A
 * PARTIAL selection pulls them apart, and that is the case that regressed.
 *
 * @coordinates-with sourceInsertActions.ts — handleBuildInsert
 * @module plugins/toolbarActions/sourceBlockBuilders.test
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { MultiSelectionContext } from "./types";
import { performSourceToolbarAction } from "./sourceAdapter";
import { newTableMarkdown } from "@/plugins/shared/blockTemplates";

vi.mock("@/plugins/sourcePopup/sourcePopupUtils", () => ({
  getAnchorRectFromRange: vi.fn(() => ({ top: 0, bottom: 20, left: 0, right: 100 })),
  getEditorBounds: vi.fn(() => ({ horizontal: { left: 0, right: 800 }, vertical: { top: 0, bottom: 600 } })),
  toHostCoordsForDom: vi.fn((_: unknown, pos: unknown) => pos),
}));

const views: EditorView[] = [];

function createView(doc: string, ranges: Array<{ from: number; to: number }>): EditorView {
  const parent = document.createElement("div");
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.create(ranges.map((r) => EditorSelection.range(r.from, r.to))),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    }),
    parent,
  });
  views.push(view);
  return view;
}

afterEach(() => {
  views.forEach((v) => { try { v.destroy(); } catch { /* empty */ } });
  views.length = 0;
});

const singleSelection: MultiSelectionContext = {
  enabled: false, reason: "none", inCodeBlock: false, inTable: false, inList: false,
  inBlockquote: false, inHeading: false, inLink: false, inInlineMath: false,
  inFootnote: false, inImage: false, inTextblock: true, sameBlockParent: true,
  blockParentType: "paragraph",
};

describe("source block builders keep surrounding text", () => {
  // The test above selects the WHOLE document, so the selected text and the
  // replaced line range coincide and nothing can be lost. A PARTIAL selection
  // pulls them apart: the builder folded in only the selected characters while
  // the insertion replaced entire lines, so the rest of each line was deleted.
  it.each([
    { action: "insertAlertNote", contains: "> [!NOTE]" },
    { action: "insertDetails", contains: "<details" },
    { action: "insertMath", contains: "$$" },
    { action: "insertDiagram", contains: "```" },
  ])("$action keeps the unselected rest of the line", ({ action, contains }) => {
    const doc = "The quick brown fox";
    const view = createView(doc, [{ from: 10, to: 15 }]); // "brown"
    performSourceToolbarAction(action, {
      surface: "source",
      view,
      context: null,
      multiSelection: singleSelection,
    });
    const result = view.state.doc.toString();
    expect(result).toContain(contains);
    expect(result).toContain("The quick");
    expect(result).toContain("fox");
    view.destroy();
  });

  it("inserts table", () => {
    const view = createView("", [{ from: 0, to: 0 }]);
    const applied = performSourceToolbarAction("insertTable", {
      surface: "source",
      view,
      context: null,
      multiSelection: singleSelection,
    });
    expect(applied).toBe(true);
    expect(view.state.doc.toString()).toContain(newTableMarkdown().trimEnd());
    view.destroy();
  });

  it("insertTableBlock works same as insertTable", () => {
    const view = createView("", [{ from: 0, to: 0 }]);
    const applied = performSourceToolbarAction("insertTableBlock", {
      surface: "source",
      view,
      context: null,
      multiSelection: singleSelection,
    });
    expect(applied).toBe(true);
    expect(view.state.doc.toString()).toContain(newTableMarkdown().trimEnd());
    view.destroy();
  });

  it("inserts bullet list marker", () => {
    const view = createView("", [{ from: 0, to: 0 }]);
    const applied = performSourceToolbarAction("insertBulletList", {
      surface: "source",
      view,
      context: null,
      multiSelection: singleSelection,
    });
    expect(applied).toBe(true);
    expect(view.state.doc.toString()).toBe("- ");
    view.destroy();
  });

  it("inserts ordered list marker", () => {
    const view = createView("", [{ from: 0, to: 0 }]);
    const applied = performSourceToolbarAction("insertOrderedList", {
      surface: "source",
      view,
      context: null,
      multiSelection: singleSelection,
    });
    expect(applied).toBe(true);
    expect(view.state.doc.toString()).toBe("1. ");
    view.destroy();
  });

  it("inserts task list marker", () => {
    const view = createView("", [{ from: 0, to: 0 }]);
    const applied = performSourceToolbarAction("insertTaskList", {
      surface: "source",
      view,
      context: null,
      multiSelection: singleSelection,
    });
    expect(applied).toBe(true);
    expect(view.state.doc.toString()).toBe("- [ ] ");
    view.destroy();
  });

  it("converts ordered list to task list", () => {
    const view = createView("1. Item", [{ from: 3, to: 3 }]);
    const applied = performSourceToolbarAction("taskList", {
      surface: "source",
      view,
      context: null,
      multiSelection: singleSelection,
    });
    expect(applied).toBe(true);
    expect(view.state.doc.toString()).toBe("- [ ] Item");
    view.destroy();
  });

  it("returns false for indent/outdent/removeList when not in list", () => {
    const view = createView("not a list", [{ from: 0, to: 0 }]);
    for (const action of ["indent", "outdent", "removeList"]) {
      const applied = performSourceToolbarAction(action, {
        surface: "source",
        view,
        context: null,
        multiSelection: singleSelection,
      });
      expect(applied).toBe(false);
    }
    view.destroy();
  });

  it("returns false for blockquote operations when not in blockquote", () => {
    const view = createView("not a quote", [{ from: 0, to: 0 }]);
    for (const action of ["nestBlockquote", "unnestBlockquote", "removeBlockquote"]) {
      const applied = performSourceToolbarAction(action, {
        surface: "source",
        view,
        context: null,
        multiSelection: singleSelection,
      });
      expect(applied).toBe(false);
    }
    view.destroy();
  });

  it("inserts footnote syntax", () => {
    const view = createView("text", [{ from: 0, to: 4 }]);
    const applied = performSourceToolbarAction("insertFootnote", {
      surface: "source",
      view,
      context: null,
      multiSelection: singleSelection,
    });
    expect(applied).toBe(true);
    view.destroy();
  });

  it("inserts details block", () => {
    const view = createView("", [{ from: 0, to: 0 }]);
    const applied = performSourceToolbarAction("insertDetails", {
      surface: "source",
      view,
      context: null,
      multiSelection: singleSelection,
    });
    expect(applied).toBe(true);
    expect(view.state.doc.toString()).toContain("details");
    view.destroy();
  });

  it("inserts alert block with correct type", () => {
    const alertActions = [
      "insertAlertNote",
      "insertAlertTip",
      "insertAlertImportant",
      "insertAlertWarning",
      "insertAlertCaution",
    ];
    for (const action of alertActions) {
      const view = createView("", [{ from: 0, to: 0 }]);
      const applied = performSourceToolbarAction(action, {
        surface: "source",
        view,
        context: null,
        multiSelection: singleSelection,
      });
      expect(applied).toBe(true);
      // All alert blocks start with > [!TYPE]
      expect(view.state.doc.toString()).toContain("> [!");
      view.destroy();
    }
  });

  it("preserves a multi-line selection when inserting an alert (WI: no data loss)", () => {
    const doc = "line one\nline two";
    const view = createView(doc, [{ from: 0, to: doc.length }]);
    const applied = performSourceToolbarAction("insertAlertNote", {
      surface: "source",
      view,
      context: null,
      multiSelection: singleSelection,
    });
    expect(applied).toBe(true);
    expect(view.state.doc.toString()).toBe("> [!NOTE]\n> line one\n> line two");
    view.destroy();
  });
});
