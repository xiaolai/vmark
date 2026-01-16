import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, SelectionRange } from "@tiptap/pm/state";
import { multiCursorPlugin } from "../multiCursorPlugin";
import { MultiSelection } from "../MultiSelection";
import {
  handleMultiCursorInput,
  handleMultiCursorBackspace,
  handleMultiCursorDelete,
  handleMultiCursorKeyDown,
} from "../inputHandling";

// Simple schema for testing
const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
});

function createDoc(text: string) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
}

function createState(text: string) {
  return EditorState.create({
    doc: createDoc(text),
    schema,
    plugins: [multiCursorPlugin()],
  });
}

function createMultiCursorState(
  text: string,
  positions: Array<{ from: number; to: number }>
) {
  const state = createState(text);
  const doc = state.doc;
  const ranges = positions.map((p) => {
    const $from = doc.resolve(p.from);
    const $to = doc.resolve(p.to);
    return new SelectionRange($from, $to);
  });
  const multiSel = new MultiSelection(ranges, 0);
  return state.apply(state.tr.setSelection(multiSel));
}

describe("inputHandling", () => {
  describe("handleMultiCursorInput", () => {
    it("inserts text at all cursor positions", () => {
      // "hello world" with cursors at positions 1 and 7
      const state = createMultiCursorState("hello world", [
        { from: 1, to: 1 },
        { from: 7, to: 7 },
      ]);

      const result = handleMultiCursorInput(state, "X");
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        // Should be "Xhello Xworld"
        expect(newState.doc.textContent).toBe("Xhello Xworld");
      }
    });

    it("replaces selections with typed text", () => {
      // "hello world" with "hello" selected (1-6) and "world" selected (7-12)
      const state = createMultiCursorState("hello world", [
        { from: 1, to: 6 },
        { from: 7, to: 12 },
      ]);

      const result = handleMultiCursorInput(state, "X");
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        // Should be "X X"
        expect(newState.doc.textContent).toBe("X X");
      }
    });

    it("handles mixed cursors and selections", () => {
      // "abc def ghi" with cursor at 1 and "def" selected (5-8)
      const state = createMultiCursorState("abc def ghi", [
        { from: 1, to: 1 },
        { from: 5, to: 8 },
      ]);

      const result = handleMultiCursorInput(state, "X");
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        // Should be "Xabc X ghi"
        expect(newState.doc.textContent).toBe("Xabc X ghi");
      }
    });

    it("maintains MultiSelection after input", () => {
      const state = createMultiCursorState("hello world", [
        { from: 1, to: 1 },
        { from: 7, to: 7 },
      ]);

      const result = handleMultiCursorInput(state, "X");
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        expect(newState.selection).toBeInstanceOf(MultiSelection);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges).toHaveLength(2);
      }
    });

    it("returns null for non-MultiSelection", () => {
      const state = createState("hello world");
      const result = handleMultiCursorInput(state, "X");
      expect(result).toBeNull();
    });
  });

  describe("handleMultiCursorBackspace", () => {
    it("deletes character before each cursor", () => {
      // "hello world" with cursors at positions 2 and 8
      const state = createMultiCursorState("hello world", [
        { from: 2, to: 2 },
        { from: 8, to: 8 },
      ]);

      const result = handleMultiCursorBackspace(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        // Should be "ello orld"
        expect(newState.doc.textContent).toBe("ello orld");
      }
    });

    it("deletes selected text", () => {
      // "hello world" with "hello" selected
      const state = createMultiCursorState("hello world", [
        { from: 1, to: 6 },
        { from: 7, to: 12 },
      ]);

      const result = handleMultiCursorBackspace(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        // Should be " " (just the space)
        expect(newState.doc.textContent).toBe(" ");
      }
    });

    it("handles cursor at start of document (no-op for that cursor)", () => {
      const state = createMultiCursorState("hello", [
        { from: 1, to: 1 }, // at start
        { from: 3, to: 3 },
      ]);

      const result = handleMultiCursorBackspace(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        // Only second cursor should delete
        expect(newState.doc.textContent).toBe("hllo");
      }
    });

    it("returns null for non-MultiSelection", () => {
      const state = createState("hello world");
      const result = handleMultiCursorBackspace(state);
      expect(result).toBeNull();
    });
  });

  describe("handleMultiCursorDelete", () => {
    it("deletes character after each cursor", () => {
      // "hello world" with cursors at positions 1 and 7
      const state = createMultiCursorState("hello world", [
        { from: 1, to: 1 },
        { from: 7, to: 7 },
      ]);

      const result = handleMultiCursorDelete(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        // Should be "ello orld"
        expect(newState.doc.textContent).toBe("ello orld");
      }
    });

    it("deletes selected text", () => {
      const state = createMultiCursorState("hello world", [
        { from: 1, to: 6 },
        { from: 7, to: 12 },
      ]);

      const result = handleMultiCursorDelete(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        expect(newState.doc.textContent).toBe(" ");
      }
    });

    it("handles cursor at end of document (no-op for that cursor)", () => {
      const state = createMultiCursorState("hello", [
        { from: 3, to: 3 },
        { from: 6, to: 6 }, // at end
      ]);

      const result = handleMultiCursorDelete(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        // Only first cursor should delete
        expect(newState.doc.textContent).toBe("helo");
      }
    });

    it("returns null for non-MultiSelection", () => {
      const state = createState("hello world");
      const result = handleMultiCursorDelete(state);
      expect(result).toBeNull();
    });
  });

  describe("handleMultiCursorKeyDown (arrows)", () => {
    it("moves all cursors with ArrowRight", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const tr = handleMultiCursorKeyDown(state, {
        key: "ArrowRight",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
      });

      expect(tr).not.toBeNull();
      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges[0].$from.pos).toBe(3);
        expect(multiSel.ranges[1].$from.pos).toBe(5);
      }
    });

    it("extends selections with Shift+ArrowRight", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const tr = handleMultiCursorKeyDown(state, {
        key: "ArrowRight",
        shiftKey: true,
        isComposing: false,
        keyCode: 0,
      });

      expect(tr).not.toBeNull();
      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges[0].$from.pos).toBe(2);
        expect(multiSel.ranges[0].$to.pos).toBe(3);
      }
    });
  });
});
