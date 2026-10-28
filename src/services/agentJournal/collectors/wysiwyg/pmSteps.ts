/**
 * Step geometry for the WYSIWYG transaction ledger — the ranges a
 * ProseMirror step touched, counted and merged without serializing anything.
 *
 * Key decisions:
 *   - StepMaps are empty for mark and attribute steps, so their positions are
 *     recorded explicitly; a ReplaceAroundStep records its whole `from..to`
 *     (a lift keeps the gap content identical, so its map alone would not
 *     cover it).
 *   - A step class this file does not know yields null: the ledger records it
 *     as unknown and the flush breaks the whole document.
 *   - Carrying ranges forward costs one mapping per range per later step
 *     map, which grows with the square of the edits that touch disjoint
 *     places. `MAX_RANGE_MAPPINGS` bounds it; its users fail closed past it.
 *
 * @coordinates-with services/agentJournal/collectors/wysiwyg/txnLedger.ts — the recorder
 * @module services/agentJournal/collectors/wysiwyg/pmSteps
 */

import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  RemoveMarkStep,
  RemoveNodeMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  type Step,
  type StepMap,
} from "@tiptap/pm/transform";

/**
 * Most ranges carried through one step map (`mapRange`) in one pass: within
 * a transaction (the ledger) or across a window (the correspondence). About
 * 130 ms of mapping; past it the pass fails closed into a capped break.
 */
export const MAX_RANGE_MAPPINGS = 2 ** 23;

/** Closed position range `[from, to]` in some document's coordinates. */
export type Range = readonly [number, number];

/** Replaced ranges in one StepMap, through the public API: nothing is copied. */
export function rangeCount(map: StepMap): number {
  let n = 0;
  map.forEach(() => {
    n += 1;
  });
  return n;
}

/** Grow a range so an insertion at either edge stays inside it. */
export function mapRange(r: Range, map: StepMap): Range {
  return [map.map(r[0], -1), map.map(r[1], 1)];
}

/** Sort and merge overlapping or touching ranges. */
export function mergeRanges(ranges: readonly Range[]): Range[] {
  if (ranges.length < 2) return [...ranges];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i][0] <= last[1]) last[1] = Math.max(last[1], sorted[i][1]);
    else out.push([sorted[i][0], sorted[i][1]]);
  }
  return out;
}

/** The ranges one step touched, in the coordinates of the document after it; null for an unknown step. */
export function stepTouched(step: Step, map: StepMap): Range[] | null {
  const out: Range[] = [];
  map.forEach((_oldStart, _oldEnd, newStart, newEnd) => out.push([newStart, newEnd]));
  if (step instanceof ReplaceStep) return out;
  if (step instanceof ReplaceAroundStep) {
    out.push([map.map(step.from, -1), map.map(step.to, 1)]);
    return out;
  }
  if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
    out.push([step.from, step.to]);
    return out;
  }
  if (step instanceof AttrStep || step instanceof AddNodeMarkStep || step instanceof RemoveNodeMarkStep) {
    out.push([step.pos, step.pos + 1]);
    return out;
  }
  return null;
}
