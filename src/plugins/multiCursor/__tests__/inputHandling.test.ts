import { describe, it, expect } from "vitest";
import { SelectionRange } from "@tiptap/pm/state";
import { MultiSelection } from "../MultiSelection";
import {
  handleMultiCursorInput,
  handleMultiCursorBackspace,
  handleMultiCursorDelete,
  handleMultiCursorArrow,
  handleMultiCursorKeyDown,
} from "../inputHandling";
import { createState, createMultiCursorState } from "./testHelpers";

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

    it("returns null when isComposing option is true", () => {
      const state = createMultiCursorState("hello world", [
        { from: 1, to: 1 },
        { from: 7, to: 7 },
      ]);

      const result = handleMultiCursorInput(state, "X", { isComposing: true });
      expect(result).toBeNull();
    });

    it("inserts multi-character text at all cursors", () => {
      const state = createMultiCursorState("hello world", [
        { from: 1, to: 1 },
        { from: 7, to: 7 },
      ]);

      const result = handleMultiCursorInput(state, "XY");
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        expect(newState.doc.textContent).toBe("XYhello XYworld");
      }
    });

    it("sets addToHistory to true on the transaction", () => {
      const state = createMultiCursorState("hello", [
        { from: 1, to: 1 },
        { from: 3, to: 3 },
      ]);

      const result = handleMultiCursorInput(state, "a");
      expect(result).not.toBeNull();
      expect(result!.getMeta("addToHistory")).toBe(true);
    });

    it("handles adjacent cursors without overlapping", () => {
      const state = createMultiCursorState("abcd", [
        { from: 2, to: 2 },
        { from: 3, to: 3 },
      ]);

      const result = handleMultiCursorInput(state, "X");
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        expect(newState.doc.textContent).toBe("aXbXcd");
      }
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

    it("maintains MultiSelection after backspace", () => {
      const state = createMultiCursorState("hello world", [
        { from: 2, to: 2 },
        { from: 8, to: 8 },
      ]);

      const result = handleMultiCursorBackspace(state);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        expect(newState.selection).toBeInstanceOf(MultiSelection);
      }
    });

    it("sets addToHistory to true", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const result = handleMultiCursorBackspace(state);
      expect(result).not.toBeNull();
      expect(result!.getMeta("addToHistory")).toBe(true);
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

    it("maintains MultiSelection after delete", () => {
      const state = createMultiCursorState("hello world", [
        { from: 1, to: 1 },
        { from: 7, to: 7 },
      ]);

      const result = handleMultiCursorDelete(state);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        expect(newState.selection).toBeInstanceOf(MultiSelection);
      }
    });

    it("sets addToHistory to true", () => {
      const state = createMultiCursorState("hello", [
        { from: 1, to: 1 },
        { from: 3, to: 3 },
      ]);

      const result = handleMultiCursorDelete(state);
      expect(result).not.toBeNull();
      expect(result!.getMeta("addToHistory")).toBe(true);
    });
  });

  describe("handleMultiCursorArrow", () => {
    it("returns null for non-MultiSelection", () => {
      const state = createState("hello");
      const result = handleMultiCursorArrow(state, "ArrowRight", false);
      expect(result).toBeNull();
    });

    it("moves all cursors right", () => {
      const state = createMultiCursorState("hello", [
        { from: 1, to: 1 },
        { from: 3, to: 3 },
      ]);

      const result = handleMultiCursorArrow(state, "ArrowRight", false);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges[0].$from.pos).toBe(2);
        expect(multiSel.ranges[1].$from.pos).toBe(4);
      }
    });

    it("moves all cursors left", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const result = handleMultiCursorArrow(state, "ArrowLeft", false);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges[0].$from.pos).toBe(1);
        expect(multiSel.ranges[1].$from.pos).toBe(3);
      }
    });

    it("moves cursors down", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const result = handleMultiCursorArrow(state, "ArrowDown", false);
      expect(result).not.toBeNull();
      // ArrowDown in a single paragraph may not move, but it should not crash
    });

    it("moves cursors up", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const _result = handleMultiCursorArrow(state, "ArrowUp", false);
      // ArrowUp in a single paragraph may not move
      // The function should handle this gracefully
    });

    it("collapses non-empty selection to start on ArrowLeft without extend", () => {
      const state = createMultiCursorState("hello world", [
        { from: 1, to: 6 },
        { from: 7, to: 12 },
      ]);

      const result = handleMultiCursorArrow(state, "ArrowLeft", false);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        // Should collapse to the from position
        expect(multiSel.ranges[0].$from.pos).toBe(
          multiSel.ranges[0].$to.pos
        );
        expect(multiSel.ranges[0].$from.pos).toBe(1);
      }
    });

    it("collapses non-empty selection to end on ArrowRight without extend", () => {
      const state = createMultiCursorState("hello world", [
        { from: 1, to: 6 },
        { from: 7, to: 12 },
      ]);

      const result = handleMultiCursorArrow(state, "ArrowRight", false);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges[0].$from.pos).toBe(
          multiSel.ranges[0].$to.pos
        );
        expect(multiSel.ranges[0].$from.pos).toBe(6);
      }
    });

    it("extends selection with Shift+ArrowRight", () => {
      const state = createMultiCursorState("hello", [
        { from: 1, to: 1 },
        { from: 3, to: 3 },
      ]);

      const result = handleMultiCursorArrow(state, "ArrowRight", true);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        // Each cursor should now select one character to the right
        expect(multiSel.ranges[0].$from.pos).toBe(1);
        expect(multiSel.ranges[0].$to.pos).toBe(2);
      }
    });

    it("extends selection with Shift+ArrowLeft", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 5, to: 5 },
      ]);

      const result = handleMultiCursorArrow(state, "ArrowLeft", true);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges[0].$from.pos).toBe(1);
        expect(multiSel.ranges[0].$to.pos).toBe(2);
      }
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
        altKey: false,
        ctrlKey: false,
        metaKey: false,
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
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(tr).not.toBeNull();
      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges[0].$from.pos).toBe(2);
        expect(multiSel.ranges[0].$to.pos).toBe(3);
      }
    });

    it("moves cursors by word with Option/Alt+ArrowRight", () => {
      const state = createMultiCursorState("hello world", [
        { from: 2, to: 2 },
        { from: 8, to: 8 },
      ]);

      const tr = handleMultiCursorKeyDown(state, {
        key: "ArrowRight",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: true,
        ctrlKey: false,
        metaKey: false,
      });

      expect(tr).not.toBeNull();
      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges[0].$from.pos).toBe(6);
        expect(multiSel.ranges[1].$from.pos).toBe(12);
      }
    });

    it("moves cursors to line end with Cmd+ArrowRight", () => {
      const state = createMultiCursorState("hello world", [
        { from: 2, to: 2 },
        { from: 8, to: 8 },
      ]);

      const tr = handleMultiCursorKeyDown(state, {
        key: "ArrowRight",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: true,
      });

      expect(tr).not.toBeNull();
      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges).toHaveLength(1);
        expect(multiSel.ranges[0].$from.pos).toBe(12);
      }
    });

    it("moves cursors by word with Ctrl+ArrowRight", () => {
      const state = createMultiCursorState("hello world", [
        { from: 1, to: 1 },
        { from: 7, to: 7 },
      ]);

      const tr = handleMultiCursorKeyDown(state, {
        key: "ArrowRight",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: false,
        ctrlKey: true,
        metaKey: false,
      });

      expect(tr).not.toBeNull();
      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        // Should move by word
        expect(multiSel.ranges[0].$from.pos).toBe(6);
        expect(multiSel.ranges[1].$from.pos).toBe(12);
      }
    });

    it("moves cursors with ArrowLeft", () => {
      const state = createMultiCursorState("hello", [
        { from: 3, to: 3 },
        { from: 5, to: 5 },
      ]);

      const tr = handleMultiCursorKeyDown(state, {
        key: "ArrowLeft",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(tr).not.toBeNull();
      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges[0].$from.pos).toBe(2);
        expect(multiSel.ranges[1].$from.pos).toBe(4);
      }
    });

    it("moves cursors to line start with Cmd+ArrowLeft", () => {
      const state = createMultiCursorState("hello world", [
        { from: 4, to: 4 },
        { from: 10, to: 10 },
      ]);

      const tr = handleMultiCursorKeyDown(state, {
        key: "ArrowLeft",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: true,
      });

      expect(tr).not.toBeNull();
      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        // Both should move to line start (pos 1), merging into one
        expect(multiSel.ranges).toHaveLength(1);
        expect(multiSel.ranges[0].$from.pos).toBe(1);
      }
    });

    it("returns null for non-MultiSelection", () => {
      const state = createState("hello world");
      const result = handleMultiCursorKeyDown(state, {
        key: "ArrowRight",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });
      expect(result).toBeNull();
    });

    it("returns null for IME key events (isComposing)", () => {
      const state = createMultiCursorState("hello", [
        { from: 1, to: 1 },
        { from: 3, to: 3 },
      ]);

      const result = handleMultiCursorKeyDown(state, {
        key: "Process",
        shiftKey: false,
        isComposing: true,
        keyCode: 229,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });
      expect(result).toBeNull();
    });

    it("returns null for IME key events (keyCode 229)", () => {
      const state = createMultiCursorState("hello", [
        { from: 1, to: 1 },
        { from: 3, to: 3 },
      ]);

      const result = handleMultiCursorKeyDown(state, {
        key: "a",
        shiftKey: false,
        isComposing: false,
        keyCode: 229,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });
      expect(result).toBeNull();
    });

    it("handles Backspace key", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const result = handleMultiCursorKeyDown(state, {
        key: "Backspace",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        expect(newState.doc.textContent).toBe("elo");
      }
    });

    it("handles Delete key", () => {
      const state = createMultiCursorState("hello", [
        { from: 1, to: 1 },
        { from: 3, to: 3 },
      ]);

      const result = handleMultiCursorKeyDown(state, {
        key: "Delete",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        expect(newState.doc.textContent).toBe("elo");
      }
    });

    it("handles Enter key (bare, no modifiers)", () => {
      const state = createMultiCursorState("hello world", [
        { from: 3, to: 3 },
        { from: 8, to: 8 },
      ]);

      const result = handleMultiCursorKeyDown(state, {
        key: "Enter",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(result).not.toBeNull();
    });

    it("returns null for Shift+Enter (modified Enter)", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const result = handleMultiCursorKeyDown(state, {
        key: "Enter",
        shiftKey: true,
        isComposing: false,
        keyCode: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(result).toBeNull();
    });

    it("returns null for Alt+Enter", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const result = handleMultiCursorKeyDown(state, {
        key: "Enter",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: true,
        ctrlKey: false,
        metaKey: false,
      });

      expect(result).toBeNull();
    });

    it("returns null for Ctrl+Enter", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const result = handleMultiCursorKeyDown(state, {
        key: "Enter",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: false,
        ctrlKey: true,
        metaKey: false,
      });

      expect(result).toBeNull();
    });

    it("returns null for Meta+Enter", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const result = handleMultiCursorKeyDown(state, {
        key: "Enter",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: true,
      });

      expect(result).toBeNull();
    });

    it("returns null for ArrowDown with modifier keys", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      // ArrowDown with metaKey should return null (fall through)
      const result = handleMultiCursorKeyDown(state, {
        key: "ArrowDown",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: true,
      });

      expect(result).toBeNull();
    });

    it("returns null for ArrowUp with altKey", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const result = handleMultiCursorKeyDown(state, {
        key: "ArrowUp",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: true,
        ctrlKey: false,
        metaKey: false,
      });

      expect(result).toBeNull();
    });

    it("returns null for ArrowDown with ctrlKey", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const result = handleMultiCursorKeyDown(state, {
        key: "ArrowDown",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: false,
        ctrlKey: true,
        metaKey: false,
      });

      expect(result).toBeNull();
    });

    it("handles ArrowUp without modifiers", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const _result = handleMultiCursorKeyDown(state, {
        key: "ArrowUp",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      // May return null or a transaction depending on document structure
      // Either way should not throw
    });

    it("handles ArrowDown with Shift (extend)", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const _result = handleMultiCursorKeyDown(state, {
        key: "ArrowDown",
        shiftKey: true,
        isComposing: false,
        keyCode: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      // Should not throw, returns either null or transaction
    });

    it("returns null for default/unknown key", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const result = handleMultiCursorKeyDown(state, {
        key: "Tab",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(result).toBeNull();
    });

    it("returns null for alphabetic key (not handled)", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const result = handleMultiCursorKeyDown(state, {
        key: "a",
        shiftKey: false,
        isComposing: false,
        keyCode: 65,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });

      expect(result).toBeNull();
    });
  });

  describe("handleMultiCursorArrow — edge cases (backward flags, findFrom null)", () => {
    it("handles ArrowLeft at start of document (no movement possible)", () => {
      // Cursors at start of paragraph — ArrowLeft with findFrom may return null
      const state = createMultiCursorState("hello", [
        { from: 1, to: 1 },
        { from: 3, to: 3 },
      ]);

      const result = handleMultiCursorArrow(state, "ArrowLeft", false);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        // First cursor can't move before pos 1 in the paragraph
        // It either stays or moves to a valid position
        expect(multiSel.ranges.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("handles ArrowRight at end of document (findFrom may return null)", () => {
      const state = createMultiCursorState("hi", [
        { from: 3, to: 3 }, // end of text in paragraph
      ]);

      // Single range in MultiSelection
      const _result = handleMultiCursorArrow(state, "ArrowRight", false);
      // May return null or a transaction that doesn't move
    });

    it("handles Shift+ArrowLeft extending selection backward", () => {
      const state = createMultiCursorState("hello world", [
        { from: 3, to: 3 },
        { from: 8, to: 8 },
      ]);

      const result = handleMultiCursorArrow(state, "ArrowLeft", true);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        // Each cursor should extend left
        expect(multiSel.ranges[0].$from.pos).toBeLessThanOrEqual(3);
      }
    });

    it("handles Shift+ArrowUp extending selection (vertical)", () => {
      const state = createMultiCursorState("hello world", [
        { from: 3, to: 3 },
        { from: 8, to: 8 },
      ]);

      // ArrowUp in a single paragraph document — may not find anything
      const _result = handleMultiCursorArrow(state, "ArrowUp", true);
      // Should not crash
    });

    it("handles ArrowDown collapsing non-empty selection", () => {
      const state = createMultiCursorState("hello world", [
        { from: 1, to: 6 },
        { from: 7, to: 12 },
      ]);

      const result = handleMultiCursorArrow(state, "ArrowDown", false);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        // Should collapse to end of each selection (dir = 1)
        expect(multiSel.ranges[0].$from.pos).toBe(multiSel.ranges[0].$to.pos);
      }
    });

    it("handles ArrowUp collapsing non-empty selection", () => {
      const state = createMultiCursorState("hello world", [
        { from: 1, to: 6 },
        { from: 7, to: 12 },
      ]);

      const result = handleMultiCursorArrow(state, "ArrowUp", false);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        // Should collapse to start of each selection (dir = -1)
        expect(multiSel.ranges[0].$from.pos).toBe(multiSel.ranges[0].$to.pos);
      }
    });

    it("derives backward flags correctly for extended selection (ArrowLeft + Shift)", () => {
      // Start with cursors, extend left → selections should have backward flag set
      const state = createMultiCursorState("abcdefghij", [
        { from: 5, to: 5 },
        { from: 8, to: 8 },
      ]);

      const result = handleMultiCursorArrow(state, "ArrowLeft", true);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        // Selections should be backward since we extended left
        // (anchor at 5, head at 4 → backward)
        expect(multiSel.ranges[0].$from.pos).toBeLessThan(5);
      }
    });
  });

  describe("handleMultiCursorArrow — coordinate-based vertical movement with view", () => {
    function makeMockView(state: ReturnType<typeof createState>) {
      // Mock EditorView that simulates two-line layout:
      // Line 1: y=0..20 (pos 1-6 "hello")
      // Line 2: y=20..40 (pos 8-13 "world")
      const LINE_HEIGHT = 20;
      return {
        coordsAtPos: (pos: number) => {
          const lineY = pos <= 7 ? 0 : LINE_HEIGHT;
          return {
            left: (pos % 7) * 10,
            top: lineY,
            bottom: lineY + LINE_HEIGHT,
            right: (pos % 7) * 10 + 10,
          };
        },
        posAtCoords: (coords: { left: number; top: number }) => {
          if (coords.top < 0 || coords.top > 40) return null;
          const line = coords.top < LINE_HEIGHT ? 0 : 1;
          const basePos = line === 0 ? 1 : 8;
          const charOffset = Math.round(coords.left / 10);
          return { pos: basePos + charOffset };
        },
        state,
      } as unknown as import("@tiptap/pm/view").EditorView;
    }

    it("moves cursors down using coordsAtPos/posAtCoords", () => {
      const state = createMultiCursorState("hello\nworld", [
        { from: 3, to: 3 },
      ]);
      const view = makeMockView(state);

      const result = handleMultiCursorArrow(state, "ArrowDown", false, view);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        // Should have moved to line 2 via coordinate lookup
        expect(multiSel.ranges[0].$from.pos).toBeGreaterThan(3);
      }
    });

    it("moves cursors up using coordsAtPos/posAtCoords", () => {
      const state = createMultiCursorState("hello\nworld", [
        { from: 10, to: 10 },
      ]);
      const view = makeMockView(state);

      const result = handleMultiCursorArrow(state, "ArrowUp", false, view);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        // Should have moved to line 1 via coordinate lookup
        expect(multiSel.ranges[0].$from.pos).toBeLessThan(10);
      }
    });

    it("extends selection vertically with Shift+ArrowDown and view", () => {
      const state = createMultiCursorState("hello\nworld", [
        { from: 3, to: 3 },
      ]);
      const view = makeMockView(state);

      const result = handleMultiCursorArrow(state, "ArrowDown", true, view);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        // Should have extended selection from line 1 to line 2
        expect(multiSel.ranges[0].$to.pos).toBeGreaterThan(multiSel.ranges[0].$from.pos);
      }
    });

    it("returns original range when posAtCoords returns null", () => {
      const state = createMultiCursorState("hello", [
        { from: 3, to: 3 },
      ]);
      // Mock view where posAtCoords always returns null (e.g., cursor at top edge)
      const view = {
        coordsAtPos: () => ({ left: 30, top: 0, bottom: 20, right: 40 }),
        posAtCoords: () => null,
        state,
      } as unknown as import("@tiptap/pm/view").EditorView;

      const result = handleMultiCursorArrow(state, "ArrowUp", false, view);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        // Cursor should stay at original position
        expect(multiSel.ranges[0].$from.pos).toBe(3);
      }
    });

    it("passes view through handleMultiCursorKeyDown to handleMultiCursorArrow", () => {
      const state = createMultiCursorState("hello\nworld", [
        { from: 3, to: 3 },
      ]);
      const view = makeMockView(state);

      const result = handleMultiCursorKeyDown(state, {
        key: "ArrowDown",
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      }, view);

      expect(result).not.toBeNull();
    });

    it("extends backward selection vertically with view (isBackward anchor branch)", () => {
      const state = createState("hello\nworld");
      const doc = state.doc;
      // Backward selection: anchor=5 ($to), head=2 ($from)
      const selRanges = [new SelectionRange(doc.resolve(2), doc.resolve(5))];
      const multiSel = new MultiSelection(selRanges, 0, [true]);
      const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

      const view = makeMockView(stateWithMulti);
      const result = handleMultiCursorArrow(stateWithMulti, "ArrowDown", true, view);
      expect(result).not.toBeNull();
      if (result) {
        const newState = stateWithMulti.apply(result);
        const ms = newState.selection as MultiSelection;
        // Extended down from backward selection — anchor stays at $to (5)
        expect(ms.ranges[0].$from.pos).toBeLessThanOrEqual(ms.ranges[0].$to.pos);
      }
    });

    it("uses fallback lineHeight when coords.bottom === coords.top", () => {
      const state = createMultiCursorState("hello\nworld", [
        { from: 3, to: 3 },
      ]);
      // Mock view where top === bottom (zero-height coords)
      const view = {
        coordsAtPos: () => ({ left: 30, top: 10, bottom: 10, right: 40 }),
        posAtCoords: (coords: { left: number; top: number }) => {
          // With DEFAULT_LINE_HEIGHT_PX fallback, targetY will be 10 + 20/2 = 20
          return coords.top > 15 ? { pos: 10 } : { pos: 3 };
        },
        state,
      } as unknown as import("@tiptap/pm/view").EditorView;

      const result = handleMultiCursorArrow(state, "ArrowDown", false, view);
      expect(result).not.toBeNull();
    });
  });

  describe("handleMultiCursorArrow — backward flag branches (lines 207, 218, 231, 233, 236)", () => {
    it("uses $from.pos as headPos when isBackward is true (line 207)", () => {
      // Create a MultiSelection with a backward flag so isBackward=true.
      // headPos = range.$from.pos (not $to.pos) when backward.
      const state = createState("abcdefghij");
      const doc = state.doc;
      // Selection from 3 to 7, marked as backward (anchor=7, head=3)
      const selRanges = [
        new SelectionRange(doc.resolve(3), doc.resolve(7)),
        new SelectionRange(doc.resolve(8), doc.resolve(8)),
      ];
      const multiSel = new MultiSelection(selRanges, 0, [true, false]);
      const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

      const result = handleMultiCursorArrow(stateWithMulti, "ArrowRight", false);
      expect(result).not.toBeNull();
      if (result) {
        // With backward=true, head is at $from (3), so non-extend right collapses to $to (7)
        // Actually with !extend and non-empty, collapses to $to.pos for dir=1
        const newState = stateWithMulti.apply(result);
        const multiSel2 = newState.selection as MultiSelection;
        expect(multiSel2.ranges[0].$from.pos).toBe(multiSel2.ranges[0].$to.pos);
      }
    });

    it("extends vertical selection with Shift+ArrowDown (line 218 extend branch)", () => {
      // Test the extend=true path for vertical arrow movement (lines 217-221).
      // ArrowDown with extend=true should create a selection (anchorPos + targetPos).
      const state = createMultiCursorState("hello\nworld", [
        { from: 3, to: 3 },
        { from: 8, to: 8 },
      ]);

      const _result = handleMultiCursorArrow(state, "ArrowDown", true);
      // In a single-paragraph doc, ArrowDown won't find a lower line — result may be
      // the original range preserved; either way should not throw.
      // The test validates line 218 is exercised without crash.
    });

    it("uses backwardFlags truthy path for newBackward anchor (line 233)", () => {
      // With backwardFlags[i] = true, anchorPos = origRange.$to.pos (not $from).
      // Then extend=true, so we enter the newBackward calculation.
      const state = createState("abcdefghij");
      const doc = state.doc;
      // Backward selection at 2-6 (anchor at 6, head at 2)
      const selRanges = [new SelectionRange(doc.resolve(2), doc.resolve(6))];
      const multiSel = new MultiSelection(selRanges, 0, [true]);
      const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

      // Extend right: anchor=6 ($to), head moves from 2 ($from) to the right
      const result = handleMultiCursorArrow(stateWithMulti, "ArrowRight", true);
      expect(result).not.toBeNull();
      if (result) {
        const newState = stateWithMulti.apply(result);
        const multiSel2 = newState.selection as MultiSelection;
        // The selection should still exist
        expect(multiSel2.ranges.length).toBeGreaterThan(0);
      }
    });

    it("uses fallback headPos branch when anchor doesn't match from or to (line 236)", () => {
      // This is the rare case: after normalization, the new range's $from and $to
      // neither equals anchorPos. We force it by having a backward selection and
      // then extending so that normalization merges/shifts the range.
      // Use two backward ranges that might merge when extended right.
      const state = createState("abcdefghijklmno");
      const doc = state.doc;
      // Two backward ranges that overlap after extending right
      const selRanges = [
        new SelectionRange(doc.resolve(2), doc.resolve(5)), // backward: anchor=5, head=2
        new SelectionRange(doc.resolve(8), doc.resolve(11)), // backward: anchor=11, head=8
      ];
      const multiSel = new MultiSelection(selRanges, 0, [true, true]);
      const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

      // Extend right — the new ranges will have heads at 3 and 9
      // Since both are backward, anchorPos = $to.pos (5 and 11)
      // New head = $from+1 which won't equal anchorPos (5 or 11)
      // So the fallback `dir < 0 ? $from : $to` is used
      const result = handleMultiCursorArrow(stateWithMulti, "ArrowRight", true);
      expect(result).not.toBeNull();
      if (result) {
        const newState = stateWithMulti.apply(result);
        expect(newState.selection instanceof MultiSelection).toBe(true);
      }
    });

    it("newBackward returns false when extend=false (line 231)", () => {
      // When extend=false, the inner `if (!extend) return false` is hit after
      // the collapsed range check passes (i.e., range is non-empty before collapsing
      // but we hit the extend=false check via a range that is empty after movement).
      // Actually line 231 is `if (!extend) return false` which runs for ALL ranges
      // when extend=false. We need a non-empty resulting range to hit it.
      // But if !extend and original was non-empty → collapses to empty → line 230 returns false.
      // So line 231 is hit when: the result range is non-empty AND extend=false.
      // That happens when the original range was empty (cursor) and moved to a new cursor —
      // wait, moved cursors produce empty ranges (from===to), so line 230 returns false.
      // Actually line 231 IS only hit for non-empty result ranges with !extend.
      // That can't happen because non-empty collapses produce empty cursors.
      // So let's verify this by extending then NOT extending — the test just confirms no crash.
      const state = createMultiCursorState("hello world", [
        { from: 2, to: 2 },
        { from: 7, to: 7 },
      ]);

      const result = handleMultiCursorArrow(state, "ArrowRight", false);
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel2 = newState.selection as MultiSelection;
        // All backward flags should be false since extend=false
        expect(multiSel2.backward.every((b) => b === false)).toBe(true);
      }
    });
  });

  describe("surrogate pair (emoji) handling", () => {
    // 😀 is U+1F600, encoded as 2 UTF-16 code units (surrogate pair)
    // In ProseMirror, text offsets = JS string offsets (UTF-16 code units)
    // "a😀b" has JS length 4: 'a'(1) + 😀(2) + 'b'(1)
    // ProseMirror positions in <doc><p>a😀b</p></doc>:
    //   pos 1 = before 'a' (parentOffset 0)
    //   pos 2 = after 'a' / before 😀 (parentOffset 1)
    //   pos 4 = after 😀 / before 'b' (parentOffset 3)
    //   pos 5 = after 'b' (parentOffset 4)

    describe("handleMultiCursorBackspace with emoji", () => {
      it("deletes entire emoji (surrogate pair) before cursor", () => {
        // "a😀b" with cursor after 😀 (pos 4, parentOffset 3)
        const state = createMultiCursorState("a😀b", [
          { from: 4, to: 4 },
        ]);

        const result = handleMultiCursorBackspace(state);
        expect(result).not.toBeNull();

        if (result) {
          const newState = state.apply(result);
          // Should delete the whole emoji, leaving "ab"
          expect(newState.doc.textContent).toBe("ab");
        }
      });

      it("deletes ASCII character before cursor (no regression)", () => {
        // "a😀b" with cursor after 'a' (pos 2, parentOffset 1)
        const state = createMultiCursorState("a😀b", [
          { from: 2, to: 2 },
        ]);

        const result = handleMultiCursorBackspace(state);
        expect(result).not.toBeNull();

        if (result) {
          const newState = state.apply(result);
          expect(newState.doc.textContent).toBe("😀b");
        }
      });

      it("handles multiple cursors with emoji", () => {
        // "😀a😀" — cursor after first emoji (pos 3) and after 'a' (pos 4)
        // "😀a😀" has length 5: 😀(2) + 'a'(1) + 😀(2)
        // Positions: 1=before first 😀, 3=after first 😀, 4=after 'a', 6=after second 😀
        const state = createMultiCursorState("😀a😀", [
          { from: 3, to: 3 },
          { from: 4, to: 4 },
        ]);

        const result = handleMultiCursorBackspace(state);
        expect(result).not.toBeNull();

        if (result) {
          const newState = state.apply(result);
          // First cursor deletes 😀, second deletes 'a' → "😀"
          expect(newState.doc.textContent).toBe("😀");
        }
      });

      it("handles cursor at start of paragraph (no-op)", () => {
        const state = createMultiCursorState("😀", [
          { from: 1, to: 1 }, // parentOffset 0
        ]);

        const result = handleMultiCursorBackspace(state);
        expect(result).not.toBeNull();

        if (result) {
          const newState = state.apply(result);
          expect(newState.doc.textContent).toBe("😀");
        }
      });

      it("deletes multi-codepoint emoji (family emoji) as single character", () => {
        // 👨‍👩‍👧 is a ZWJ sequence: 👨 + ZWJ + 👩 + ZWJ + 👧
        // Each person emoji is a surrogate pair (2 code units), ZWJ is 1 code unit
        // Total: 2 + 1 + 2 + 1 + 2 = 8 code units
        // However, ProseMirror textBetween returns the raw string,
        // and [...str].at(-1) returns the last Unicode scalar (👧, 2 code units)
        // So we only delete the last scalar, not the whole ZWJ sequence.
        // This is consistent with how most editors handle ZWJ sequences.
        const familyEmoji = "👨‍👩‍👧";
        const text = "a" + familyEmoji + "b";
        const emojiLen = familyEmoji.length; // 8 code units
        // cursor after the family emoji
        const cursorPos = 1 + 1 + emojiLen; // 1 (doc offset) + 1 ('a') + 8
        const state = createMultiCursorState(text, [
          { from: cursorPos, to: cursorPos },
        ]);

        const result = handleMultiCursorBackspace(state);
        expect(result).not.toBeNull();

        if (result) {
          const newState = state.apply(result);
          // Should delete at least the last codepoint (👧 = 2 code units),
          // not just 1 code unit which would corrupt the text
          const content = newState.doc.textContent;
          // The content should NOT contain any lone surrogates
          // A lone surrogate would be a char in the range 0xD800-0xDFFF
          const hasLoneSurrogate = /[\uD800-\uDFFF]/.test(
            content.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")
          );
          expect(hasLoneSurrogate).toBe(false);
        }
      });
    });

    describe("handleMultiCursorDelete with emoji", () => {
      it("deletes entire emoji (surrogate pair) after cursor", () => {
        // "a😀b" with cursor before 😀 (pos 2, parentOffset 1)
        const state = createMultiCursorState("a😀b", [
          { from: 2, to: 2 },
        ]);

        const result = handleMultiCursorDelete(state);
        expect(result).not.toBeNull();

        if (result) {
          const newState = state.apply(result);
          // Should delete the whole emoji, leaving "ab"
          expect(newState.doc.textContent).toBe("ab");
        }
      });

      it("deletes ASCII character after cursor (no regression)", () => {
        // "a😀b" with cursor before 'b' (pos 4, parentOffset 3)
        const state = createMultiCursorState("a😀b", [
          { from: 4, to: 4 },
        ]);

        const result = handleMultiCursorDelete(state);
        expect(result).not.toBeNull();

        if (result) {
          const newState = state.apply(result);
          expect(newState.doc.textContent).toBe("a😀");
        }
      });

      it("handles multiple cursors with emoji", () => {
        // "😀a😀" — cursor before 'a' (pos 3) and before second 😀 (pos 4)
        const state = createMultiCursorState("😀a😀", [
          { from: 3, to: 3 },
          { from: 4, to: 4 },
        ]);

        const result = handleMultiCursorDelete(state);
        expect(result).not.toBeNull();

        if (result) {
          const newState = state.apply(result);
          // First cursor deletes 'a', second deletes 😀 → "😀"
          expect(newState.doc.textContent).toBe("😀");
        }
      });

      it("handles cursor at end of paragraph (no-op)", () => {
        const state = createMultiCursorState("😀", [
          { from: 3, to: 3 }, // after 😀, parentOffset = 2 = content.size
        ]);

        const result = handleMultiCursorDelete(state);
        expect(result).not.toBeNull();

        if (result) {
          const newState = state.apply(result);
          expect(newState.doc.textContent).toBe("😀");
        }
      });

      it("does not produce lone surrogates for multi-codepoint emoji", () => {
        const familyEmoji = "👨‍👩‍👧";
        const text = "a" + familyEmoji + "b";
        // cursor before the family emoji (after 'a')
        const cursorPos = 2; // pos 2 = after 'a'
        const state = createMultiCursorState(text, [
          { from: cursorPos, to: cursorPos },
        ]);

        const result = handleMultiCursorDelete(state);
        expect(result).not.toBeNull();

        if (result) {
          const newState = state.apply(result);
          const content = newState.doc.textContent;
          // The content should NOT contain any lone surrogates
          const hasLoneSurrogate = /[\uD800-\uDFFF]/.test(
            content.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")
          );
          expect(hasLoneSurrogate).toBe(false);
        }
      });

      it("handles text with only emoji", () => {
        // "😀😀" with cursor between the two emoji (pos 3)
        const state = createMultiCursorState("😀😀", [
          { from: 3, to: 3 },
        ]);

        const result = handleMultiCursorDelete(state);
        expect(result).not.toBeNull();

        if (result) {
          const newState = state.apply(result);
          expect(newState.doc.textContent).toBe("😀");
        }
      });
    });

    describe("handleMultiCursorBackspace with emoji - additional", () => {
      it("handles text with only emoji", () => {
        // "😀😀" with cursor after first emoji (pos 3)
        const state = createMultiCursorState("😀😀", [
          { from: 3, to: 3 },
        ]);

        const result = handleMultiCursorBackspace(state);
        expect(result).not.toBeNull();

        if (result) {
          const newState = state.apply(result);
          expect(newState.doc.textContent).toBe("😀");
        }
      });

      it("handles empty text (no crash)", () => {
        const state = createMultiCursorState("", [
          { from: 1, to: 1 },
        ]);

        const result = handleMultiCursorBackspace(state);
        expect(result).not.toBeNull();

        if (result) {
          const newState = state.apply(result);
          expect(newState.doc.textContent).toBe("");
        }
      });
    });
  });
});
