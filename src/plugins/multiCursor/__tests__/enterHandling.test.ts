import { describe, it, expect, vi, afterEach } from "vitest";
import { SelectionRange } from "@tiptap/pm/state";
import { MultiSelection } from "../MultiSelection";
import { handleMultiCursorKeyDown } from "../inputHandling";
import { createState, createMultiCursorState } from "./testHelpers";

// Store the real canSplit before vi.mock replaces it
const { realCanSplit } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("@tiptap/pm/transform");
  return { realCanSplit: mod.canSplit as (...args: unknown[]) => boolean };
});

vi.mock("@tiptap/pm/transform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/pm/transform")>();
  return { ...actual, canSplit: vi.fn(actual.canSplit) };
});

import { canSplit } from "@tiptap/pm/transform";
import { handleMultiCursorEnter } from "../enterHandling";

describe("handleMultiCursorEnter", () => {
  afterEach(() => {
    // Restore real canSplit after tests that override it
    vi.mocked(canSplit).mockImplementation(realCanSplit);
  });

  it("splits paragraph at all cursor positions", () => {
    // "hello world" in <p>: pos 1 = before 'h', pos 4 = after "hel", pos 8 = after "hello w"
    const state = createMultiCursorState("hello world", [
      { from: 4, to: 4 },
      { from: 8, to: 8 },
    ]);

    const result = handleMultiCursorEnter(state);
    expect(result).not.toBeNull();

    if (result) {
      const newState = state.apply(result);
      // Split into 3 paragraphs: "hel", "lo w", "orld"
      expect(newState.doc.childCount).toBe(3);
      expect(newState.doc.child(0).textContent).toBe("hel");
      expect(newState.doc.child(1).textContent).toBe("lo w");
      expect(newState.doc.child(2).textContent).toBe("orld");
    }
  });

  it("replaces selections and splits", () => {
    // "hello world" — select "lo " (4-7) and "rld" (9-12)
    // pos 4 = after "hel", pos 7 = after "hello ", pos 9 = after "hello wo", pos 12 = end
    const state = createMultiCursorState("hello world", [
      { from: 4, to: 7 },
      { from: 9, to: 12 },
    ]);

    const result = handleMultiCursorEnter(state);
    expect(result).not.toBeNull();

    if (result) {
      const newState = state.apply(result);
      // Descending: delete "rld" (9-12) then split at 9 → "hello wo" | ""
      // Then: delete "lo " (4-7) then split at 4 → "hel" | "wo" | ""
      expect(newState.doc.childCount).toBe(3);
      expect(newState.doc.child(0).textContent).toBe("hel");
      expect(newState.doc.child(1).textContent).toBe("wo");
      expect(newState.doc.child(2).textContent).toBe("");
    }
  });

  it("handles cursor at start of paragraph", () => {
    // "hello" — pos 1 = start of content, pos 4 = after "hel"
    const state = createMultiCursorState("hello", [
      { from: 1, to: 1 },
      { from: 4, to: 4 },
    ]);

    const result = handleMultiCursorEnter(state);
    expect(result).not.toBeNull();

    if (result) {
      const newState = state.apply(result);
      // Split at start creates empty paragraph, split at "hel|lo"
      expect(newState.doc.childCount).toBe(3);
      expect(newState.doc.child(0).textContent).toBe("");
      expect(newState.doc.child(1).textContent).toBe("hel");
      expect(newState.doc.child(2).textContent).toBe("lo");
    }
  });

  it("maintains MultiSelection after Enter", () => {
    const state = createMultiCursorState("hello world", [
      { from: 4, to: 4 },
      { from: 8, to: 8 },
    ]);

    const result = handleMultiCursorEnter(state);
    expect(result).not.toBeNull();

    if (result) {
      const newState = state.apply(result);
      expect(newState.selection).toBeInstanceOf(MultiSelection);
      const multiSel = newState.selection as MultiSelection;
      expect(multiSel.ranges).toHaveLength(2);
    }
  });

  it("places cursors at start of new paragraphs", () => {
    const state = createMultiCursorState("hello world", [
      { from: 4, to: 4 },
      { from: 8, to: 8 },
    ]);

    const result = handleMultiCursorEnter(state);
    expect(result).not.toBeNull();

    if (result) {
      const newState = state.apply(result);
      const multiSel = newState.selection as MultiSelection;
      // Cursor 1 should be at start of "lo w" paragraph
      expect(newState.doc.child(1).textContent).toBe("lo w");
      const p2Start = newState.doc.child(0).nodeSize + 1;
      expect(multiSel.ranges[0].$from.pos).toBe(p2Start);
      // Cursor 2 should be at start of "orld" paragraph
      const p3Start = p2Start + newState.doc.child(1).nodeSize;
      expect(multiSel.ranges[1].$from.pos).toBe(p3Start);
    }
  });

  it("returns null for non-MultiSelection", () => {
    const state = createState("hello world");
    const result = handleMultiCursorEnter(state);
    expect(result).toBeNull();
  });

  it("is dispatched by handleMultiCursorKeyDown for Enter key", () => {
    const state = createMultiCursorState("hello world", [
      { from: 4, to: 4 },
      { from: 8, to: 8 },
    ]);

    const tr = handleMultiCursorKeyDown(state, {
      key: "Enter",
      shiftKey: false,
      isComposing: false,
      keyCode: 13,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    });

    expect(tr).not.toBeNull();
    if (tr) {
      const newState = state.apply(tr);
      expect(newState.doc.childCount).toBe(3);
    }
  });

  describe("overlapping selection ranges", () => {
    it("merges overlapping ranges before splitting", () => {
      // Ranges [3,7] and [5,9] overlap at positions 5-7.
      // Merged: [3,9] covers "llo wo" in "hello world".
      // Without pre-merge: the region would be deleted and split twice,
      // producing an extra paragraph or duplicated content.
      // With pre-merge: delete [3,9] then split at 3 → "he" | "rld".
      const state = createMultiCursorState("hello world", [
        { from: 3, to: 7 },
        { from: 5, to: 9 },
      ]);

      const result = handleMultiCursorEnter(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        // Exactly 2 paragraphs — NOT 3 (which would indicate double-splitting)
        expect(newState.doc.childCount).toBe(2);
        expect(newState.doc.child(0).textContent).toBe("he");
        expect(newState.doc.child(1).textContent).toBe("rld");

        // Selection merged to a single cursor at start of second paragraph
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel).toBeInstanceOf(MultiSelection);
        expect(multiSel.ranges.length).toBe(1);
      }
    });

    it("merges chain of 3 overlapping ranges before splitting", () => {
      // [2,5] + [4,7] + [6,9] → merged to [2,9] covers "ello wo"
      // Delete [2,9] then split at 2 → "h" | "rld"
      const state = createMultiCursorState("hello world", [
        { from: 2, to: 5 },
        { from: 4, to: 7 },
        { from: 6, to: 9 },
      ]);

      const result = handleMultiCursorEnter(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        // Exactly 2 paragraphs — NOT 4 (which would indicate triple-splitting)
        expect(newState.doc.childCount).toBe(2);
        expect(newState.doc.child(0).textContent).toBe("h");
        expect(newState.doc.child(1).textContent).toBe("rld");

        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges.length).toBe(1);
      }
    });

    it("merges overlapping cursor + selection ranges before splitting", () => {
      // Cursor at 5 overlaps with selection [3,7] (5 is inside [3,7]).
      // Merged: [3,7] covers "llo " in "hello world".
      // Delete [3,7] then split at 3 → "he" | "world".
      // Without pre-merge: would split at 5 first (creating extra para)
      // then process [3,7] → 3 paragraphs with corrupted content.
      const state = createMultiCursorState("hello world", [
        { from: 3, to: 7 },
        { from: 5, to: 5 },
      ]);

      const result = handleMultiCursorEnter(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        // Exactly 2 paragraphs — NOT 3 (double-split by the cursor inside [3,7])
        expect(newState.doc.childCount).toBe(2);
        expect(newState.doc.child(0).textContent).toBe("he");
        expect(newState.doc.child(1).textContent).toBe("world");

        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges.length).toBe(1);
      }
    });

    it("absorbs collapsed cursor at end boundary of sibling selection", () => {
      // Selection [3,7] + collapsed cursor exactly at position 7.
      // The shared rangeUtils merge skips boundary-touching, so without
      // the Enter-specific absorption pass, tr.split would fire twice at
      // position 7 and produce an extra empty paragraph.
      const state = createMultiCursorState("hello world", [
        { from: 3, to: 7 },
        { from: 7, to: 7 },
      ]);

      const result = handleMultiCursorEnter(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        // Exactly 2 paragraphs — NOT 3 (double-split at position 7)
        expect(newState.doc.childCount).toBe(2);
        expect(newState.doc.child(0).textContent).toBe("he");
        expect(newState.doc.child(1).textContent).toBe("world");

        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges.length).toBe(1);
      }
    });

    it("absorbs collapsed cursor at start boundary of sibling selection", () => {
      // Collapsed cursor at position 3 + selection [3,7].
      // Without absorption, tr.split would fire twice at position 3.
      const state = createMultiCursorState("hello world", [
        { from: 3, to: 3 },
        { from: 3, to: 7 },
      ]);

      const result = handleMultiCursorEnter(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        expect(newState.doc.childCount).toBe(2);
        expect(newState.doc.child(0).textContent).toBe("he");
        expect(newState.doc.child(1).textContent).toBe("world");

        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges.length).toBe(1);
      }
    });

    it("preserves non-zero primary index when merged-away range was primary", () => {
      // Build the MultiSelection directly with primaryIndex=1 — the
      // second range is the primary. After merge, only one range
      // survives and the primary must be routed to it.
      const state = createState("hello world");
      const doc = state.doc;
      const ranges = [
        new SelectionRange(doc.resolve(3), doc.resolve(7)),
        new SelectionRange(doc.resolve(5), doc.resolve(9)),
      ];
      const multiSel = new MultiSelection(ranges, 1);
      const initState = state.apply(state.tr.setSelection(multiSel));

      const result = handleMultiCursorEnter(initState);
      expect(result).not.toBeNull();

      if (result) {
        const newState = initState.apply(result);
        const newSel = newState.selection as MultiSelection;

        // Merged to 1 range → primaryIndex must be 0 (only surviving range)
        expect(newSel.ranges).toHaveLength(1);
        expect(newSel.primaryIndex).toBe(0);

        // After delete [3,9] and split at 3: "he" | "rld"
        // Cursor should be at start of the second paragraph ("rld")
        expect(newState.doc.childCount).toBe(2);
        expect(newState.doc.child(0).textContent).toBe("he");
        expect(newState.doc.child(1).textContent).toBe("rld");
        const para2Start = newState.doc.child(0).nodeSize + 1;
        expect(newSel.ranges[0].$from.pos).toBe(para2Start);
      }
    });
  });

  describe("canSplit guard behavior", () => {
    it("returns null when all ranges fail canSplit", () => {
      vi.mocked(canSplit).mockReturnValue(false);

      const state = createMultiCursorState("hello", [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]);

      const result = handleMultiCursorEnter(state);
      expect(result).toBeNull();
    });

    it("preserves selection span for skipped ranges", () => {
      // canSplit returns false for pos 2 (first range), true elsewhere
      vi.mocked(canSplit).mockImplementation(
        (_doc: unknown, pos: number) => pos !== 2
      );

      // "hello world" — range 1 selects "ell" (2-5), range 2 cursor at 8
      const state = createMultiCursorState("hello world", [
        { from: 2, to: 5 },
        { from: 8, to: 8 },
      ]);

      const result = handleMultiCursorEnter(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;
        expect(multiSel.ranges).toHaveLength(2);

        // First range was skipped — selection span preserved (from !== to)
        const r0 = multiSel.ranges[0];
        expect(r0.$from.pos).toBe(2);
        expect(r0.$to.pos).toBe(5);

        // Second range was split — collapsed to cursor
        const r1 = multiSel.ranges[1];
        expect(r1.$from.pos).toBe(r1.$to.pos);
      }
    });

    it("preserves merged span when canSplit fails on the merged from", () => {
      // canSplit returns false for pos 3 (the merged from), true elsewhere.
      // This exercises the skipped-range branch operating on merged ranges
      // rather than raw selection.ranges.
      vi.mocked(canSplit).mockImplementation(
        (_doc: unknown, pos: number) => pos !== 3
      );

      // Overlapping [3,7] + [5,9] merge to [3,9], plus a non-overlapping
      // cursor at 11 that successfully splits. The merged range is skipped
      // (canSplit false at 3) and its selection span must be preserved.
      const state = createMultiCursorState("hello world", [
        { from: 3, to: 7 },
        { from: 5, to: 9 },
        { from: 11, to: 11 },
      ]);

      const result = handleMultiCursorEnter(state);
      expect(result).not.toBeNull();

      if (result) {
        const newState = state.apply(result);
        const multiSel = newState.selection as MultiSelection;

        // Two surviving ranges: the preserved merged span + the split cursor
        expect(multiSel.ranges).toHaveLength(2);

        // First range: merged span [3,9] preserved as a selection (from !== to)
        const r0 = multiSel.ranges[0];
        expect(r0.$from.pos).toBe(3);
        expect(r0.$to.pos).toBe(9);
        expect(r0.$from.pos).not.toBe(r0.$to.pos);

        // Second range: cursor, collapsed
        const r1 = multiSel.ranges[1];
        expect(r1.$from.pos).toBe(r1.$to.pos);
      }
    });
  });
});
