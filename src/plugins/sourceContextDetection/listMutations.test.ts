/**
 * Single-item list mutations — direct module tests.
 *
 * Behaviour is also exercised through listDetection's re-exports; these pin
 * the module's own surface after the split out of listDetection, plus the
 * ordered-task cases the copy-paste converters used to get wrong.
 *
 * @module plugins/sourceContextDetection/listMutations.test
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({ general: { tabSize: 2 } }),
  },
}));

import { getListItemInfo } from "./listDetection";
import {
  indentListItem,
  outdentListItem,
  toBulletList,
  toOrderedList,
  toTaskList,
  removeList,
} from "./listMutations";

const views: EditorView[] = [];

function createView(doc: string, pos: number): EditorView {
  const state = EditorState.create({ doc, selection: EditorSelection.cursor(pos) });
  const view = new EditorView({ state, parent: document.createElement("div") });
  views.push(view);
  return view;
}

afterEach(() => {
  views.forEach((v) => v.destroy());
  views.length = 0;
});

describe("indentListItem / outdentListItem", () => {
  it("indents by the configured tab size", () => {
    const view = createView("- item", 2);
    indentListItem(view, getListItemInfo(view)!);
    expect(view.state.doc.toString()).toBe("  - item");
  });

  it("outdents and reports success", () => {
    const view = createView("  - item", 4);
    expect(outdentListItem(view, getListItemInfo(view)!)).toBe(true);
    expect(view.state.doc.toString()).toBe("- item");
  });

  it("reports failure at the outermost level", () => {
    const view = createView("- item", 2);
    expect(outdentListItem(view, getListItemInfo(view)!)).toBe(false);
    expect(view.state.doc.toString()).toBe("- item");
  });
});

describe("type conversion (shared converter)", () => {
  it("converts ordered to bullet", () => {
    const view = createView("1. item", 3);
    toBulletList(view, getListItemInfo(view)!);
    expect(view.state.doc.toString()).toBe("- item");
  });

  it("converts bullet to ordered", () => {
    const view = createView("- item", 2);
    toOrderedList(view, getListItemInfo(view)!);
    expect(view.state.doc.toString()).toBe("1. item");
  });

  it("converts bullet to task", () => {
    const view = createView("- item", 2);
    toTaskList(view, getListItemInfo(view)!);
    expect(view.state.doc.toString()).toBe("- [ ] item");
  });

  it("no-ops when already the target type", () => {
    const view = createView("- item", 2);
    toBulletList(view, getListItemInfo(view)!);
    expect(view.state.doc.toString()).toBe("- item");
  });

  it("preserves indentation across conversion", () => {
    const view = createView("  1. indented", 5);
    toBulletList(view, getListItemInfo(view)!);
    expect(view.state.doc.toString()).toBe("  - indented");
  });

  // "1. [x] done" IS already a task item in GFM. The old ordered-only regex
  // treated it as plain ordered, so toTaskList produced "- [ ] [x] done" —
  // a duplicated checkbox with the state lost.
  it("treats an ordered task as already a task (no duplicate checkbox)", () => {
    const view = createView("1. [x] done", 4);
    toTaskList(view, getListItemInfo(view)!);
    expect(view.state.doc.toString()).toBe("1. [x] done");
  });

  it("consumes the checkbox when converting an ordered task to bullet", () => {
    const view = createView("1. [x] done", 4);
    toBulletList(view, getListItemInfo(view)!);
    expect(view.state.doc.toString()).toBe("- done");
  });

  it("converts a close-paren ordered item", () => {
    const view = createView("1) item", 3);
    toBulletList(view, getListItemInfo(view)!);
    expect(view.state.doc.toString()).toBe("- item");
  });
});

describe("removeList", () => {
  it("strips the marker", () => {
    const view = createView("- item", 2);
    removeList(view, getListItemInfo(view)!);
    expect(view.state.doc.toString()).toBe("item");
  });

  it("strips a close-paren ordered marker", () => {
    const view = createView("1) item", 3);
    removeList(view, getListItemInfo(view)!);
    expect(view.state.doc.toString()).toBe("item");
  });

  it("pads a blank line against a list neighbour so the text leaves the list", () => {
    const view = createView("- one\n- two\n- three", 8);
    removeList(view, getListItemInfo(view)!);
    expect(view.state.doc.toString()).toBe("- one\n\ntwo\n\n- three");
  });
});
