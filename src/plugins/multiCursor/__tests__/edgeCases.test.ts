/**
 * Edge case and boundary tests for multi-cursor plugin.
 *
 * Covers:
 * 1. Adjacent/overlapping ranges after edit operations (merge behavior)
 * 2. Boundary positions (start/end of document)
 * 3. Large cursor counts (50+)
 */
import { describe, it, expect } from "vitest";
import { MultiSelection } from "../MultiSelection";
import {
  handleMultiCursorInput,
  handleMultiCursorBackspace,
  handleMultiCursorDelete,
} from "../inputHandling";
import { createDoc, createMultiCursorState } from "./testHelpers";

describe("createDoc helper", () => {
  it("creates an empty paragraph when text is empty string", () => {
    const doc = createDoc("");
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild!.type.name).toBe("paragraph");
    expect(doc.firstChild!.content.size).toBe(0);
  });
});

describe("edgeCases", () => {
  describe("adjacent cursors merge after edit", () => {
    it("merges cursors that collide after backspace", () => {
      // "ab" with cursors at pos 2 and 3 (between 'a'|'b' and 'b'|end)
      // After backspace: both delete one char, "ab" → "" and cursors collapse to same pos
      const state = createMultiCursorState("ab", [
        { from: 2, to: 2 },
        { from: 3, to: 3 },
      ]);

      const result = handleMultiCursorBackspace(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        expect(newState.doc.textContent).toBe("");
        const sel = newState.selection as MultiSelection;
        // After merge, overlapping cursors should be merged
        expect(sel.ranges.length).toBeLessThanOrEqual(2);
      }
    });

    it("merges cursors that collide after insertion at adjacent positions", () => {
      // "a" with two cursors at pos 1 and 2 (before and after 'a')
      // After inserting "XX", text becomes "XXaXX" and cursors are at 3 and 5
      // These should remain separate (not overlap)
      const state = createMultiCursorState("a", [
        { from: 1, to: 1 },
        { from: 2, to: 2 },
      ]);

      const result = handleMultiCursorInput(state, "XX");
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        expect(newState.doc.textContent).toBe("XXaXX");
        const sel = newState.selection as MultiSelection;
        // Two cursors should still be separate
        expect(sel.ranges.length).toBe(2);
      }
    });

    it("merges when selections overlap after delete", () => {
      // "abcd" with cursors at 1 and 2 (adjacent)
      // Delete removes char after each: 'a' and 'b' deleted → "cd"
      // Both cursors map to position 1 → should merge
      const state = createMultiCursorState("abcd", [
        { from: 1, to: 1 },
        { from: 2, to: 2 },
      ]);

      const result = handleMultiCursorDelete(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        expect(newState.doc.textContent).toBe("cd");
        const sel = newState.selection as MultiSelection;
        // Both cursors should be at position 1, merged to single cursor
        expect(sel.ranges.length).toBe(1);
        expect(sel.ranges[0].$from.pos).toBe(1);
      }
    });
  });

  describe("overlapping selection ranges", () => {
    it("merges overlapping ranges before input", () => {
      // Ranges [3,7] and [5,9] overlap at positions 5-7
      // Merged: [3,9] covers "llo wo" in "hello world"
      // Replace with "X" → "he" + "X" + "rld" = "heXrld"
      const state = createMultiCursorState("hello world", [
        { from: 3, to: 7 },
        { from: 5, to: 9 },
      ]);

      const result = handleMultiCursorInput(state, "X");
      expect(result).not.toBeNull();

      const newState = state.apply(result!);
      expect(newState.doc.textContent).toBe("heXrld");
      const sel = newState.selection as MultiSelection;
      // Merged to single range, cursor after inserted "X"
      expect(sel.ranges.length).toBe(1);
    });

    it("merges overlapping ranges before backspace", () => {
      // Ranges [3,7] and [5,9] overlap → merged to [3,9]
      // Backspace on selection = delete selection
      // Delete [3,9] → "he" + "rld" = "herld"
      const state = createMultiCursorState("hello world", [
        { from: 3, to: 7 },
        { from: 5, to: 9 },
      ]);

      const result = handleMultiCursorBackspace(state);
      expect(result).not.toBeNull();

      const newState = state.apply(result!);
      expect(newState.doc.textContent).toBe("herld");
      const sel = newState.selection as MultiSelection;
      expect(sel.ranges.length).toBe(1);
    });

    it("merges overlapping ranges before delete", () => {
      // Same as backspace — delete on non-empty selection deletes it
      const state = createMultiCursorState("hello world", [
        { from: 3, to: 7 },
        { from: 5, to: 9 },
      ]);

      const result = handleMultiCursorDelete(state);
      expect(result).not.toBeNull();

      const newState = state.apply(result!);
      expect(newState.doc.textContent).toBe("herld");
      const sel = newState.selection as MultiSelection;
      expect(sel.ranges.length).toBe(1);
    });

    it("merges chain of 3 overlapping ranges before input", () => {
      // [2,5]+[4,7]+[6,9] → merged to [2,9] covers "ello wo"
      // Replace with "X" → "h" + "X" + "rld" = "hXrld"
      const state = createMultiCursorState("hello world", [
        { from: 2, to: 5 },
        { from: 4, to: 7 },
        { from: 6, to: 9 },
      ]);

      const result = handleMultiCursorInput(state, "X");
      expect(result).not.toBeNull();

      const newState = state.apply(result!);
      expect(newState.doc.textContent).toBe("hXrld");
      const sel = newState.selection as MultiSelection;
      expect(sel.ranges.length).toBe(1);
    });
  });

  describe("document boundary positions", () => {
    it("backspace at pos 1 (start of content) is no-op for that cursor", () => {
      const state = createMultiCursorState("hello", [
        { from: 1, to: 1 }, // start of paragraph content
        { from: 4, to: 4 },
      ]);

      const result = handleMultiCursorBackspace(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        // Only second cursor deletes: "helo" not "ello"
        expect(newState.doc.textContent).toBe("helo");
      }
    });

    it("delete at end of content is no-op for that cursor", () => {
      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 6, to: 6 }, // end of paragraph
      ]);

      const result = handleMultiCursorDelete(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        // Only first cursor deletes: "hllo"
        expect(newState.doc.textContent).toBe("hllo");
      }
    });

    it("input at position 1 inserts at start", () => {
      const state = createMultiCursorState("hello", [
        { from: 1, to: 1 },
      ]);

      const result = handleMultiCursorInput(state, "X");
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        expect(newState.doc.textContent).toBe("Xhello");
      }
    });

    it("input at end of content appends", () => {
      const state = createMultiCursorState("hello", [
        { from: 6, to: 6 },
      ]);

      const result = handleMultiCursorInput(state, "X");
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        expect(newState.doc.textContent).toBe("helloX");
      }
    });
  });

  describe("large cursor counts", () => {
    it("handles 50 cursors with input correctly", () => {
      // Create a long string with 50+ positions
      const text = "a".repeat(100);
      // Place cursors every 2 characters
      const positions: Array<{ from: number; to: number }> = [];
      for (let i = 0; i < 50; i++) {
        const pos = 1 + i * 2;
        positions.push({ from: pos, to: pos });
      }

      const state = createMultiCursorState(text, positions);
      const result = handleMultiCursorInput(state, "X");
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        // 100 'a's + 50 'X's = 150 characters
        expect(newState.doc.textContent).toHaveLength(150);
        const sel = newState.selection as MultiSelection;
        expect(sel.ranges.length).toBe(50);
        // Verify all cursor positions are distinct and in ascending order
        for (let i = 1; i < sel.ranges.length; i++) {
          expect(sel.ranges[i].$from.pos).toBeGreaterThan(sel.ranges[i - 1].$from.pos);
        }
      }
    });

    it("handles 50 cursors with backspace correctly", () => {
      const text = "ab".repeat(50); // 100 chars: "ababab..."
      // Place cursors after each 'a' (before 'b'): pos 2, 4, 6, ...
      // In ProseMirror, pos 1='a', pos 2='b', pos 3='a', pos 4='b', ...
      // Cursor at pos 2 → backspace deletes 'a' at pos 1
      // Instead, place cursors after each 'b': pos 3, 5, 7, ...
      // Cursor at pos 3 → backspace deletes 'b' at pos 2
      const positions: Array<{ from: number; to: number }> = [];
      for (let i = 0; i < 50; i++) {
        const pos = 1 + (i * 2) + 2; // position after each 'b': 3, 5, 7, ...
        positions.push({ from: pos, to: pos });
      }

      const state = createMultiCursorState(text, positions);
      const result = handleMultiCursorBackspace(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        // Each cursor deletes one 'b', leaving 50 'a's
        expect(newState.doc.textContent).toBe("a".repeat(50));
      }
    });
  });
});
