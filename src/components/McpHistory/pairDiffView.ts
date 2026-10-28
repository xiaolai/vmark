/**
 * Pair diff view — turns a canonical change list over two whole documents
 * into the bounded run of segments the "edited in two windows" row shows:
 * unchanged context, deleted text, inserted text, and gaps where unchanged
 * text was left out.
 *
 * Key decisions:
 *   - The change list comes from the review diff (`canonicalDiff`), so the
 *     inserted and deleted text is exactly what review would see; this file
 *     only lays it out and never re-diffs.
 *   - Bounded for any document size: at most `CONTEXT_UNITS` of unchanged
 *     text on each side of a change, each deleted or inserted part clipped
 *     to `MAX_PART_UNITS`, and the whole view held to `MAX_VIEW_UNITS`
 *     UTF-16 units of text. Changes past that budget are counted in
 *     `hiddenChanges`, not shown. Work is linear in the changes it lays out.
 *   - No cut falls inside a surrogate pair, so an emoji is never split.
 *
 * @coordinates-with services/agentJournal/review/textChanges.ts — the change-list shape
 * @module components/McpHistory/pairDiffView
 */

import { midPair, type TextChange } from "@/services/agentJournal/review/textChanges";

/** Unchanged UTF-16 units kept on each side of a change. */
export const CONTEXT_UNITS = 60;
/** Most UTF-16 units shown of one deleted or inserted part. */
export const MAX_PART_UNITS = 2_000;
/** Most UTF-16 units of text one view holds. */
export const MAX_VIEW_UNITS = 20_000;

export type DiffSegment =
  | { readonly kind: "same"; readonly text: string }
  | { readonly kind: "gap" }
  | { readonly kind: "delete" | "insert"; readonly text: string; readonly clipped: boolean };

export interface DiffView {
  readonly segments: readonly DiffSegment[];
  /** Changes past the view's budget, left out. */
  readonly hiddenChanges: number;
}

/** `[from, to)` of `x`, each end moved off a surrogate pair's middle (inward). */
function slice(x: string, from: number, to: number): string {
  const f = midPair(x, from) ? from + 1 : from;
  const t = midPair(x, to) ? to - 1 : to;
  return t > f ? x.slice(f, t) : "";
}

const same = (text: string): DiffSegment[] => (text ? [{ kind: "same", text }] : []);

/** An unchanged run `[from, to)` of `a`, cut to context: `lead` keeps its end, `trail` its start, between keeps both. */
function context(a: string, from: number, to: number, place: "lead" | "between" | "trail"): DiffSegment[] {
  const keepHead = place !== "lead";
  const keepTail = place !== "trail";
  const room = (keepHead ? CONTEXT_UNITS : 0) + (keepTail ? CONTEXT_UNITS : 0);
  if (to - from <= room) return same(a.slice(from, to));
  return [
    ...(keepHead ? same(slice(a, from, from + CONTEXT_UNITS)) : []),
    { kind: "gap" },
    ...(keepTail ? same(slice(a, to - CONTEXT_UNITS, to)) : []),
  ];
}

function part(kind: "delete" | "insert", x: string, from: number, to: number): DiffSegment[] {
  if (to === from) return [];
  const clipped = to - from > MAX_PART_UNITS;
  return [{ kind, text: clipped ? slice(x, from, from + MAX_PART_UNITS) : x.slice(from, to), clipped }];
}

const size = (segments: readonly DiffSegment[]): number => segments.reduce((n, s) => n + (s.kind === "gap" ? 0 : s.text.length), 0);

/** The bounded view of `changes`, a canonical change list from `a` to `b`. */
export function diffView(a: string, b: string, changes: readonly TextChange[]): DiffView {
  const segments: DiffSegment[] = [];
  let used = 0;
  let pos = 0;
  for (let i = 0; i < changes.length; i += 1) {
    const c = changes[i];
    const piece = [
      ...context(a, pos, c.fromA, i === 0 ? "lead" : "between"),
      ...part("delete", a, c.fromA, c.toA),
      ...part("insert", b, c.fromB, c.toB),
    ];
    const cost = size(piece);
    if (used + cost > MAX_VIEW_UNITS) {
      segments.push({ kind: "gap" });
      return { segments, hiddenChanges: changes.length - i };
    }
    segments.push(...piece);
    used += cost;
    pos = c.toA;
  }
  if (changes.length > 0) {
    const tail = context(a, pos, a.length, "trail");
    if (used + size(tail) <= MAX_VIEW_UNITS) segments.push(...tail);
    else segments.push({ kind: "gap" });
  }
  return { segments, hiddenChanges: 0 };
}
