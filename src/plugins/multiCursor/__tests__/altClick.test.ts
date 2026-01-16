import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection, SelectionRange } from "@tiptap/pm/state";
import { multiCursorPlugin } from "../multiCursorPlugin";
import { MultiSelection } from "../MultiSelection";
import { addCursorAtPosition, removeCursorAtPosition } from "../altClick";

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

function createState(text: string, selection?: { anchor: number; head: number }) {
  const doc = createDoc(text);
  const state = EditorState.create({
    doc,
    schema,
    plugins: [multiCursorPlugin()],
  });

  if (selection) {
    const tr = state.tr.setSelection(
      TextSelection.create(doc, selection.anchor, selection.head)
    );
    return state.apply(tr);
  }

  return state;
}

describe("altClick", () => {
  describe("addCursorAtPosition", () => {
    it("creates MultiSelection from single cursor", () => {
      const state = createState("hello world", { anchor: 1, head: 1 });
      const result = addCursorAtPosition(state, 7);

      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        expect(newState.selection).toBeInstanceOf(MultiSelection);

        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges).toHaveLength(2);
        expect(multiSel.ranges[0].$from.pos).toBe(1);
        expect(multiSel.ranges[1].$from.pos).toBe(7);
      }
    });

    it("adds cursor to existing MultiSelection", () => {
      const state = createState("hello world");
      const doc = state.doc;
      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(4);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ];
      const multiSel = new MultiSelection(ranges, 0);
      const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

      const result = addCursorAtPosition(stateWithMulti, 7);

      expect(result).not.toBeNull();
      if (result) {
        const newState = stateWithMulti.apply(result);
        const newMultiSel = newState.selection as MultiSelection;
        expect(newMultiSel.ranges).toHaveLength(3);
      }
    });

    it("does not add duplicate cursor at same position", () => {
      const state = createState("hello world", { anchor: 1, head: 1 });
      const result = addCursorAtPosition(state, 1);

      // Should return null or not add duplicate
      if (result) {
        const newState = state.apply(result);
        if (newState.selection instanceof MultiSelection) {
          expect(newState.selection.ranges).toHaveLength(1);
        }
      }
    });

    it("sets new cursor as primary", () => {
      const state = createState("hello world", { anchor: 1, head: 1 });
      const result = addCursorAtPosition(state, 7);

      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        // New cursor at position 7 should be primary (last added)
        expect(multiSel.primaryIndex).toBe(1);
        expect(multiSel.ranges[multiSel.primaryIndex].$from.pos).toBe(7);
      }
    });

    it("works with existing selection (not just cursor)", () => {
      const state = createState("hello world", { anchor: 1, head: 6 });
      const result = addCursorAtPosition(state, 10);

      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        expect(newState.selection).toBeInstanceOf(MultiSelection);

        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges).toHaveLength(2);
        // Original selection preserved
        expect(multiSel.ranges[0].$from.pos).toBe(1);
        expect(multiSel.ranges[0].$to.pos).toBe(6);
      }
    });
  });

  describe("removeCursorAtPosition", () => {
    it("removes cursor from MultiSelection", () => {
      const state = createState("hello world");
      const doc = state.doc;
      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ];
      const multiSel = new MultiSelection(ranges, 0);
      const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

      const result = removeCursorAtPosition(stateWithMulti, 7);

      expect(result).not.toBeNull();
      if (result) {
        const newState = stateWithMulti.apply(result);
        // Should collapse to single selection
        expect(newState.selection).not.toBeInstanceOf(MultiSelection);
        expect(newState.selection.from).toBe(1);
      }
    });

    it("collapses to TextSelection when one cursor remains", () => {
      const state = createState("hello world");
      const doc = state.doc;
      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ];
      const multiSel = new MultiSelection(ranges, 1);
      const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

      // Remove cursor at position 7 (which is primary)
      const result = removeCursorAtPosition(stateWithMulti, 7);

      expect(result).not.toBeNull();
      if (result) {
        const newState = stateWithMulti.apply(result);
        expect(newState.selection.from).toBe(1);
      }
    });

    it("returns null for non-MultiSelection", () => {
      const state = createState("hello world", { anchor: 1, head: 1 });
      const result = removeCursorAtPosition(state, 1);
      expect(result).toBeNull();
    });

    it("adjusts primaryIndex when removing cursor before primary", () => {
      const state = createState("hello world");
      const doc = state.doc;
      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(4);
      const $pos3 = doc.resolve(7);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
        new SelectionRange($pos3, $pos3),
      ];
      const multiSel = new MultiSelection(ranges, 2); // primary at pos 7
      const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

      // Remove cursor at position 1
      const result = removeCursorAtPosition(stateWithMulti, 1);

      expect(result).not.toBeNull();
      if (result) {
        const newState = stateWithMulti.apply(result);
        const newMultiSel = newState.selection as MultiSelection;
        expect(newMultiSel.ranges).toHaveLength(2);
        // Primary should still be at position 7
        expect(newMultiSel.ranges[newMultiSel.primaryIndex].$from.pos).toBe(7);
      }
    });
  });
});
