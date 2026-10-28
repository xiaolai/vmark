/**
 * Provenance window — one capture window of a tab's provenance session:
 * the text it started from, the accumulator of everything since, and the
 * basis slot naming the journal record that holds its starting text.
 *
 * Key decisions:
 *   - The slot is shared by reference with the freeze that ended the
 *     previous window: when that save is recorded the slot learns its id,
 *     when it is cancelled or refused the slot becomes `invalid` and the
 *     window can never be certified (fail closed).
 *   - A deferral's ranges (the WYSIWYG collector's block map) are checked
 *     before they are believed: in order, without overlap, every text
 *     between and around them identical in both texts, the lengths adding
 *     up — or they are no map at all.
 *
 * @coordinates-with services/agentJournal/provenance/session.ts — the owner
 * @module services/agentJournal/provenance/window
 */

import { Provenance } from "./accumulator";

/** What a window's starting text is in the journal. */
export type BasisSlot =
  | { kind: "handshake" }
  | { kind: "pending" }
  | { kind: "known"; id: string }
  | { kind: "invalid" };

export interface ProvenanceWindow {
  readonly pre: string;
  readonly slot: BasisSlot;
  readonly acc: Provenance;
}

export function openWindow(pre: string, slot: BasisSlot, cap: number): ProvenanceWindow {
  return { pre, slot, acc: new Provenance(pre.length, { cap }) };
}

/** The slot's basis when it is known, else `null`. */
export const slotBasis = (slot: BasisSlot): string | null => (slot.kind === "known" ? slot.id : null);

/** Settle a still-open slot; a settled slot keeps its first answer. */
export function settleSlot(slot: BasisSlot, id: string | null): void {
  if (slot.kind !== "pending" && slot.kind !== "handshake") return;
  Object.assign(slot, id === null ? { kind: "invalid" } : { kind: "known", id });
  if (id === null) delete (slot as { id?: string }).id;
}

/** A replacement of `[from, to)` in the base text by `insert` characters, recorded under `origin`. */
export interface DeferredRange {
  from: number;
  to: number;
  insert: number;
  origin?: string;
}

/** The collector could not bound the change: one whole break, under its reason. */
export interface DeferredWhole {
  whole: "snapshotOnly" | "capOverflow";
  origin: string;
}

/** What a deferral materializes to: bounded breaks in base order, a whole break, or `null` (no map). */
export type DeferredOutcome = readonly DeferredRange[] | DeferredWhole | null;

const WHOLE_REASONS: ReadonlySet<string> = new Set(["snapshotOnly", "capOverflow"]);

/** True when `out` is a whole break the accumulator accepts: a reason the journal knows and a non-empty origin. */
export function isDeferredWhole(out: DeferredOutcome): out is DeferredWhole {
  if (out === null || Array.isArray(out)) return false;
  const { whole, origin } = out as DeferredWhole;
  return WHOLE_REASONS.has(whole) && typeof origin === "string" && origin !== "";
}

/**
 * True when `ranges` (ascending, non-overlapping, in base coordinates) turn
 * `base` into `after` with every text between and around them identical.
 */
export function rangesFit(ranges: DeferredOutcome, base: string, after: string): ranges is readonly DeferredRange[] {
  if (!Array.isArray(ranges)) return false;
  let b = 0;
  let a = 0;
  for (const range of ranges as readonly unknown[]) {
    // A collector's answer is runtime data: a malformed element fails closed, never throws.
    if (typeof range !== "object" || range === null) return false;
    const { from, to, insert } = range as DeferredRange;
    if (![from, to, insert].every((n) => Number.isSafeInteger(n))) return false;
    if (from < b || to < from || to > base.length || insert < 0) return false;
    const kept = from - b;
    if (a + kept + insert > after.length || base.slice(b, from) !== after.slice(a, a + kept)) return false;
    a += kept + insert;
    b = to;
  }
  return base.length - b === after.length - a && base.slice(b) === after.slice(a);
}

/** Record `ranges` (base coordinates, ascending) as bounded breaks in the accumulator's current coordinates. Throws when they do not compose. */
export function composeRanges(acc: Provenance, ranges: readonly DeferredRange[], origin: string): void {
  let shift = 0;
  for (const r of ranges) {
    acc.breakRange(r.from + shift, r.to + shift, r.insert, "uncertifiedRange", r.origin ?? `${origin}:blocks`);
    shift += r.insert - (r.to - r.from);
  }
}
