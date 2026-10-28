// @vitest-environment node
// WI-RA23.1 — every multi-cursor operation costs at most about linearly in the
// number of cursors.
//
// "Select all occurrences" of a common word reaches hundreds of cursors, and
// each keystroke then runs once per cursor. Typing measured N^2.30 — 273 ms per
// keystroke at 500 cursors — because every edit re-mapped the whole selection
// and every cursor was mapped through every edit. Each operation here is timed
// at 50 and at 500 cursors on a fixed paragraph, on the test thread's CPU clock
// (`measureGrowth`), and its growth exponent must stay below 1.5: the work is
// at most a sort of the cursors (N log N, which reads about 1.2 over this
// range), while a cost quadratic in the cursors reads 2. A wall-clock budget
// would measure the machine's load instead (the tests it replaced failed only
// under parallel suites). Typing itself is pinned in feature-complete.test.ts.
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, SelectionRange, TextSelection } from "@tiptap/pm/state";
import type { Command, Transaction } from "@tiptap/pm/state";
import { history, redo, undo } from "@tiptap/pm/history";
import { MultiSelection } from "@/plugins/shared/MultiSelection";
import { measureGrowth, growthExponent } from "@/test/cpuClock";
import { multiCursorPlugin } from "../multiCursorPlugin";
import {
  handleMultiCursorArrow,
  handleMultiCursorBackspace,
  handleMultiCursorDelete,
  handleMultiCursorInput,
} from "../inputHandling";
import { handleMultiCursorHorizontal } from "../horizontalMovement";
import { selectAllOccurrences, selectNextOccurrence, skipOccurrence, softUndoCursor } from "../commands";
import { findNextUnusedOccurrence } from "../commandHelpers";
import { handleMultiCursorEnter } from "../enterHandling";
import { getMultiCursorClipboardText, handleMultiCursorCut, handleMultiCursorPaste } from "../clipboard";
import { addCursorAtPosition, removeCursorAtPosition } from "../altClick";
import { createMultiCursorDecorations } from "../decorations";

const SMALL = 50;
const LARGE = 500;
const MAX_EXPONENT = 1.5;
const PARAGRAPH_LENGTH = 2000;
/** How far Enter's exponent may exceed the bare splits': the noise of two measurements. */
const ENTER_NOISE = 0.15;
/** Fresh measurement pairs Enter gets; see its test. */
const ENTER_ATTEMPTS = 3;

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
});

/** One paragraph of `text` with the multi-cursor plugin (and history) and the given ranges selected. */
function stateWith(text: string, ranges: ReadonlyArray<readonly [number, number]>): EditorState {
  const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text(text)])]);
  const base = EditorState.create({
    doc,
    schema,
    plugins: [history(), multiCursorPlugin()],
    selection: TextSelection.atStart(doc),
  });
  const selected = ranges.map(([from, to]) => new SelectionRange(doc.resolve(from), doc.resolve(to)));
  return base.apply(base.tr.setSelection(new MultiSelection(selected, selected.length - 1)));
}

/** `count` evenly spaced ranges of `width` characters across the paragraph. */
function spaced(count: number, width: number): Array<[number, number]> {
  const step = Math.floor(PARAGRAPH_LENGTH / count);
  return Array.from({ length: count }, (_, i) => [1 + i * step, 1 + i * step + width]);
}

const cursorsAcross = (count: number) => stateWith("0".repeat(PARAGRAPH_LENGTH), spaced(count, 0));
const selectionsAcross = (count: number) => stateWith("0".repeat(PARAGRAPH_LENGTH), spaced(count, 1));

/** The paragraph with `count` occurrences of "ab" (positions 1 + i·step .. 3 + i·step) in filler. */
function occurrenceText(count: number): string {
  const step = Math.floor(PARAGRAPH_LENGTH / count);
  const chars = Array.from({ length: PARAGRAPH_LENGTH }, () => "x");
  for (let i = 0; i < count; i++) chars.splice(i * step, 2, "a", "b");
  return chars.join("");
}

/**
 * All `count` occurrences selected but the second-to-last, the last one
 * primary: the next unused occurrence is found only after wrapping past
 * every selected one — the longest search Cmd+D and skip can make.
 */
const occurrencesSelected = (count: number) =>
  stateWith(occurrenceText(count), spaced(count, 2).filter((_, i) => i !== count - 2));

/** The transaction `command` dispatches, or null. */
function dispatched(state: EditorState, command: Command): Transaction | null {
  let tr: Transaction | null = null;
  command(state, (dispatchedTr) => {
    tr = dispatchedTr;
  });
  return tr;
}

/** `state` after `tr`, failing loudly when the step that should produce it declined. */
function after(state: EditorState, tr: Transaction | null, what: string): EditorState {
  if (!tr) throw new Error(`${what} declined while building the fixture`);
  return state.apply(tr);
}

/** "X" typed at every cursor: the state an undo starts from. */
const typedAcross = (count: number) => {
  const state = cursorsAcross(count);
  return after(state, handleMultiCursorInput(state, "X"), "typing");
};
const undoneAcross = (count: number) => {
  const state = typedAcross(count);
  return after(state, dispatched(state, undo), "undo");
};

/** Every occurrence added one Cmd+D at a time: a full soft-undo history. */
const occurrencesAdded = (count: number) => {
  let state = stateWith(occurrenceText(count), [[1, 3]]);
  for (let added = 1; added < count; added++) {
    state = after(state, selectNextOccurrence(state), "select next occurrence");
  }
  return state;
};

/** Cursors and one-character selections, alternating. */
const mixedAcross = (count: number) =>
  stateWith(
    "0".repeat(PARAGRAPH_LENGTH),
    spaced(count, 1).map(([from, to], i) => [from, i % 2 ? to : from]),
  );

/** The growth exponent of `work` from SMALL to LARGE cursors. */
function exponentOfWork(build: (count: number) => EditorState, work: (state: EditorState) => void): number {
  return growthExponent(measureGrowth(work, build(SMALL), build(LARGE)), SMALL, LARGE);
}

/** The growth exponent of `operation` from SMALL to LARGE cursors, applying its transaction. */
function exponentOf(
  build: (count: number) => EditorState,
  operation: (state: EditorState) => Transaction | null,
): number {
  return exponentOfWork(build, (state) => {
    const tr = operation(state);
    if (!tr) throw new Error("the operation declined: nothing was measured");
    state.apply(tr);
  });
}

describe("multi-cursor cost grows at most linearly with the cursor count", () => {
  it("typing over a selection at every cursor", () => {
    expect(exponentOf(selectionsAcross, (s) => handleMultiCursorInput(s, "X"))).toBeLessThan(MAX_EXPONENT);
  });

  it("Backspace at every cursor", () => {
    expect(exponentOf(cursorsAcross, handleMultiCursorBackspace)).toBeLessThan(MAX_EXPONENT);
  });

  it("Delete at every cursor", () => {
    expect(exponentOf(cursorsAcross, handleMultiCursorDelete)).toBeLessThan(MAX_EXPONENT);
  });

  it("pasting at every cursor", () => {
    expect(exponentOf(cursorsAcross, (s) => handleMultiCursorPaste(s, "XY"))).toBeLessThan(MAX_EXPONENT);
  });

  it("cutting every selection", () => {
    expect(exponentOf(selectionsAcross, handleMultiCursorCut)).toBeLessThan(MAX_EXPONENT);
  });

  it.each(["char", "word", "line"] as const)("moving every cursor right by %s", (unit) => {
    expect(
      exponentOf(cursorsAcross, (s) => handleMultiCursorHorizontal(s, "ArrowRight", false, unit)),
    ).toBeLessThan(MAX_EXPONENT);
  });

  it("extending every cursor by a character", () => {
    expect(
      exponentOf(cursorsAcross, (s) => handleMultiCursorHorizontal(s, "ArrowLeft", true, "char")),
    ).toBeLessThan(MAX_EXPONENT);
  });

  // Without a view: the coordinate path needs layout, which a node test has not.
  it("moving every cursor down", () => {
    expect(exponentOf(cursorsAcross, (s) => handleMultiCursorArrow(s, "ArrowDown", false))).toBeLessThan(
      MAX_EXPONENT,
    );
  });

  // Another plugin, an MCP edit or undo changing the document maps every cursor.
  it("following an edit made elsewhere", () => {
    expect(exponentOf(cursorsAcross, (s) => s.tr.insertText("Z", PARAGRAPH_LENGTH))).toBeLessThan(
      MAX_EXPONENT,
    );
  });

  it("selecting all occurrences of the word under the cursor", () => {
    const wordAtStart = (count: number) => {
      const doc = stateWith(occurrenceText(count), [[1, 1]]).doc;
      return EditorState.create({ doc, schema, selection: TextSelection.create(doc, 1, 3) });
    };
    expect(exponentOf(wordAtStart, selectAllOccurrences)).toBeLessThan(MAX_EXPONENT);
  });

  it("selecting the next occurrence after wrapping past every selected one", () => {
    expect(exponentOf(occurrencesSelected, selectNextOccurrence)).toBeLessThan(MAX_EXPONENT);
  });

  it("skipping to the next occurrence after wrapping past every selected one", () => {
    expect(exponentOf(occurrencesSelected, skipOccurrence)).toBeLessThan(MAX_EXPONENT);
  });

  // The search itself, without the selection rebuilt around it.
  it("finding the next unused occurrence among N selected ones", () => {
    const search = (count: number) => {
      const state = occurrencesSelected(count);
      const occurrences = spaced(count, 2).map(([from, to]) => ({ from, to }));
      const last = occurrences[count - 1];
      return { occurrences, last, ranges: state.selection.ranges };
    };
    const growth = measureGrowth(
      ({ occurrences, last, ranges }: ReturnType<typeof search>) => {
        if (!findNextUnusedOccurrence(occurrences, last.to, last.from, ranges)) throw new Error("none found");
      },
      search(SMALL),
      search(LARGE),
    );
    expect(growthExponent(growth, SMALL, LARGE)).toBeLessThan(MAX_EXPONENT);
  });

  it("adding one more cursor with Alt+Click", () => {
    expect(exponentOf(cursorsAcross, (s) => addCursorAtPosition(s, 2))).toBeLessThan(MAX_EXPONENT);
  });

  it("removing one cursor with Alt+Click", () => {
    expect(exponentOf(cursorsAcross, (s) => removeCursorAtPosition(s, 1))).toBeLessThan(MAX_EXPONENT);
  });

  it("taking back the last added cursor (soft undo)", () => {
    expect(exponentOf(occurrencesAdded, softUndoCursor)).toBeLessThan(MAX_EXPONENT);
  });

  // History restores every cursor through the selection's bookmark.
  it("undoing and redoing typing at every cursor", () => {
    expect(exponentOf(typedAcross, (s) => dispatched(s, undo))).toBeLessThan(MAX_EXPONENT);
    expect(exponentOf(undoneAcross, (s) => dispatched(s, redo))).toBeLessThan(MAX_EXPONENT);
  });

  it("drawing every cursor", () => {
    expect(exponentOfWork(cursorsAcross, createMultiCursorDecorations)).toBeLessThan(MAX_EXPONENT);
  });

  it("copying every selection", () => {
    expect(exponentOfWork(selectionsAcross, getMultiCursorClipboardText)).toBeLessThan(MAX_EXPONENT);
  });

  // Enter is the one operation whose floor is ProseMirror's, not linear: each
  // split adds a block, and every later split step copies and re-validates
  // the parent's whole child list, and resolving a position scans it. N
  // splits in one paragraph therefore cost N² inside ProseMirror (profiled at
  // 500 cursors: split steps 14.6 ms of 16.1 ms, resolving the new cursors
  // 1.3 ms; the merging, mapping and selection rebuild together 0.2 ms). The
  // handler is held to that floor: its exponent may exceed the bare split
  // loop's by at most the noise of two measurements, so anything it adds
  // must grow more slowly than ProseMirror's own work.
  //
  // The two exponents are measured one after the other, so a load change
  // between them (a parallel suite) moves one and not the other: a single
  // pair under a loaded full run read 1.570 against a 1.541 bound. Each
  // attempt measures a fresh pair back to back and the best excess is kept:
  // noise lands on either side of the bound, while a handler that adds
  // super-linear work of its own exceeds it in every attempt.
  it("Enter at cursors and selections grows no faster than ProseMirror's own splits", () => {
    let excess = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < ENTER_ATTEMPTS && excess >= ENTER_NOISE; attempt += 1) {
      const floor = exponentOfWork(mixedAcross, bareSplits);
      excess = Math.min(excess, exponentOf(mixedAcross, handleMultiCursorEnter) - floor);
    }
    expect(excess).toBeLessThan(ENTER_NOISE);
  });
});

/**
 * ProseMirror's own work for Enter at every range: the deletions and splits,
 * from the end, then as many positions resolved in the result. No merging,
 * mapping or selection.
 */
function bareSplits(state: EditorState): void {
  const { ranges } = state.selection;
  const tr = state.tr;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const { $from, $to } = ranges[i];
    if ($from.pos !== $to.pos) tr.delete($from.pos, $to.pos);
    tr.split($from.pos);
  }
  const size = tr.doc.content.size;
  for (let i = 0; i < ranges.length; i++) tr.doc.resolve(Math.floor(((i + 0.5) * size) / ranges.length));
}
