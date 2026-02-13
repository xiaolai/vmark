/**
 * Tests for List Smart Indent/Outdent
 *
 * Tab on list lines adds tabSize spaces at line start.
 * Shift+Tab on list lines removes up to tabSize spaces from line start.
 * Non-list lines fall through (return false).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { listSmartIndent, listSmartOutdent } from "./listSmartIndent";

// Mock settings store — tabSize defaults to 2
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({ general: { tabSize: 2 } }),
  },
}));

// Track views for cleanup
const views: EditorView[] = [];

afterEach(() => {
  views.forEach((v) => v.destroy());
  views.length = 0;
});

/**
 * Create a CodeMirror EditorView with cursor indicated by ^.
 * For selections, use ^ for anchor and | for head.
 */
function createView(contentWithCursor: string): EditorView {
  const cursorPos = contentWithCursor.indexOf("^");
  const content = contentWithCursor.replace("^", "");

  const state = EditorState.create({
    doc: content,
    selection: { anchor: cursorPos },
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new EditorView({ state, parent: container });
  views.push(view);
  return view;
}

/**
 * Create a view with a multi-line selection spanning from line startLine to endLine (1-based).
 */
function createViewWithSelection(content: string, anchorLine: number, headLine: number): EditorView {
  const state = EditorState.create({ doc: content });
  const anchorPos = state.doc.line(anchorLine).from;
  const headPos = state.doc.line(headLine).to;

  const stateWithSel = EditorState.create({
    doc: content,
    selection: { anchor: anchorPos, head: headPos },
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new EditorView({ state: stateWithSel, parent: container });
  views.push(view);
  return view;
}

describe("listSmartIndent (Tab)", () => {
  it("indents unordered list item (- marker)", () => {
    const view = createView("- ^item");
    const handled = listSmartIndent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("  - item");
  });

  it("indents ordered list item (1. marker)", () => {
    const view = createView("1. ^item");
    const handled = listSmartIndent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("  1. item");
  });

  it("indents task list item (- [ ] marker)", () => {
    const view = createView("- [ ] ^task");
    const handled = listSmartIndent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("  - [ ] task");
  });

  it("indents * marker list item", () => {
    const view = createView("* ^item");
    const handled = listSmartIndent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("  * item");
  });

  it("indents + marker list item", () => {
    const view = createView("+ ^item");
    const handled = listSmartIndent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("  + item");
  });

  it("returns false for non-list line", () => {
    const view = createView("plain ^text");
    const handled = listSmartIndent(view);
    expect(handled).toBe(false);
    expect(view.state.doc.toString()).toBe("plain text");
  });

  it("adds another indent level to already-indented list item", () => {
    const view = createView("  - ^item");
    const handled = listSmartIndent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("    - item");
  });

  it("works with cursor at beginning of line text (after marker)", () => {
    const view = createView("- ^hello world");
    const handled = listSmartIndent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("  - hello world");
  });

  it("works with cursor at end of line", () => {
    const view = createView("- item^");
    const handled = listSmartIndent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("  - item");
  });

  it("works with cursor in the middle of text", () => {
    const view = createView("- hel^lo");
    const handled = listSmartIndent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("  - hello");
  });

  it("indents all list lines in multi-line selection", () => {
    const content = "- first\n- second\n- third";
    const view = createViewWithSelection(content, 1, 3);
    const handled = listSmartIndent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("  - first\n  - second\n  - third");
  });

  it("only indents list lines in mixed multi-line selection", () => {
    const content = "- first\nplain text\n- third";
    const view = createViewWithSelection(content, 1, 3);
    const handled = listSmartIndent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("  - first\nplain text\n  - third");
  });

  it("returns false for multi-line selection with no list lines", () => {
    const content = "plain one\nplain two";
    const view = createViewWithSelection(content, 1, 2);
    const handled = listSmartIndent(view);
    expect(handled).toBe(false);
  });
});

describe("listSmartOutdent (Shift+Tab)", () => {
  it("removes indent from indented list item", () => {
    const view = createView("  - ^item");
    const handled = listSmartOutdent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- item");
  });

  it("no-op on list item with no indent (still returns true)", () => {
    const view = createView("- ^item");
    const handled = listSmartOutdent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- item");
  });

  it("returns false for non-list line", () => {
    const view = createView("plain ^text");
    const handled = listSmartOutdent(view);
    expect(handled).toBe(false);
  });

  it("removes partial indent (1 space when tabSize=2)", () => {
    const view = createView(" - ^item");
    const handled = listSmartOutdent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- item");
  });

  it("removes only one indent level from deeply indented item", () => {
    const view = createView("    - ^item");
    const handled = listSmartOutdent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("  - item");
  });

  it("outdents all list lines in multi-line selection", () => {
    const content = "  - first\n  - second\n  - third";
    const view = createViewWithSelection(content, 1, 3);
    const handled = listSmartOutdent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- first\n- second\n- third");
  });

  it("only outdents list lines in mixed multi-line selection", () => {
    const content = "  - first\n  plain text\n  - third";
    const view = createViewWithSelection(content, 1, 3);
    const handled = listSmartOutdent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- first\n  plain text\n- third");
  });

  it("handles ordered list outdent", () => {
    const view = createView("  1. ^item");
    const handled = listSmartOutdent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("1. item");
  });

  it("outdents indented task list item", () => {
    const view = createView("  - [ ] ^task");
    const handled = listSmartOutdent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- [ ] task");
  });

  it("outdents indented checked task list item", () => {
    const view = createView("  - [x] ^done");
    const handled = listSmartOutdent(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- [x] done");
  });

  it("returns false for multi-line selection with no list lines", () => {
    const content = "plain one\nplain two";
    const view = createViewWithSelection(content, 1, 2);
    const handled = listSmartOutdent(view);
    expect(handled).toBe(false);
  });
});
