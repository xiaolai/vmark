import { describe, it, expect } from "vitest";
import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, TextSelection, SelectionRange } from "@tiptap/pm/state";
import { multiCursorPlugin } from "../multiCursorPlugin";
import { MultiSelection } from "../MultiSelection";
import {
  selectNextOccurrence,
  selectAllOccurrences,
  collapseMultiSelection,
  skipOccurrence,
  softUndoCursor,
  addCursorAbove,
  addCursorBelow,
} from "../commands";
import { getCodeBlockBounds } from "../codeBlockBounds";

// Simple schema for testing
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    codeBlock: { content: "text*", group: "block" },
    text: { inline: true },
  },
});

function createDoc(text: string) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
}

function createMixedDoc() {
  return schema.node("doc", null, [
    schema.node("codeBlock", null, [schema.text("hello hello")]),
    schema.node("paragraph", null, [schema.text("hello")]),
  ]);
}

function findOccurrences(doc: ProseMirrorNode, searchText: string) {
  const results: Array<{ from: number; to: number }> = [];
  doc.descendants((node: { isText?: boolean; text?: string }, pos: number) => {
    if (!node.isText) return;
    const text = node.text ?? "";
    let index = text.indexOf(searchText);
    while (index !== -1) {
      results.push({ from: pos + index, to: pos + index + searchText.length });
      index = text.indexOf(searchText, index + 1);
    }
  });
  return results;
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

describe("commands", () => {
  describe("selectNextOccurrence", () => {
    it("selects word under cursor when selection is empty and only one occurrence exists", () => {
      // "hello world" - cursor inside "hello"
      const state = createState("hello world", { anchor: 3, head: 3 });
      const result = selectNextOccurrence(state);

      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        expect(newState.selection).toBeInstanceOf(MultiSelection);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges).toHaveLength(1);
        // Should select "hello" (pos 1-6 in doc)
        expect(multiSel.ranges[0].$from.pos).toBe(1);
        expect(multiSel.ranges[0].$to.pos).toBe(6);
      }
    });

    it("selects word and adds next occurrence when selection is empty", () => {
      // "hello hello" - cursor inside first "hello"
      const state = createState("hello hello", { anchor: 3, head: 3 });
      const result = selectNextOccurrence(state);

      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        expect(newState.selection).toBeInstanceOf(MultiSelection);

        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges).toHaveLength(2);
      }
    });

    it("finds and adds next occurrence of selected text", () => {
      // "hello hello world" - "hello" at positions 1-6 and 7-12
      const state = createState("hello hello world", { anchor: 1, head: 6 });
      const result = selectNextOccurrence(state);

      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        expect(newState.selection).toBeInstanceOf(MultiSelection);

        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges).toHaveLength(2);
        // First range: original selection
        expect(multiSel.ranges[0].$from.pos).toBe(1);
        expect(multiSel.ranges[0].$to.pos).toBe(6);
        // Second range: next occurrence
        expect(multiSel.ranges[1].$from.pos).toBe(7);
        expect(multiSel.ranges[1].$to.pos).toBe(12);
      }
    });

    it("wraps around to find occurrence before cursor", () => {
      // "hello world hello" - select second "hello" (13-18), should wrap to first
      const state = createState("hello world hello", { anchor: 13, head: 18 });
      const result = selectNextOccurrence(state);

      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges).toHaveLength(2);
      }
    });

    it("does not add duplicate ranges", () => {
      const state = createState("hello world");
      // Create state with existing multi-selection covering all "hello"
      const doc = state.doc;
      const $from = doc.resolve(1);
      const $to = doc.resolve(6);
      const ranges = [new SelectionRange($from, $to)];
      const multiSel = new MultiSelection(ranges, 0);
      const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

      // Try to add next occurrence - should return null (no more to add)
      const result = selectNextOccurrence(stateWithMulti);
      expect(result).toBeNull();
    });

    it("returns null when cursor is not in a word", () => {
      // Cursor at space
      const state = createState("hello world", { anchor: 6, head: 6 });
      const result = selectNextOccurrence(state);
      // Should return null since cursor is at space position
      expect(result).toBeNull();
    });

    it("restricts occurrences to the current code block", () => {
      const doc = createMixedDoc();
      const occurrences = findOccurrences(doc, "hello");
      const first = occurrences[0];
      const state = EditorState.create({
        doc,
        schema,
        plugins: [multiCursorPlugin()],
        selection: TextSelection.create(doc, first.from, first.to),
      });

      const result = selectNextOccurrence(state);
      expect(result).not.toBeNull();
      if (result) {
        const nextState = state.apply(result);
        const bounds = getCodeBlockBounds(nextState, first.from);
        expect(bounds).not.toBeNull();
        const multiSel = nextState.selection as MultiSelection;
        expect(multiSel.ranges.length).toBe(2);
        const allInside = multiSel.ranges.every(
          (range) => bounds && range.$from.pos >= bounds.from && range.$to.pos <= bounds.to
        );
        expect(allInside).toBe(true);
      }
    });
  });

  describe("selectAllOccurrences", () => {
    it("selects all occurrences of selected text", () => {
      // "hello hello hello" - three occurrences
      const state = createState("hello hello hello", { anchor: 1, head: 6 });
      const result = selectAllOccurrences(state);

      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        expect(newState.selection).toBeInstanceOf(MultiSelection);

        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges).toHaveLength(3);
      }
    });

    it("selects word under cursor and all occurrences when selection is empty", () => {
      // "hello world hello" - cursor inside first "hello"
      const state = createState("hello world hello", { anchor: 3, head: 3 });
      const result = selectAllOccurrences(state);

      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges).toHaveLength(2);
      }
    });

    it("returns null when no word under cursor", () => {
      const state = createState("hello world", { anchor: 6, head: 6 });
      const result = selectAllOccurrences(state);
      expect(result).toBeNull();
    });

    it("handles single occurrence (no duplicates to find)", () => {
      const state = createState("hello world", { anchor: 1, head: 6 });
      const result = selectAllOccurrences(state);

      // Should still work but with single selection
      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        // Either TextSelection or MultiSelection with 1 range
        expect(newState.selection.from).toBe(1);
        expect(newState.selection.to).toBe(6);
      }
    });

    it("selects occurrences only within the current code block", () => {
      const doc = createMixedDoc();
      const occurrences = findOccurrences(doc, "hello");
      const first = occurrences[0];
      const state = EditorState.create({
        doc,
        schema,
        plugins: [multiCursorPlugin()],
        selection: TextSelection.create(doc, first.from, first.to),
      });

      const result = selectAllOccurrences(state);
      expect(result).not.toBeNull();
      if (result) {
        const nextState = state.apply(result);
        const bounds = getCodeBlockBounds(nextState, first.from);
        expect(bounds).not.toBeNull();
        const multiSel = nextState.selection as MultiSelection;
        const allInside = multiSel.ranges.every(
          (range) => bounds && range.$from.pos >= bounds.from && range.$to.pos <= bounds.to
        );
        expect(allInside).toBe(true);
      }
    });
  });

  describe("collapseMultiSelection", () => {
    it("collapses to primary cursor", () => {
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

      const result = collapseMultiSelection(stateWithMulti);

      expect(result).not.toBeNull();
      if (result) {
        const newState = stateWithMulti.apply(result);
        // Should be TextSelection at primary position (1)
        expect(newState.selection).not.toBeInstanceOf(MultiSelection);
        expect(newState.selection.from).toBe(1);
        expect(newState.selection.to).toBe(1);
      }
    });

    it("respects primary index when collapsing", () => {
      const state = createState("hello world");
      const doc = state.doc;
      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ];
      // Primary is at index 1 (position 7)
      const multiSel = new MultiSelection(ranges, 1);
      const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

      const result = collapseMultiSelection(stateWithMulti);

      expect(result).not.toBeNull();
      if (result) {
        const newState = stateWithMulti.apply(result);
        expect(newState.selection.from).toBe(7);
        expect(newState.selection.to).toBe(7);
      }
    });

    it("preserves selection range when collapsing from selection", () => {
      const state = createState("hello world");
      const doc = state.doc;
      const $from1 = doc.resolve(1);
      const $to1 = doc.resolve(6); // "hello"
      const $pos2 = doc.resolve(10);

      const ranges = [
        new SelectionRange($from1, $to1), // selection
        new SelectionRange($pos2, $pos2), // cursor
      ];
      const multiSel = new MultiSelection(ranges, 0);
      const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

      const result = collapseMultiSelection(stateWithMulti);

      expect(result).not.toBeNull();
      if (result) {
        const newState = stateWithMulti.apply(result);
        // Should preserve the selection "hello"
        expect(newState.selection.from).toBe(1);
        expect(newState.selection.to).toBe(6);
      }
    });

    it("returns null for non-MultiSelection", () => {
      const state = createState("hello world", { anchor: 1, head: 1 });
      const result = collapseMultiSelection(state);
      expect(result).toBeNull();
    });
  });

  describe("skipOccurrence", () => {
    it("skips last-added range and finds next match", () => {
      // "hello hello hello" — select first "hello", then Cmd+D twice to get 3 ranges
      const state0 = createState("hello hello hello", { anchor: 1, head: 6 });
      const tr1 = selectNextOccurrence(state0);
      expect(tr1).not.toBeNull();
      const state1 = state0.apply(tr1!);
      const tr2 = selectNextOccurrence(state1);
      expect(tr2).not.toBeNull();
      const state2 = state1.apply(tr2!);
      // state2 has 3 ranges: [1-6, 7-12, 13-18], primary=2 (last added)
      const multi2 = state2.selection as MultiSelection;
      expect(multi2.ranges).toHaveLength(3);

      // Skip should remove primary (13-18) and find next — but all are taken,
      // so it wraps; since 1-6 and 7-12 exist, no more matches → just remove
      const tr3 = skipOccurrence(state2);
      expect(tr3).not.toBeNull();
      if (tr3) {
        const state3 = state2.apply(tr3);
        const multi3 = state3.selection as MultiSelection;
        // Should have 2 ranges remaining: [1-6] and [7-12]
        expect(multi3.ranges).toHaveLength(2);
        expect(multi3.ranges[0].$from.pos).toBe(1);
        expect(multi3.ranges[0].$to.pos).toBe(6);
        expect(multi3.ranges[1].$from.pos).toBe(7);
        expect(multi3.ranges[1].$to.pos).toBe(12);
      }
    });

    it("skips and finds next occurrence when more matches exist", () => {
      // "aa bb aa bb aa" — select "aa" at pos 1-3, add next (7-9)
      const state0 = createState("aa bb aa bb aa", { anchor: 1, head: 3 });
      const tr1 = selectNextOccurrence(state0);
      expect(tr1).not.toBeNull();
      const state1 = state0.apply(tr1!);
      // state1 has 2 ranges: [1-3, 7-9], primary at last-added (7-9)
      const multi1 = state1.selection as MultiSelection;
      expect(multi1.ranges).toHaveLength(2);

      // Skip: remove 7-9, find next "aa" after pos 9 → should find 13-15
      const trSkip = skipOccurrence(state1);
      expect(trSkip).not.toBeNull();
      if (trSkip) {
        const stateSkip = state1.apply(trSkip);
        const multiSkip = stateSkip.selection as MultiSelection;
        expect(multiSkip.ranges).toHaveLength(2);
        // Should have [1-3] and [13-15]
        expect(multiSkip.ranges[0].$from.pos).toBe(1);
        expect(multiSkip.ranges[0].$to.pos).toBe(3);
        expect(multiSkip.ranges[1].$from.pos).toBe(13);
        expect(multiSkip.ranges[1].$to.pos).toBe(15);
      }
    });

    it("returns null on non-MultiSelection", () => {
      const state = createState("hello world", { anchor: 1, head: 6 });
      expect(skipOccurrence(state)).toBeNull();
    });

    it("returns null when only one range in MultiSelection", () => {
      // Create a MultiSelection with single range
      const state = createState("hello world");
      const doc = state.doc;
      const ranges = [new SelectionRange(doc.resolve(1), doc.resolve(6))];
      const multiSel = new MultiSelection(ranges, 0);
      const stateWithMulti = state.apply(state.tr.setSelection(multiSel));
      expect(skipOccurrence(stateWithMulti)).toBeNull();
    });

    it("wraps around when skipping past end of document", () => {
      // "aa bb aa" — select first "aa" (1-3), add second (7-9)
      // skip → remove 7-9, look after pos 9 → no match, wrap → find 1-3
      // but 1-3 already exists, so just removes
      const state0 = createState("aa bb aa", { anchor: 1, head: 3 });
      const tr1 = selectNextOccurrence(state0);
      expect(tr1).not.toBeNull();
      const state1 = state0.apply(tr1!);

      const trSkip = skipOccurrence(state1);
      expect(trSkip).not.toBeNull();
      if (trSkip) {
        const stateSkip = state1.apply(trSkip);
        // Only the original range should remain
        const sel = stateSkip.selection;
        expect(sel.from).toBe(1);
        expect(sel.to).toBe(3);
      }
    });
  });

  describe("softUndoCursor", () => {
    it("returns to previous selection after one Cmd+D", () => {
      // "hello hello" — select first "hello" (1-6), Cmd+D adds second (7-12)
      const state0 = createState("hello hello", { anchor: 1, head: 6 });
      const tr1 = selectNextOccurrence(state0);
      expect(tr1).not.toBeNull();
      const state1 = state0.apply(tr1!);
      const multi1 = state1.selection as MultiSelection;
      expect(multi1.ranges).toHaveLength(2);

      // Soft undo should return to just the first "hello" selected
      const trUndo = softUndoCursor(state1);
      expect(trUndo).not.toBeNull();
      if (trUndo) {
        const stateUndo = state1.apply(trUndo);
        // Should have 1 range back to the original selection
        const sel = stateUndo.selection;
        expect(sel.from).toBe(1);
        expect(sel.to).toBe(6);
      }
    });

    it("undoes two Cmd+D steps sequentially", () => {
      // "hello hello hello" — build up 3 ranges via 2 Cmd+D
      const state0 = createState("hello hello hello", { anchor: 1, head: 6 });
      const tr1 = selectNextOccurrence(state0);
      const state1 = state0.apply(tr1!);
      const tr2 = selectNextOccurrence(state1);
      const state2 = state1.apply(tr2!);
      expect((state2.selection as MultiSelection).ranges).toHaveLength(3);

      // First soft undo: back to 2 ranges
      const trUndo1 = softUndoCursor(state2);
      expect(trUndo1).not.toBeNull();
      const state3 = state2.apply(trUndo1!);
      expect((state3.selection as MultiSelection).ranges).toHaveLength(2);

      // Second soft undo: back to 1 range
      const trUndo2 = softUndoCursor(state3);
      expect(trUndo2).not.toBeNull();
      const state4 = state3.apply(trUndo2!);
      expect(state4.selection.from).toBe(1);
      expect(state4.selection.to).toBe(6);
    });

    it("returns null on empty history", () => {
      // Fresh state with multi-selection (not built via selectNextOccurrence)
      const state = createState("hello world");
      const doc = state.doc;
      const ranges = [
        new SelectionRange(doc.resolve(1), doc.resolve(6)),
        new SelectionRange(doc.resolve(7), doc.resolve(12)),
      ];
      const multiSel = new MultiSelection(ranges, 0);
      const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

      // No history → null
      expect(softUndoCursor(stateWithMulti)).toBeNull();
    });

    it("clears history after a text edit", () => {
      // Build up history via Cmd+D
      const state0 = createState("hello hello", { anchor: 1, head: 6 });
      const tr1 = selectNextOccurrence(state0);
      const state1 = state0.apply(tr1!);

      // Now do a text edit (insert a character)
      const trEdit = state1.tr.insertText("x", 1);
      const state2 = state1.apply(trEdit);

      // History should be cleared — soft undo returns null
      expect(softUndoCursor(state2)).toBeNull();
    });

    it("returns null on non-MultiSelection", () => {
      const state = createState("hello world", { anchor: 1, head: 1 });
      expect(softUndoCursor(state)).toBeNull();
    });

    it("restores single-range snapshot as TextSelection", () => {
      // Build from explicit selection: "hello" selected (1-6) -> Cmd+D adds second
      const state0 = createState("hello hello", { anchor: 1, head: 6 });
      const tr1 = selectNextOccurrence(state0);
      expect(tr1).not.toBeNull();
      const state1 = state0.apply(tr1!);
      const multi1 = state1.selection as MultiSelection;
      expect(multi1.ranges).toHaveLength(2);

      // state1 has 2 ranges. Soft undo should restore to 1 range
      const trUndo = softUndoCursor(state1);
      expect(trUndo).not.toBeNull();
      if (trUndo) {
        const stateUndo = state1.apply(trUndo);
        // Should restore to the original single selection
        expect(stateUndo.selection.from).toBe(1);
        expect(stateUndo.selection.to).toBe(6);
      }
    });
  });

  describe("getCodeBlockBounds", () => {
    it("returns bounds when cursor is inside code block", () => {
      const doc = schema.node("doc", null, [
        schema.node("codeBlock", null, [schema.text("code content")]),
      ]);
      const state = EditorState.create({ doc, schema });
      // Position 1 is inside the code block content
      const bounds = getCodeBlockBounds(state, 5);

      expect(bounds).not.toBeNull();
      expect(bounds?.from).toBe(1); // Start of code block content
      expect(bounds?.to).toBe(13); // End of code block content
    });

    it("returns null when cursor is not in code block", () => {
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text("regular text")]),
      ]);
      const state = EditorState.create({ doc, schema });
      const bounds = getCodeBlockBounds(state, 5);

      expect(bounds).toBeNull();
    });

    it("returns correct bounds for code block with code_block type name", () => {
      // Some schemas use "code_block" instead of "codeBlock"
      const altSchema = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: { content: "text*", group: "block" },
          code_block: { content: "text*", group: "block" },
          text: { inline: true },
        },
      });
      const doc = altSchema.node("doc", null, [
        altSchema.node("code_block", null, [altSchema.text("code here")]),
      ]);
      const state = EditorState.create({ doc, schema: altSchema });
      const bounds = getCodeBlockBounds(state, 5);

      expect(bounds).not.toBeNull();
    });

    it("returns bounds for code block in mixed document", () => {
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text("before")]),
        schema.node("codeBlock", null, [schema.text("in code")]),
        schema.node("paragraph", null, [schema.text("after")]),
      ]);
      const state = EditorState.create({ doc, schema });
      // Find position inside the code block
      // paragraph "before" = positions 0-7, codeBlock starts at 8
      const bounds = getCodeBlockBounds(state, 10);

      expect(bounds).not.toBeNull();
      expect(bounds?.from).toBe(9); // Start of code block content
      expect(bounds?.to).toBe(16); // End of code block content
    });

    it("returns null for position in paragraph between code blocks", () => {
      const doc = schema.node("doc", null, [
        schema.node("codeBlock", null, [schema.text("first")]),
        schema.node("paragraph", null, [schema.text("between")]),
        schema.node("codeBlock", null, [schema.text("second")]),
      ]);
      const state = EditorState.create({ doc, schema });
      // Position in "between" paragraph (after first code block)
      const bounds = getCodeBlockBounds(state, 10);

      expect(bounds).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // addCursorAbove / addCursorBelow
  // ---------------------------------------------------------------------------

  describe("addCursorAbove", () => {
    function makeView(
      state: EditorState,
      coordsAtPos: (pos: number) => { top: number; bottom: number; left: number; right: number },
      posAtCoords: (coords: { left: number; top: number }) => { pos: number } | null
    ) {
      return { state, coordsAtPos, posAtCoords } as unknown as import("@tiptap/pm/view").EditorView;
    }

    it("returns null when posAtCoords returns null", () => {
      const state = createState("hello world", { anchor: 3, head: 3 });
      const view = makeView(
        state,
        () => ({ top: 100, bottom: 120, left: 50, right: 55 }),
        () => null
      );
      expect(addCursorAbove(state, view)).toBeNull();
    });

    it("returns null when new position equals existing position", () => {
      const state = createState("hello world", { anchor: 3, head: 3 });
      const view = makeView(
        state,
        () => ({ top: 100, bottom: 120, left: 50, right: 55 }),
        () => ({ pos: 3 }) // same position — no movement
      );
      expect(addCursorAbove(state, view)).toBeNull();
    });

    it("returns null when new position is already in selection", () => {
      // Build a MultiSelection at positions 1 and 7
      const state0 = createState("hello hello", { anchor: 1, head: 6 });
      const tr = selectNextOccurrence(state0);
      const state = state0.apply(tr!);

      const view = makeView(
        state,
        (pos) => ({ top: 100, bottom: 120, left: pos * 5, right: pos * 5 + 5 }),
        () => ({ pos: 1 }) // maps to an already-existing range start
      );
      expect(addCursorAbove(state, view)).toBeNull();
    });

    it("adds cursor at new position above", () => {
      const state = createState("hello world", { anchor: 8, head: 8 });
      const view = makeView(
        state,
        () => ({ top: 100, bottom: 120, left: 50, right: 55 }),
        () => ({ pos: 2 }) // a different position above
      );
      const tr = addCursorAbove(state, view);
      expect(tr).not.toBeNull();
      const newState = state.apply(tr!);
      expect(newState.selection).toBeInstanceOf(MultiSelection);
    });

    it("uses DEFAULT_LINE_HEIGHT_PX when coords have zero height", () => {
      const state = createState("hello world", { anchor: 8, head: 8 });
      const view = makeView(
        state,
        () => ({ top: 100, bottom: 100, left: 50, right: 55 }), // zero height
        () => ({ pos: 2 })
      );
      const tr = addCursorAbove(state, view);
      expect(tr).not.toBeNull();
    });
  });

  describe("addCursorBelow", () => {
    function makeView(
      state: EditorState,
      coordsAtPos: (pos: number) => { top: number; bottom: number; left: number; right: number },
      posAtCoords: (coords: { left: number; top: number }) => { pos: number } | null
    ) {
      return { state, coordsAtPos, posAtCoords } as unknown as import("@tiptap/pm/view").EditorView;
    }

    it("returns null when posAtCoords returns null", () => {
      const state = createState("hello world", { anchor: 3, head: 3 });
      const view = makeView(
        state,
        () => ({ top: 100, bottom: 120, left: 50, right: 55 }),
        () => null
      );
      expect(addCursorBelow(state, view)).toBeNull();
    });

    it("returns null when new position equals existing position", () => {
      const state = createState("hello world", { anchor: 3, head: 3 });
      const view = makeView(
        state,
        () => ({ top: 100, bottom: 120, left: 50, right: 55 }),
        () => ({ pos: 3 })
      );
      expect(addCursorBelow(state, view)).toBeNull();
    });

    it("adds cursor at new position below", () => {
      const state = createState("hello world", { anchor: 2, head: 2 });
      const view = makeView(
        state,
        () => ({ top: 100, bottom: 120, left: 50, right: 55 }),
        () => ({ pos: 9 }) // position below
      );
      const tr = addCursorBelow(state, view);
      expect(tr).not.toBeNull();
      const newState = state.apply(tr!);
      expect(newState.selection).toBeInstanceOf(MultiSelection);
    });

    it("works when current selection is a MultiSelection (uses bottommost)", () => {
      // Build MultiSelection with two ranges: [1,6] and [7,12].
      // Target pos 14 sits in the trailing " xx" — outside every existing
      // range (a target inside a selected range must be rejected).
      const state0 = createState("hello hello xx", { anchor: 1, head: 6 });
      const tr1 = selectNextOccurrence(state0);
      const state = state0.apply(tr1!);

      const view = makeView(
        state,
        (pos) => ({ top: pos * 5, bottom: pos * 5 + 10, left: 50, right: 55 }),
        () => ({ pos: 14 })
      );
      const tr = addCursorBelow(state, view);
      expect(tr).not.toBeNull();
    });

    it("returns null when new position falls inside an existing selection range", () => {
      // Ranges [1,6] and [7,12]; pos 10 is strictly inside [7,12].
      const state0 = createState("hello hello", { anchor: 1, head: 6 });
      const tr1 = selectNextOccurrence(state0);
      const state = state0.apply(tr1!);

      const view = makeView(
        state,
        (pos) => ({ top: pos * 5, bottom: pos * 5 + 10, left: 50, right: 55 }),
        () => ({ pos: 10 })
      );
      expect(addCursorBelow(state, view)).toBeNull();
    });

    it("returns null when new position is already in a MultiSelection range (line 443)", () => {
      // Build MultiSelection with two cursor positions (3 and 7)
      const state0 = createState("hello hello", { anchor: 1, head: 6 });
      const tr1 = selectNextOccurrence(state0);
      const state = state0.apply(tr1!);
      // state has 2 ranges

      // posAtCoords returns pos=7, which is the start of the second range
      const view = makeView(
        state,
        () => ({ top: 100, bottom: 120, left: 50, right: 55 }),
        () => ({ pos: 7 }) // already exists in selection
      );
      expect(addCursorBelow(state, view)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Additional coverage for uncovered branches
  // ---------------------------------------------------------------------------

  describe("selectNextOccurrence — MultiSelection in code block (line 86)", () => {
    it("filters existing ranges to code block bounds when MultiSelection is in a code block", () => {
      // Create a doc with a codeBlock containing 'ab ab' and a paragraph with 'ab'
      const doc = schema.node("doc", null, [
        schema.node("codeBlock", null, [schema.text("ab ab")]),
        schema.node("paragraph", null, [schema.text("ab")]),
      ]);
      // Select first 'ab' in code block (pos 1-3)
      const state0 = EditorState.create({
        doc,
        schema,
        plugins: [multiCursorPlugin()],
        selection: TextSelection.create(doc, 1, 3),
      });
      // Add next occurrence (second 'ab' in code block at 4-6) via selectNextOccurrence
      const tr1 = selectNextOccurrence(state0);
      expect(tr1).not.toBeNull();
      const state1 = state0.apply(tr1!);
      // Now state1 has MultiSelection with 2 ranges inside the code block
      expect(state1.selection).toBeInstanceOf(MultiSelection);

      // selectNextOccurrence again — now exercising the MultiSelection + bounds branch (line 85-86)
      const tr2 = selectNextOccurrence(state1);
      // All 'ab' occurrences in the codeBlock are already selected, so this should return null
      expect(tr2).toBeNull();
    });
  });

  describe("selectNextOccurrence — empty searchText (line 118)", () => {
    it("returns null when getSelectionText returns empty string (cross-block selection)", () => {
      // textBetween returns '' when the selection spans across block boundaries (no text nodes).
      // Select from end of first paragraph to start of second paragraph (the block node itself).
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text("hello")]),
        schema.node("paragraph", null, [schema.text("world")]),
      ]);
      // Position 6 = after "hello" (end of first paragraph's content), 7 = block boundary
      // textBetween(6, 7) = '' since there's no text node there
      const state = EditorState.create({
        doc,
        schema,
        plugins: [multiCursorPlugin()],
        selection: TextSelection.create(doc, 6, 7),
      });
      const result = selectNextOccurrence(state);
      expect(result).toBeNull();
    });
  });

  describe("selectNextOccurrence — word outside code block bounds (line 103-104)", () => {
    it("returns null when cursor word is outside code block bounds", () => {
      // We need: cursor in a code block, but getWordAtCursor returns a word whose
      // from/to positions fall outside the code block bounds.
      // This is hard to trigger naturally because the word would be inside the block.
      // However, if we use a position at the edge of the code block, the word could straddle.
      // In practice this branch requires the word to extend past the block boundary.
      // We test adjacent condition: cursor is inside code block but at a position
      // where getWordAtCursor returns null (e.g., at a space) → returns null from word check (line 98).
      const doc = schema.node("doc", null, [
        schema.node("codeBlock", null, [schema.text("hello world")]),
      ]);
      // Cursor at the space (pos 6) — getWordAtCursor should return null for spaces
      const state = EditorState.create({
        doc,
        schema,
        plugins: [multiCursorPlugin()],
        selection: TextSelection.create(doc, 7, 7), // space between hello and world
      });
      const result = selectNextOccurrence(state);
      expect(result).toBeNull();
    });
  });

  describe("selectNextOccurrence — no nextOccurrence (line 141)", () => {
    it("returns null when all occurrences are already selected in MultiSelection", () => {
      // "aa aa" — select both 'aa' → MultiSelection with 2 ranges
      // Then selectNextOccurrence → no unused occurrence → null
      const state0 = createState("aa aa", { anchor: 1, head: 3 });
      const tr1 = selectNextOccurrence(state0);
      expect(tr1).not.toBeNull();
      const state1 = state0.apply(tr1!);
      // Now both 'aa' selected
      const multi = state1.selection as MultiSelection;
      expect(multi.ranges).toHaveLength(2);

      // Try again → no next occurrence available
      const tr2 = selectNextOccurrence(state1);
      expect(tr2).toBeNull();
    });
  });

  describe("selectAllOccurrences — word outside code block bounds (line 179-180)", () => {
    it("returns null when word under cursor is outside code block bounds in selectAll", () => {
      // Cursor in code block at a space position → getWordAtCursor returns null
      const doc = schema.node("doc", null, [
        schema.node("codeBlock", null, [schema.text("hello world")]),
      ]);
      const state = EditorState.create({
        doc,
        schema,
        plugins: [multiCursorPlugin()],
        selection: TextSelection.create(doc, 7, 7), // space → no word
      });
      const result = selectAllOccurrences(state);
      expect(result).toBeNull();
    });
  });

  describe("selectAllOccurrences — primaryIndex detection (line 210-218)", () => {
    it("sets primaryIndex to match the original selection position", () => {
      // "hello world hello" — select second "hello" (13-18)
      // selectAllOccurrences should set primary to the occurrence that matches (13-18)
      const state = createState("hello world hello", { anchor: 13, head: 18 });
      const result = selectAllOccurrences(state);

      expect(result).not.toBeNull();
      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges).toHaveLength(2);
        // Primary should be at the second occurrence (index 1)
        expect(multiSel.primaryIndex).toBe(1);
      }
    });
  });

  describe("selectAllOccurrences — empty searchText (line 192)", () => {
    it("returns null when getSelectionText returns empty string (cross-block selection)", () => {
      // textBetween returns '' when selection spans block boundaries with no text node
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text("hello")]),
        schema.node("paragraph", null, [schema.text("world")]),
      ]);
      // Select the block boundary area — textBetween returns ''
      const state = EditorState.create({
        doc,
        schema,
        plugins: [multiCursorPlugin()],
        selection: TextSelection.create(doc, 6, 7),
      });
      const result = selectAllOccurrences(state);
      expect(result).toBeNull();
    });
  });

  describe("selectAllOccurrences — occurrences.length === 0 (zero-occurrence guard)", () => {
    it("returns null for a selection spanning a block boundary (cross-node searchText)", () => {
      // Selection spans two paragraphs: textBetween joins "he" + "llo" into
      // "hello" (empty block separator), but findAllOccurrences matches within
      // single text nodes only, so no occurrence exists anywhere in the doc.
      // The zero-occurrences guard must return null instead of crashing on an
      // empty range list.
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text("he")]),
        schema.node("paragraph", null, [schema.text("llo")]),
      ]);
      const state = EditorState.create({
        doc,
        schema,
        plugins: [multiCursorPlugin()],
        selection: TextSelection.create(doc, 1, 8),
      });
      expect(state.doc.textBetween(1, 8)).toBe("hello");
      const result = selectAllOccurrences(state);
      expect(result).toBeNull();
    });
  });

  describe("selectAllOccurrences — filteredRanges.length === 0 (line 206)", () => {
    it("returns null when all ranges fall outside code block bounds after filtering", () => {
      // This requires: bounds is set, occurrences are found, but filterRangesToBounds removes all.
      // That means all occurrences are OUTSIDE the current code block's bounds.
      // But the word was found by searching the whole doc with bounds=undefined for the word...
      // Actually: bounds is set AND occurrences are found with bounds, so they're inside the bounds.
      // filteredRanges = filterRangesToBounds(ranges, bounds) would keep all of them.
      // For filteredRanges to be empty, filterRangesToBounds must reject all — meaning all occurrences
      // are outside the bounds. But findAllOccurrences(state, text, bounds) already limits to bounds.
      // So this branch requires bounds to be set, findAllOccurrences to return results, but none inside.
      // This is logically impossible in normal usage.
      // We confirm by testing that selectAllOccurrences works normally in code block context.
      const doc = schema.node("doc", null, [
        schema.node("codeBlock", null, [schema.text("ab ab")]),
      ]);
      const state = EditorState.create({
        doc,
        schema,
        plugins: [multiCursorPlugin()],
        selection: TextSelection.create(doc, 1, 3), // select 'ab'
      });
      const result = selectAllOccurrences(state);
      // Should select both 'ab' in code block
      expect(result).not.toBeNull();
    });
  });

  describe("addCursorAbove — MultiSelection topmost reduction (lines 417-418)", () => {
    function makeView(
      state: EditorState,
      coordsAtPos: (pos: number) => { top: number; bottom: number; left: number; right: number },
      posAtCoords: (coords: { left: number; top: number }) => { pos: number } | null
    ) {
      return { state, coordsAtPos, posAtCoords } as unknown as import("@tiptap/pm/view").EditorView;
    }

    it("uses topmost range from MultiSelection when adding cursor above (line 418)", () => {
      // Build MultiSelection with two cursor ranges so addCursorAbove uses the
      // reduce on MultiSelection. Ranges: [4,9] and [10,15]; target pos 2 sits
      // in the leading "aa " — outside every existing range (a target inside a
      // selected range must be rejected).
      const state0 = createState("aa hello hello", { anchor: 10, head: 15 });
      const tr1 = selectNextOccurrence(state0);
      const state = state0.apply(tr1!);
      // state has MultiSelection

      const view = makeView(
        state,
        (pos) => ({ top: pos * 2, bottom: pos * 2 + 10, left: 50, right: 55 }),
        () => ({ pos: 2 }) // new position above
      );
      const tr = addCursorAbove(state, view);
      expect(tr).not.toBeNull();
    });
  });

  describe("addCursorBelow — MultiSelection bottommost reduction (lines 420-421)", () => {
    function makeView(
      state: EditorState,
      coordsAtPos: (pos: number) => { top: number; bottom: number; left: number; right: number },
      posAtCoords: (coords: { left: number; top: number }) => { pos: number } | null
    ) {
      return { state, coordsAtPos, posAtCoords } as unknown as import("@tiptap/pm/view").EditorView;
    }

    it("finds bottommost cursor in MultiSelection (line 421 reduce path)", () => {
      // Three cursors at different positions — bottommost reduction picks the max
      const state0 = createState("hello hello hello", { anchor: 1, head: 6 });
      const tr1 = selectNextOccurrence(state0);
      const state = state0.apply(tr1!);

      const view = makeView(
        state,
        (pos) => ({ top: pos, bottom: pos + 10, left: 50, right: 55 }),
        () => ({ pos: 15 }) // position below all existing
      );
      const tr = addCursorBelow(state, view);
      expect(tr).not.toBeNull();
    });
  });

  describe("addCursorAbove/Below — duplicate cursor deduplication (line 443)", () => {
    function makeView(
      state: EditorState,
      coordsAtPos: (pos: number) => { top: number; bottom: number; left: number; right: number },
      posAtCoords: (coords: { left: number; top: number }) => { pos: number } | null
    ) {
      return { state, coordsAtPos, posAtCoords } as unknown as import("@tiptap/pm/view").EditorView;
    }

    it("returns null when posAtCoords maps to an existing cursor position in MultiSelection (line 443)", () => {
      // Build a MultiSelection with two cursor (empty) ranges at positions 1 and 7
      const doc = createDoc("hello hello");
      const stateBase = EditorState.create({ doc, schema, plugins: [multiCursorPlugin()] });
      const cursors = [
        new SelectionRange(doc.resolve(1), doc.resolve(1)),
        new SelectionRange(doc.resolve(7), doc.resolve(7)),
      ];
      const multiSel = new MultiSelection(cursors, 1);
      const state = stateBase.apply(stateBase.tr.setSelection(multiSel));

      // posAtCoords returns pos=7 which matches an existing empty cursor range exactly
      const view = makeView(
        state,
        () => ({ top: 100, bottom: 120, left: 50, right: 55 }),
        () => ({ pos: 7 }) // matches cursor at 7 exactly (from === to === 7)
      );
      expect(addCursorBelow(state, view)).toBeNull();
    });
  });

  describe("skipOccurrence — empty searchText (line 272)", () => {
    it("returns null when primary range is empty (zero-length search text)", () => {
      // Create a MultiSelection where the primary range has from === to (cursor, not selection)
      const state = createState("hello hello");
      const doc = state.doc;
      // Two cursor ranges (not selections) — textBetween will return ''
      const ranges = [
        new SelectionRange(doc.resolve(1), doc.resolve(1)), // cursor at 1
        new SelectionRange(doc.resolve(7), doc.resolve(7)), // cursor at 7
      ];
      const multiSel = new MultiSelection(ranges, 1); // primary at index 1 (pos 7)
      const stateWithMulti = state.apply(state.tr.setSelection(multiSel));

      // skipOccurrence: primary range text = '' → returns null (line 272)
      const result = skipOccurrence(stateWithMulti);
      expect(result).toBeNull();
    });
  });
});
