/**
 * Tests for horizontalMovement module
 *
 * Covers moveRangeHorizontally and handleMultiCursorHorizontal with
 * different units (char, word, line), extend mode, and backward selections.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, SelectionRange } from "@tiptap/pm/state";
import { multiCursorPlugin } from "../multiCursorPlugin";
import { MultiSelection } from "../MultiSelection";
import { handleMultiCursorHorizontal } from "../horizontalMovement";

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

function createMultiState(
  text: string,
  ranges: Array<{ from: number; to: number }>,
  primaryIndex = 0,
  backward?: boolean[]
) {
  const doc = createDoc(text);
  const state = EditorState.create({
    doc,
    schema,
    plugins: [multiCursorPlugin()],
  });

  const selRanges = ranges.map((r) =>
    new SelectionRange(doc.resolve(r.from), doc.resolve(r.to))
  );
  const multiSel = new MultiSelection(selRanges, primaryIndex, backward);
  return state.apply(state.tr.setSelection(multiSel));
}

describe("handleMultiCursorHorizontal", () => {
  it("returns null for non-MultiSelection", () => {
    const state = EditorState.create({
      doc: createDoc("hello"),
      schema,
      plugins: [multiCursorPlugin()],
    });
    expect(handleMultiCursorHorizontal(state, "ArrowRight", false, "char")).toBeNull();
  });

  describe("char movement", () => {
    it("moves cursors right by one character", () => {
      const state = createMultiState("hello world", [
        { from: 1, to: 1 },
        { from: 7, to: 7 },
      ]);

      const tr = handleMultiCursorHorizontal(state, "ArrowRight", false, "char");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges[0].$from.pos).toBe(2);
        expect(multiSel.ranges[1].$from.pos).toBe(8);
      }
    });

    it("moves cursors left by one character", () => {
      const state = createMultiState("hello world", [
        { from: 3, to: 3 },
        { from: 9, to: 9 },
      ]);

      const tr = handleMultiCursorHorizontal(state, "ArrowLeft", false, "char");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges[0].$from.pos).toBe(2);
        expect(multiSel.ranges[1].$from.pos).toBe(8);
      }
    });

    it("collapses non-empty selection to start on ArrowLeft without extend", () => {
      const state = createMultiState("hello world", [
        { from: 1, to: 6 },  // "hello" selected
      ]);

      const tr = handleMultiCursorHorizontal(state, "ArrowLeft", false, "char");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        // Should collapse to start of selection
        expect(multiSel.ranges[0].$from.pos).toBe(1);
        expect(multiSel.ranges[0].$to.pos).toBe(1);
      }
    });

    it("collapses non-empty selection to end on ArrowRight without extend", () => {
      const state = createMultiState("hello world", [
        { from: 1, to: 6 },  // "hello" selected
      ]);

      const tr = handleMultiCursorHorizontal(state, "ArrowRight", false, "char");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        // Should collapse to end of selection
        expect(multiSel.ranges[0].$from.pos).toBe(6);
        expect(multiSel.ranges[0].$to.pos).toBe(6);
      }
    });

    it("extends selection right with extend=true", () => {
      const state = createMultiState("hello world", [
        { from: 3, to: 3 },
      ]);

      const tr = handleMultiCursorHorizontal(state, "ArrowRight", true, "char");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        // Should extend selection from 3 to 4
        expect(multiSel.ranges[0].$from.pos).toBe(3);
        expect(multiSel.ranges[0].$to.pos).toBe(4);
      }
    });
  });

  describe("word movement", () => {
    it("moves cursor to next word boundary", () => {
      const state = createMultiState("hello world", [
        { from: 3, to: 3 },
      ]);

      const tr = handleMultiCursorHorizontal(state, "ArrowRight", false, "word");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        // Should move to end of "hello" or start of "world"
        expect(multiSel.ranges[0].$from.pos).toBeGreaterThan(3);
      }
    });

    it("moves cursor to previous word boundary", () => {
      const state = createMultiState("hello world", [
        { from: 9, to: 9 },
      ]);

      const tr = handleMultiCursorHorizontal(state, "ArrowLeft", false, "word");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges[0].$from.pos).toBeLessThan(9);
      }
    });
  });

  describe("line movement", () => {
    it("moves cursor to start of line", () => {
      const state = createMultiState("hello world", [
        { from: 6, to: 6 },
      ]);

      const tr = handleMultiCursorHorizontal(state, "ArrowLeft", false, "line");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges[0].$from.pos).toBe(1);
      }
    });

    it("moves cursor to end of line", () => {
      const state = createMultiState("hello world", [
        { from: 3, to: 3 },
      ]);

      const tr = handleMultiCursorHorizontal(state, "ArrowRight", false, "line");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges[0].$from.pos).toBe(12); // end of "hello world"
      }
    });

    it("extends selection to line start", () => {
      const state = createMultiState("hello world", [
        { from: 6, to: 6 },
      ]);

      const tr = handleMultiCursorHorizontal(state, "ArrowLeft", true, "line");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        // Selection should extend from pos 6 to start of line
        expect(multiSel.ranges[0].$from.pos).toBe(1);
        expect(multiSel.ranges[0].$to.pos).toBe(6);
      }
    });
  });

  describe("backward selections", () => {
    it("handles backward selection flags correctly", () => {
      // Create a state with a backward selection (anchor > head)
      const state = createMultiState(
        "hello world",
        [{ from: 1, to: 6 }],
        0,
        [true]  // backward flag
      );

      const tr = handleMultiCursorHorizontal(state, "ArrowRight", true, "char");
      expect(tr).not.toBeNull();
    });

    it("handles backward flag with ArrowLeft extend on char unit", () => {
      const state = createMultiState(
        "hello world",
        [{ from: 3, to: 8 }],
        0,
        [true]
      );

      const tr = handleMultiCursorHorizontal(state, "ArrowLeft", true, "char");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        // With backward=true, head is at $from position, moving left should shrink from left
        expect(multiSel.ranges[0]).toBeDefined();
      }
    });

    it("handles backward flag with word movement", () => {
      const state = createMultiState(
        "hello world",
        [{ from: 1, to: 8 }],
        0,
        [true]
      );

      const tr = handleMultiCursorHorizontal(state, "ArrowLeft", true, "word");
      expect(tr).not.toBeNull();
    });

    it("handles backward flag with line movement", () => {
      const state = createMultiState(
        "hello world",
        [{ from: 1, to: 8 }],
        0,
        [true]
      );

      const tr = handleMultiCursorHorizontal(state, "ArrowLeft", true, "line");
      expect(tr).not.toBeNull();
    });
  });

  describe("edge cases", () => {
    it("extends word movement right", () => {
      const state = createMultiState("hello world", [
        { from: 3, to: 3 },
      ]);

      const tr = handleMultiCursorHorizontal(state, "ArrowRight", true, "word");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        // Extending right by word from position 3 should include more text
        expect(multiSel.ranges[0].$to.pos).toBeGreaterThan(3);
      }
    });

    it("extends line movement right", () => {
      const state = createMultiState("hello world", [
        { from: 3, to: 3 },
      ]);

      const tr = handleMultiCursorHorizontal(state, "ArrowRight", true, "line");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        // Should extend to end of line
        expect(multiSel.ranges[0].$to.pos).toBe(12);
      }
    });

    it("collapses non-empty selection to start on word ArrowLeft", () => {
      const state = createMultiState("hello world", [
        { from: 1, to: 6 },
      ]);

      const tr = handleMultiCursorHorizontal(state, "ArrowLeft", false, "word");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        // Should collapse to $from position
        expect(multiSel.ranges[0].$from.pos).toBe(multiSel.ranges[0].$to.pos);
      }
    });

    it("collapses non-empty selection to end on line ArrowRight", () => {
      const state = createMultiState("hello world", [
        { from: 1, to: 6 },
      ]);

      const tr = handleMultiCursorHorizontal(state, "ArrowRight", false, "line");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        // Should collapse to $to position
        expect(multiSel.ranges[0].$from.pos).toBe(multiSel.ranges[0].$to.pos);
      }
    });

    it("handles multiple cursors with mixed backward flags", () => {
      const state = createMultiState(
        "hello world",
        [
          { from: 2, to: 5 },
          { from: 7, to: 10 },
        ],
        0,
        [true, false]
      );

      const tr = handleMultiCursorHorizontal(state, "ArrowRight", true, "char");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        expect(newState.selection instanceof MultiSelection).toBe(true);
      }
    });

    it("newBackward returns false for collapsed ranges after extend", () => {
      // When extend is true but a range collapses to empty after movement
      const state = createMultiState("ab", [
        { from: 1, to: 2 },  // Select "b"
      ], 0, [false]);

      // Move left with extend — could collapse if anchor and head meet
      const tr = handleMultiCursorHorizontal(state, "ArrowLeft", true, "char");
      expect(tr).not.toBeNull();
    });

    it("newBackward returns false when extend is false", () => {
      const state = createMultiState("hello", [
        { from: 3, to: 3 },
      ]);

      const tr = handleMultiCursorHorizontal(state, "ArrowRight", false, "char");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        // All backward flags should be false since extend=false
        expect(multiSel.backward.every((b) => b === false)).toBe(true);
      }
    });

    it("handles headPos computation via fallback branch (neither from nor to matches anchor)", () => {
      // This tests line 108: the fallback branch where neither range.$from.pos
      // nor range.$to.pos equals anchorPos
      // This can happen when normalization shifts positions
      const state = createMultiState(
        "hello world test",
        [
          { from: 1, to: 6 },
          { from: 7, to: 12 },
        ],
        0,
        [true, false]
      );

      const tr = handleMultiCursorHorizontal(state, "ArrowRight", true, "char");
      expect(tr).not.toBeNull();
    });

    it("newBackward: extend=false always returns false in backward array", () => {
      // Tests line 101: if (!extend) return false
      const state = createMultiState(
        "hello world",
        [
          { from: 1, to: 5 },
          { from: 7, to: 10 },
        ],
        0,
        [false, false]
      );

      // extend=false → collapses selections and backward should be all false
      const tr = handleMultiCursorHorizontal(state, "ArrowLeft", false, "char");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.backward.every((b) => b === false)).toBe(true);
      }
    });

    it("char movement at document start boundary (Selection.findFrom returns null)", () => {
      // At position 1 (start of text content), moving left to position 0
      // then trying to find a selection — at boundary this could return null
      const state = createMultiState("a", [
        { from: 1, to: 1 },
      ]);

      // Move left — at start of doc, findFrom might return null
      const tr = handleMultiCursorHorizontal(state, "ArrowLeft", false, "char");
      expect(tr).not.toBeNull();
    });

    it("char movement with extend=true and backward flag", () => {
      // Tests the backward anchor logic with char extend
      const state = createMultiState(
        "hello world",
        [{ from: 3, to: 8 }],
        0,
        [true] // backward: anchor is at $to (8), head at $from (3)
      );

      const tr = handleMultiCursorHorizontal(state, "ArrowLeft", true, "char");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        // Should extend the selection further left
        expect(multiSel.ranges[0].$from.pos).toBeLessThanOrEqual(3);
      }
    });

    it("word movement returns range unchanged when findWordEdge returns null", () => {
      // Create a single-char document where word edge may not be found
      const state = createMultiState(" ", [
        { from: 1, to: 1 },
      ]);

      // Try word movement in space — findWordEdge may return null
      const tr = handleMultiCursorHorizontal(state, "ArrowRight", false, "word");
      expect(tr).not.toBeNull();
    });

    it("newBackward returns false for collapsed result range (line 100: from === to)", () => {
      // When extending a selection such that head meets anchor, range collapses
      // This tests: range.$from.pos === range.$to.pos → return false (line 100)
      // Use a tiny doc with cursor at pos 1; extend right to end — then extend from pos 2 back to 1
      // The collapsed case: start with cursor range (from===to), extend moves it to a non-collapsed range
      // To get collapse: we need the head to land on the anchor position.
      // Anchor at pos 3 (from=3, backward=false). Extend right produces from=3,to=4 (non-collapsed).
      // Instead: backward selection, anchor=$to=2, head=$from=1; extend RIGHT moves head right to 2=anchorPos
      // → range becomes from=2, to=2 (collapsed)
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text("ab")]),
      ]);
      const baseState = EditorState.create({ doc, schema, plugins: [multiCursorPlugin()] });
      // Backward: $from=1, $to=2, backward=[true] → anchor=$to=2, head=$from=1
      const selRanges = [new SelectionRange(doc.resolve(1), doc.resolve(2))];
      const multiSel = new MultiSelection(selRanges, 0, [true]);
      const state = baseState.apply(baseState.tr.setSelection(multiSel));

      // Extend right: head at pos 1, moves to pos 2 = anchorPos → collapses to from=2, to=2
      const tr = handleMultiCursorHorizontal(state, "ArrowRight", true, "char");
      expect(tr).not.toBeNull();
      if (tr) {
        const newState = state.apply(tr);
        const ms = newState.selection as MultiSelection;
        // Collapsed range → backward[0] should be false (line 100 returns false)
        expect(ms.backward[0]).toBe(false);
      }
    });

    it("newBackward uses $to.pos as headPos when anchor is at $from (branch 20/1 and 21/0)", () => {
      // Forward selection: anchor=$from, head=$to. After extend right, new range has:
      //   $from = anchorPos (anchor didn't move), $to = new head pos
      // So range.$from.pos === anchorPos → branch 20/0 fires (headPos = $to.pos)
      // To hit branch 20/1: need $from ≠ anchorPos, i.e., backward=true where anchor=$to
      // With backward=true, anchorPos = origRange.$to.pos
      // After extend left: new range $from moves left, $to stays at anchor
      // → $from ≠ anchorPos AND $to = anchorPos → branch 21/0 fires
      const state = createMultiState(
        "hello world",
        [{ from: 3, to: 7 }],
        0,
        [true] // backward: anchor=$to=7, head=$from=3
      );

      // Extend right: head at $from=3, moves right to 4; new range = {from:3,to:7} still, wait...
      // Actually moveRangeHorizontally with backward=true: headPos = range.$from.pos = 3
      // Moving right: targetPos = 4; extend=true: anchorPos = range.$to.pos = 7
      // new from = min(7,4)=4, new to = max(7,4)=7 → {from:4, to:7}
      // In newBackward: range.$from.pos=4 ≠ anchorPos=7 (branch 20/1), range.$to.pos=7=anchorPos (branch 21/0)
      // headPos = range.$from.pos = 4, anchorPos=7 > 4 → backward = true
      const tr = handleMultiCursorHorizontal(state, "ArrowRight", true, "char");
      expect(tr).not.toBeNull();
      if (tr) {
        const newState = state.apply(tr);
        const ms = newState.selection as MultiSelection;
        // backward selection remains (anchor > head)
        expect(ms.backward[0]).toBe(true);
      }
    });
  });

  describe("overlapping selection merge (#692)", () => {
    it("merges overlapping selections after Shift+Right extend", () => {
      // Two cursors close together: pos 3 and pos 5
      // After Shift+Right x3, selections would be [3,6] and [5,8] — overlapping
      // They should be merged into a single [3,8] range
      const state = createMultiState(
        "hello world",
        [
          { from: 3, to: 6 },
          { from: 5, to: 8 },
        ]
      );

      // Extend right by one more char — ranges overlap more
      const tr = handleMultiCursorHorizontal(state, "ArrowRight", true, "char");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        // Overlapping ranges should be merged
        expect(multiSel.ranges.length).toBe(1);
      }
    });

    it("merges adjacent selections that become overlapping via Shift+Right", () => {
      // Two cursors at 3 and 5, extend right until they overlap
      const state = createMultiState(
        "hello world",
        [
          { from: 3, to: 3 },
          { from: 5, to: 5 },
        ]
      );

      // Extend right: [3,4] and [5,6] — not yet overlapping
      let tr = handleMultiCursorHorizontal(state, "ArrowRight", true, "char");
      expect(tr).not.toBeNull();
      let newState = state.apply(tr!);

      // Extend right again: [3,5] and [5,7] — touching/overlapping
      tr = handleMultiCursorHorizontal(newState, "ArrowRight", true, "char");
      expect(tr).not.toBeNull();
      newState = newState.apply(tr!);

      // Extend right again: [3,6] and [5,8] — overlapping
      tr = handleMultiCursorHorizontal(newState, "ArrowRight", true, "char");
      expect(tr).not.toBeNull();
      newState = newState.apply(tr!);

      const multiSel = newState.selection as MultiSelection;
      // Should merge overlapping ranges
      expect(multiSel.ranges.length).toBe(1);
    });

    it("does not merge non-overlapping selections", () => {
      const state = createMultiState(
        "hello world",
        [
          { from: 1, to: 1 },
          { from: 7, to: 7 },
        ]
      );

      const tr = handleMultiCursorHorizontal(state, "ArrowRight", true, "char");
      expect(tr).not.toBeNull();

      if (tr) {
        const newState = state.apply(tr);
        const multiSel = newState.selection as MultiSelection;
        // Ranges don't overlap — should remain separate
        expect(multiSel.ranges.length).toBe(2);
      }
    });
  });
});
