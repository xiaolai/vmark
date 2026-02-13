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
});
