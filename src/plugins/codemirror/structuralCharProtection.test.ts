/**
 * Tests for Structural Character Protection
 *
 * Prevents backspace/delete from accidentally removing:
 * - Table pipes (|)
 * - List markers (-, *, +, 1.)
 * - Blockquote markers (>)
 */

import { describe, it, expect, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  TABLE_ROW_PATTERN,
  LIST_ITEM_PATTERN,
  TASK_ITEM_PATTERN,
  BLOCKQUOTE_PATTERN,
  getCellStartPipePos,
  getListMarkerRange,
  getTaskMarkerRange,
  getBlockquoteMarkerInfo,
  smartBackspace,
  smartDelete,
} from "./structuralCharProtection";

// Track views for cleanup
const views: EditorView[] = [];

afterEach(() => {
  views.forEach((v) => v.destroy());
  views.length = 0;
});

/**
 * Create a CodeMirror EditorView with the given content and cursor position.
 * Cursor position is indicated by ^ in the content string.
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

describe("Structural Character Protection", () => {
  // Test the regex patterns used for detection

  describe("TABLE_ROW_PATTERN", () => {
    it("matches lines starting with pipe", () => {
      expect(TABLE_ROW_PATTERN.test("| cell")).toBe(true);
      expect(TABLE_ROW_PATTERN.test("|cell")).toBe(true);
    });

    it("matches lines with leading whitespace before pipe", () => {
      expect(TABLE_ROW_PATTERN.test("  | cell")).toBe(true);
      expect(TABLE_ROW_PATTERN.test("\t| cell")).toBe(true);
    });

    it("does not match lines without leading pipe", () => {
      expect(TABLE_ROW_PATTERN.test("text | more")).toBe(false);
      expect(TABLE_ROW_PATTERN.test("hello")).toBe(false);
    });
  });

  describe("LIST_ITEM_PATTERN", () => {
    it("matches unordered list markers", () => {
      expect(LIST_ITEM_PATTERN.test("- item")).toBe(true);
      expect(LIST_ITEM_PATTERN.test("* item")).toBe(true);
      expect(LIST_ITEM_PATTERN.test("+ item")).toBe(true);
    });

    it("matches ordered list markers", () => {
      expect(LIST_ITEM_PATTERN.test("1. item")).toBe(true);
      expect(LIST_ITEM_PATTERN.test("10. item")).toBe(true);
      expect(LIST_ITEM_PATTERN.test("123. item")).toBe(true);
    });

    it("matches indented list markers", () => {
      expect(LIST_ITEM_PATTERN.test("  - item")).toBe(true);
      expect(LIST_ITEM_PATTERN.test("    * item")).toBe(true);
      expect(LIST_ITEM_PATTERN.test("  1. item")).toBe(true);
    });

    it("requires space after marker", () => {
      expect(LIST_ITEM_PATTERN.test("-item")).toBe(false);
      expect(LIST_ITEM_PATTERN.test("1.item")).toBe(false);
    });

    it("captures indentation and marker correctly", () => {
      const match = "  - item".match(LIST_ITEM_PATTERN);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("  "); // indentation
      expect(match![2]).toBe("-"); // marker
    });
  });

  describe("TASK_ITEM_PATTERN", () => {
    it("matches unchecked task markers", () => {
      expect(TASK_ITEM_PATTERN.test("- [ ] task")).toBe(true);
      expect(TASK_ITEM_PATTERN.test("* [ ] task")).toBe(true);
      expect(TASK_ITEM_PATTERN.test("+ [ ] task")).toBe(true);
    });

    it("matches checked task markers", () => {
      expect(TASK_ITEM_PATTERN.test("- [x] done")).toBe(true);
      expect(TASK_ITEM_PATTERN.test("- [X] done")).toBe(true);
    });

    it("matches indented task markers", () => {
      expect(TASK_ITEM_PATTERN.test("  - [ ] task")).toBe(true);
      expect(TASK_ITEM_PATTERN.test("    - [x] task")).toBe(true);
    });

    it("does not match regular list markers", () => {
      expect(TASK_ITEM_PATTERN.test("- item")).toBe(false);
      expect(TASK_ITEM_PATTERN.test("* item")).toBe(false);
    });

    it("captures indentation, marker, and check state", () => {
      const match = "  - [ ] task".match(TASK_ITEM_PATTERN);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("  "); // indentation
      expect(match![2]).toBe("-"); // marker
      expect(match![3]).toBe(" "); // check state (space = unchecked)
    });
  });

  describe("BLOCKQUOTE_PATTERN", () => {
    it("matches single blockquote marker", () => {
      expect(BLOCKQUOTE_PATTERN.test("> quote")).toBe(true);
      expect(BLOCKQUOTE_PATTERN.test(">quote")).toBe(true);
    });

    it("matches nested blockquote markers", () => {
      expect(BLOCKQUOTE_PATTERN.test(">> nested")).toBe(true);
      expect(BLOCKQUOTE_PATTERN.test(">>> deep")).toBe(true);
    });

    it("matches indented blockquote markers", () => {
      expect(BLOCKQUOTE_PATTERN.test("  > quote")).toBe(true);
    });

    it("captures depth correctly", () => {
      let match = "> quote".match(BLOCKQUOTE_PATTERN);
      expect(match).not.toBeNull();
      expect(match![2]).toBe(">"); // single >
      expect(match![2].length).toBe(1);

      match = ">> nested".match(BLOCKQUOTE_PATTERN);
      expect(match).not.toBeNull();
      expect(match![2]).toBe(">>"); // double >
      expect(match![2].length).toBe(2);

      match = ">>> deep".match(BLOCKQUOTE_PATTERN);
      expect(match).not.toBeNull();
      expect(match![2]).toBe(">>>"); // triple >
      expect(match![2].length).toBe(3);
    });
  });

  describe("getCellStartPipePos", () => {
    it("returns pipe position when cursor is right after pipe", () => {
      const view = createView("| ^cell | cell |");
      const pipePos = getCellStartPipePos(view);
      expect(pipePos).toBe(0); // Position of first pipe
    });

    it("returns pipe position when cursor is after pipe with whitespace", () => {
      const view = createView("|  ^cell");
      const pipePos = getCellStartPipePos(view);
      expect(pipePos).toBe(0);
    });

    it("returns -1 when not in a table row", () => {
      const view = createView("plain ^text");
      const pipePos = getCellStartPipePos(view);
      expect(pipePos).toBe(-1);
    });

    it("returns -1 when cursor is not after a pipe", () => {
      const view = createView("| cell ^content | cell |");
      const pipePos = getCellStartPipePos(view);
      expect(pipePos).toBe(-1);
    });

    it("returns pipe position for middle cell", () => {
      const view = createView("| cell | ^second | third |");
      const pipePos = getCellStartPipePos(view);
      expect(pipePos).toBe(7); // Position of second pipe
    });

    it("returns -1 when cursor is right after an escaped pipe (\\|)", () => {
      // Escaped pipes are cell content, not structural delimiters
      // Text: "| cell \| with pipe | next |", cursor after \|
      const view = createView("| cell \\|^ with pipe | next |");
      const pipePos = getCellStartPipePos(view);
      expect(pipePos).toBe(-1);
    });

    it("returns -1 when cursor is after escaped pipe with whitespace", () => {
      // Text: "| cell \|  something", cursor after \| and spaces
      const view = createView("| cell \\|  ^something | next |");
      const pipePos = getCellStartPipePos(view);
      expect(pipePos).toBe(-1);
    });
  });

  describe("getListMarkerRange", () => {
    it("returns range when cursor is right after marker", () => {
      const view = createView("- ^item");
      const range = getListMarkerRange(view);
      expect(range).not.toBeNull();
      expect(range?.from).toBe(0);
      expect(range?.to).toBe(2); // "- " length
    });

    it("returns range for ordered list", () => {
      const view = createView("1. ^item");
      const range = getListMarkerRange(view);
      expect(range).not.toBeNull();
      expect(range?.from).toBe(0);
      expect(range?.to).toBe(3); // "1. " length
    });

    it("returns range for indented list", () => {
      const view = createView("  - ^item");
      const range = getListMarkerRange(view);
      expect(range).not.toBeNull();
      expect(range?.from).toBe(2); // After indentation
      expect(range?.to).toBe(4); // "- " length from indentation
    });

    it("returns null when cursor is past the marker", () => {
      const view = createView("- item ^content");
      const range = getListMarkerRange(view);
      expect(range).toBeNull();
    });

    it("returns null for non-list line", () => {
      const view = createView("plain ^text");
      const range = getListMarkerRange(view);
      expect(range).toBeNull();
    });
  });

  describe("getTaskMarkerRange", () => {
    it("returns range for unchecked task at cursor", () => {
      const view = createView("- [ ] ^task");
      const range = getTaskMarkerRange(view);
      expect(range).not.toBeNull();
      expect(range?.from).toBe(0);
      expect(range?.to).toBe(6); // "- [ ] " length
      expect(range?.indent).toBe(0);
    });

    it("returns range for checked task at cursor", () => {
      const view = createView("- [x] ^done");
      const range = getTaskMarkerRange(view);
      expect(range).not.toBeNull();
      expect(range?.from).toBe(0);
      expect(range?.to).toBe(6); // "- [x] " length
      expect(range?.indent).toBe(0);
    });

    it("returns range with indent for indented task", () => {
      const view = createView("  - [ ] ^task");
      const range = getTaskMarkerRange(view);
      expect(range).not.toBeNull();
      expect(range?.from).toBe(2); // after indent
      expect(range?.to).toBe(8); // "- [ ] " after indent
      expect(range?.indent).toBe(2);
    });

    it("returns null when cursor is past the marker", () => {
      const view = createView("- [ ] task ^content");
      const range = getTaskMarkerRange(view);
      expect(range).toBeNull();
    });

    it("returns null for non-task line", () => {
      const view = createView("- ^item");
      const range = getTaskMarkerRange(view);
      expect(range).toBeNull();
    });
  });

  describe("getBlockquoteMarkerInfo", () => {
    it("returns info when cursor is after marker", () => {
      const view = createView("> ^quote");
      const info = getBlockquoteMarkerInfo(view);
      expect(info).not.toBeNull();
      expect(info?.depth).toBe(1);
    });

    it("returns depth for nested blockquotes", () => {
      const view = createView(">> ^nested");
      const info = getBlockquoteMarkerInfo(view);
      expect(info).not.toBeNull();
      expect(info?.depth).toBe(2);
    });

    it("returns depth for deeply nested", () => {
      const view = createView(">>> ^deep");
      const info = getBlockquoteMarkerInfo(view);
      expect(info).not.toBeNull();
      expect(info?.depth).toBe(3);
    });

    it("returns null when cursor is past the marker", () => {
      const view = createView("> quote ^content");
      const info = getBlockquoteMarkerInfo(view);
      expect(info).toBeNull();
    });

    it("returns null for non-blockquote line", () => {
      const view = createView("plain ^text");
      const info = getBlockquoteMarkerInfo(view);
      expect(info).toBeNull();
    });
  });

  describe("smartBackspace", () => {
    it("moves cursor before pipe instead of deleting", () => {
      const view = createView("| ^cell |");
      const handled = smartBackspace(view);
      expect(handled).toBe(true);
      expect(view.state.selection.main.head).toBe(0); // Before the pipe
    });

    it("removes list marker entirely", () => {
      const view = createView("- ^item");
      const handled = smartBackspace(view);
      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("item");
    });

    it("removes single blockquote marker", () => {
      const view = createView("> ^quote");
      const handled = smartBackspace(view);
      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("quote");
    });

    it("reduces nested blockquote by one level", () => {
      const view = createView(">> ^nested");
      const handled = smartBackspace(view);
      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("> nested");
    });

    it("returns false for normal text", () => {
      const view = createView("plain ^text");
      const handled = smartBackspace(view);
      expect(handled).toBe(false);
    });

    it("returns false when there is a selection", () => {
      const content = "| cell |";
      const state = EditorState.create({
        doc: content,
        selection: { anchor: 2, head: 4 }, // Selection
      });
      const container = document.createElement("div");
      document.body.appendChild(container);
      const view = new EditorView({ state, parent: container });
      views.push(view);

      const handled = smartBackspace(view);
      expect(handled).toBe(false);
    });

    it("returns false at document start", () => {
      const view = createView("^text");
      const handled = smartBackspace(view);
      expect(handled).toBe(false);
    });

    // Indented list: outdent instead of removing marker
    it("outdents 2-space indented list item (default tabSize=4)", () => {
      const view = createView("  - ^item");
      const handled = smartBackspace(view);
      expect(handled).toBe(true);
      // min(2, 4) = 2 spaces removed
      expect(view.state.doc.toString()).toBe("- item");
    });

    it("outdents 4-space indented list item (default tabSize=4)", () => {
      const view = createView("    - ^item");
      const handled = smartBackspace(view);
      expect(handled).toBe(true);
      // min(4, 4) = 4 spaces removed
      expect(view.state.doc.toString()).toBe("- item");
    });

    it("outdents partial indent (1 space, default tabSize=4)", () => {
      const view = createView(" - ^item");
      const handled = smartBackspace(view);
      expect(handled).toBe(true);
      // min(1, 4) = 1 space removed
      expect(view.state.doc.toString()).toBe("- item");
    });

    it("outdents one tabSize level with tabSize=2 configured", () => {
      // 4-space indent with tabSize=2 should only remove 2 spaces
      const state = EditorState.create({
        doc: "    - item",
        selection: { anchor: 6 }, // right after "- "
        extensions: [EditorState.tabSize.of(2)],
      });
      const container = document.createElement("div");
      document.body.appendChild(container);
      const view = new EditorView({ state, parent: container });
      views.push(view);

      const handled = smartBackspace(view);
      expect(handled).toBe(true);
      // min(4, 2) = 2 spaces removed
      expect(view.state.doc.toString()).toBe("  - item");
    });

    // Task marker handling
    it("removes full task marker at level 0", () => {
      const view = createView("- [ ] ^task");
      const handled = smartBackspace(view);
      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("task");
    });

    it("removes checked task marker at level 0", () => {
      const view = createView("- [x] ^done");
      const handled = smartBackspace(view);
      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("done");
    });

    it("outdents indented task marker instead of removing", () => {
      const view = createView("  - [ ] ^task");
      const handled = smartBackspace(view);
      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("- [ ] task");
    });

    it("does NOT intercept backspace after escaped pipe (\\|) in a table cell", () => {
      // Cursor is right after the | of \| — should let normal backspace delete it
      const view = createView("| cell \\|^ with pipe | next |");
      const handled = smartBackspace(view);
      expect(handled).toBe(false);
    });
  });

  describe("smartDelete", () => {
    it("skips over pipe instead of deleting", () => {
      const view = createView("| cell ^| next");
      const handled = smartDelete(view);
      expect(handled).toBe(true);
      expect(view.state.selection.main.head).toBe(8); // After the pipe
    });

    it("returns false for normal text", () => {
      const view = createView("plain ^text");
      const handled = smartDelete(view);
      expect(handled).toBe(false);
    });

    it("returns false when there is a selection", () => {
      const content = "| cell | next";
      const state = EditorState.create({
        doc: content,
        selection: { anchor: 2, head: 4 },
      });
      const container = document.createElement("div");
      document.body.appendChild(container);
      const view = new EditorView({ state, parent: container });
      views.push(view);

      const handled = smartDelete(view);
      expect(handled).toBe(false);
    });

    it("returns false at document end", () => {
      const view = createView("text^");
      const handled = smartDelete(view);
      expect(handled).toBe(false);
    });
  });
});
