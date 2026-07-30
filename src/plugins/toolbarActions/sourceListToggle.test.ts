/**
 * Source-mode list toggling.
 *
 * The toggles diverged from WYSIWYG in three ways at once, each invisible to the
 * single-line fixtures that existed before: re-applying the same list type did
 * nothing instead of turning the list off, the marker went outside a blockquote
 * instead of inside it, and a heading kept its `#` run so the result was a
 * bullet whose content was a heading.
 *
 * @coordinates-with sourceBlockActions.ts — handleListAction
 * @coordinates-with sourceAdapterHelpers.ts — prependLineMarker
 * @module plugins/toolbarActions/sourceListToggle.test
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { performSourceToolbarAction } from "./sourceAdapter";
import type { MultiSelectionContext } from "./types";

vi.mock("@/plugins/sourcePopup/sourcePopupUtils", () => ({
  getAnchorRectFromRange: vi.fn(() => ({ top: 0, bottom: 20, left: 0, right: 100 })),
  getEditorBounds: vi.fn(() => ({ horizontal: { left: 0, right: 800 }, vertical: { top: 0, bottom: 600 } })),
  toHostCoordsForDom: vi.fn((_: unknown, pos: unknown) => pos),
}));

const views: EditorView[] = [];

function createView(doc: string, cursor: number): EditorView {
  const parent = document.createElement("div");
  const view = new EditorView({
    state: EditorState.create({ doc, selection: EditorSelection.create([EditorSelection.cursor(cursor)]) }),
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

const singleSelection: MultiSelectionContext = {
  enabled: false, reason: "none", inCodeBlock: false, inTable: false, inList: false,
  inBlockquote: false, inHeading: false, inLink: false, inInlineMath: false,
  inFootnote: false, inImage: false, inTextblock: true, sameBlockParent: true,
  blockParentType: "paragraph",
};

function toggle(view: EditorView, action: string): boolean {
  return performSourceToolbarAction(action, { surface: "source", view, context: null, multiSelection: singleSelection });
}

describe("source list toggles", () => {
  it.each([
    { action: "bulletList", marker: "- " },
    { action: "orderedList", marker: "1. " },
    { action: "taskList", marker: "- [ ] " },
  ])("$action turns a paragraph into a list item", ({ action, marker }) => {
    const view = createView("The quick brown fox", 4);
    expect(toggle(view, action)).toBe(true);
    expect(view.state.doc.toString()).toBe(`${marker}The quick brown fox`);
  });

  it.each([
    { action: "bulletList", doc: "- item" },
    { action: "orderedList", doc: "1. item" },
    { action: "taskList", doc: "- [ ] item" },
  ])("$action turns the list OFF when re-applied to the same type", ({ action, doc }) => {
    const view = createView(doc, doc.length - 1);
    expect(toggle(view, action)).toBe(true);
    expect(view.state.doc.toString()).toBe("item");
  });

  it("converts between list types rather than toggling off", () => {
    const view = createView("- item", 4);
    toggle(view, "orderedList");
    expect(view.state.doc.toString()).toBe("1. item");
  });

  it.each([
    { action: "bulletList", expected: "> - quoted" },
    { action: "orderedList", expected: "> 1. quoted" },
    { action: "taskList", expected: "> - [ ] quoted" },
  ])("$action nests INSIDE a blockquote", ({ action, expected }) => {
    const view = createView("> quoted", 5);
    toggle(view, action);
    expect(view.state.doc.toString()).toBe(expected);
  });

  it.each([
    { action: "bulletList", expected: "- Title" },
    { action: "orderedList", expected: "1. Title" },
    { action: "taskList", expected: "- [ ] Title" },
  ])("$action replaces a heading run rather than keeping it", ({ action, expected }) => {
    const view = createView("### Title", 6);
    toggle(view, action);
    expect(view.state.doc.toString()).toBe(expected);
  });

  it("keeps indentation when converting an indented line", () => {
    const view = createView("  indented text", 8);
    toggle(view, "bulletList");
    expect(view.state.doc.toString()).toBe("  - indented text");
  });

  it("handles CJK content", () => {
    const view = createView("中文段落内容", 3);
    toggle(view, "bulletList");
    expect(view.state.doc.toString()).toBe("- 中文段落内容");
  });
});

/**
 * `insertBulletList` and `bulletList` are ONE command, not two.
 *
 * WYSIWYG has always routed both names to the same handler. Source routed the
 * `insert*` names straight at the marker-prepender, bypassing `handleListAction`
 * and therefore the "am I already in a list?" branch — so pressing the button on
 * an existing item prepended a SECOND marker: `- - two`, `1. - two`,
 * `- [ ] - The quick brown fox`. Not a nested list, not a toggle, just malformed.
 */
describe("insert* list actions are aliases of the toggles", () => {
  const PAIRS = [
    { insert: "insertBulletList", toggle: "bulletList" },
    { insert: "insertOrderedList", toggle: "orderedList" },
    { insert: "insertTaskList", toggle: "taskList" },
  ];

  const DOCS = [
    { label: "plain paragraph", doc: "The quick brown fox", cursor: 10 },
    { label: "existing bullet item", doc: "- The quick brown fox", cursor: 12 },
    { label: "existing ordered item", doc: "1. The quick brown fox", cursor: 13 },
    { label: "existing task item", doc: "- [ ] The quick brown fox", cursor: 16 },
    { label: "heading", doc: "### Title", cursor: 6 },
    { label: "middle of a multi-item list", doc: "- one\n- two brown\n- three", cursor: 12 },
  ];

  for (const { insert, toggle: toggleName } of PAIRS) {
    for (const { label, doc, cursor } of DOCS) {
      it(`${insert} matches ${toggleName} on a ${label}`, () => {
        const viaInsert = createView(doc, cursor);
        toggle(viaInsert, insert);
        const viaToggle = createView(doc, cursor);
        toggle(viaToggle, toggleName);
        expect(viaInsert.state.doc.toString()).toBe(viaToggle.state.doc.toString());
      });
    }
  }

  // A marker followed by ANOTHER marker. The optional `[ ]` in the middle is a
  // task checkbox, which legitimately follows a bullet — `- [ ] text` is a task
  // item, not a doubling — so it is skipped over rather than counted as one.
  const DOUBLED_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(?:[-*+]|\d+[.)])\s/m;

  it.each(PAIRS)("$insert never doubles an existing marker", ({ insert }) => {
    const view = createView("- one\n- two brown\n- three", 12);
    toggle(view, insert);
    expect(view.state.doc.toString()).not.toMatch(DOUBLED_MARKER);
  });

  it("the doubled-marker pattern actually matches the bug it describes", () => {
    // Guarding the guard: a regex that matched nothing would make the test above
    // pass vacuously, which is how the old `- - two` shipped under a green suite.
    expect("- - two brown").toMatch(DOUBLED_MARKER);
    expect("1. - two brown").toMatch(DOUBLED_MARKER);
    expect("- [ ] - two brown").toMatch(DOUBLED_MARKER);
    expect("- [ ] two brown").not.toMatch(DOUBLED_MARKER);
    expect("- two brown").not.toMatch(DOUBLED_MARKER);
  });
});
