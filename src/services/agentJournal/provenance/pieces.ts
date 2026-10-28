/**
 * Provenance pieces — one monotone position function of the accumulator.
 * V maps every original gap `p` in `[0, lenA]` to a current gap; a piece
 * `{a, b, s, o}` covers `[a, b]` with `V(p) = p + o` (slope) or `V(p) = o`
 * (constant). Composing a transaction maps every value with CodeMirror's
 * own section rule (`ChangeDesc.mapPos`, `MapMode.Simple`), so the result is
 * the SEQUENTIAL mapping, never `ChangeSet.compose`'s. Pieces coalesce as
 * they are emitted, so a site typed and deleted many times stays small.
 *
 * @module services/agentJournal/provenance/pieces
 */

export interface Piece {
  readonly a: number;
  readonly b: number;
  readonly s: 0 | 1;
  readonly o: number;
}

/** One replaced range of a transaction, in CodeMirror's `iterChanges` terms. */
export interface Section {
  readonly fromA: number;
  readonly toA: number;
  readonly fromB: number;
  readonly toB: number;
}

/** A section that replaces nothing with nothing: it maps every position as its neighbours do. */
export const isNoop = (c: Section): boolean => c.fromA === c.toA && c.fromB === c.toB;

/**
 * Throws on a transaction that is not a sorted, consistent, in-bounds section
 * list, or whose resulting document is longer than 2^53-1: past that the
 * mapping arithmetic loses precision. Mirrors the Rust `validate_changes`.
 * Allocates nothing per section and returns the transaction's length change,
 * so a capped caller can refuse a huge transaction without copying it;
 * `composePieces` and the accumulator skip no-op sections where they meet them.
 */
export function checkChanges(changes: readonly Section[], lenB: number): number {
  if (!Number.isSafeInteger(lenB) || lenB < 0) throw new Error(`malformed length ${lenB}`);
  let prevToA = 0;
  let offset = 0;
  for (const c of changes) {
    const { fromA, toA, fromB, toB } = c;
    const ints = Number.isSafeInteger(fromA) && Number.isSafeInteger(toA) && Number.isSafeInteger(fromB) && Number.isSafeInteger(toB);
    if (!ints || fromA < prevToA || toA < fromA || toB < fromB || toA > lenB || fromB !== fromA + offset) {
      throw new Error(`malformed transaction section ${JSON.stringify(c)} (length ${lenB})`);
    }
    offset = toB - toA;
    prevToA = toA;
  }
  // Everything after the last section shifts by its offset.
  if (lenB + offset > Number.MAX_SAFE_INTEGER) {
    throw new Error(`transaction makes the document longer than 2^53-1 (length ${lenB})`);
  }
  return offset;
}

/** `checkChanges`, returning a copy without the no-op sections. */
export function validateChanges(changes: readonly Section[], lenB: number): Section[] {
  checkChanges(changes, lenB);
  return changes.filter((c) => !isNoop(c)).map(({ fromA, toA, fromB, toB }) => ({ fromA, toA, fromB, toB }));
}

function firstEndingAtOrAfter(changes: readonly Section[], pos: number): number {
  let lo = 0;
  let hi = changes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (changes[mid].toA < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** CodeMirror's mapPos over a section list (sections may touch; never merged). */
function mapPos(changes: readonly Section[], pos: number, assoc: number): number {
  let i = firstEndingAtOrAfter(changes, pos);
  while (i < changes.length && changes[i].toA === pos && !(changes[i].fromA === pos && assoc < 0)) i++;
  if (i === changes.length) {
    const last = changes[changes.length - 1];
    return last ? pos + (last.toB - last.toA) : pos;
  }
  const c = changes[i];
  if (pos < c.fromA) return pos + (c.fromB - c.fromA);
  return pos === c.fromA || assoc < 0 ? c.fromB : c.toB;
}

function offsetBefore(changes: readonly Section[], j: number): number {
  if (j < changes.length) return changes[j].fromB - changes[j].fromA;
  const last = changes[changes.length - 1];
  return last ? last.toB - last.toA : 0;
}

/** Appends a piece, coalescing with the previous one when the function continues. */
function pushPiece(out: Piece[], a: number, b: number, s: 0 | 1, o: number): void {
  const last = out[out.length - 1];
  if (a === b) {
    const v = s ? a + o : o;
    if (last && last.s === 0 && last.o === v) {
      out[out.length - 1] = { ...last, b };
      return;
    }
    if (last && last.s === 1 && a + last.o === v) {
      out[out.length - 1] = { ...last, b };
      return;
    }
    out.push({ a, b, s: 1, o: v - a });
    return;
  }
  if (last && last.s === s && last.o === o) {
    out[out.length - 1] = { ...last, b };
    return;
  }
  if (last && s === 0 && last.a === last.b && last.a + last.o === o) {
    out[out.length - 1] = { a: last.a, b, s: 0, o };
    return;
  }
  out.push({ a, b, s, o });
}

export const valueOf = (piece: Piece, p: number): number => (piece.s ? p + piece.o : piece.o);

/** Index of the piece covering `p`. */
function pieceAt(pieces: readonly Piece[], p: number): number {
  let lo = 0;
  let hi = pieces.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pieces[mid].a <= p) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export const evaluate = (pieces: readonly Piece[], p: number): number => valueOf(pieces[pieceAt(pieces, p)], p);

/** Smallest p with V(p) > x (strict) or V(p) >= x; `lenA + 1` when none. */
export function lowerP(pieces: readonly Piece[], lenA: number, x: number, strict: boolean): number {
  const ok = (v: number) => (strict ? v > x : v >= x);
  let lo = 0;
  let hi = pieces.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ok(valueOf(pieces[mid], pieces[mid].b))) hi = mid;
    else lo = mid + 1;
  }
  if (lo === pieces.length) return lenA + 1;
  const piece = pieces[lo];
  if (!piece.s) return piece.a;
  return Math.max(piece.a, (strict ? x + 1 : x) - piece.o);
}

/** Piece emitters for one slope piece, in image (current-gap) coordinates. */
interface Emit {
  slope(from: number, to: number, offset: number): void;
  constant(from: number, to: number, value: number): void;
  point(at: number): void;
}

/**
 * Emits the part of a slope image `[cur, hi]` up to and including section
 * `c`: the unchanged run before it, its start gap, its interior (collapsed to
 * one side by `assoc`) and its end gap. Returns the first image value left.
 */
function emitSection(emit: Emit, c: Section, cur: number, hi: number, assoc: number): number {
  if (cur < c.fromA) {
    const e = Math.min(c.fromA - 1, hi);
    emit.slope(cur, e, c.fromB - c.fromA);
    cur = e + 1;
    if (cur > hi) return cur;
  }
  if (cur === c.fromA) emit.point(cur++);
  const interiorEnd = Math.min(c.toA - 1, hi);
  if (cur <= interiorEnd) {
    emit.constant(cur, interiorEnd, assoc < 0 ? c.fromB : c.toB);
    cur = interiorEnd + 1;
  }
  if (cur === c.toA && cur <= hi) emit.point(cur++);
  return cur;
}

/** Composes a slope piece whose image meets the changed range, section by section. */
function composeSlopePiece(out: Piece[], piece: Piece, changes: readonly Section[], assoc: number, limit: number): void {
  const d = piece.o;
  const hi = piece.b + d;
  const emit: Emit = {
    slope: (from, to, offset) => pushPiece(out, from - d, to - d, 1, d + offset),
    constant: (from, to, value) => pushPiece(out, from - d, to - d, 0, value),
    point: (at) => pushPiece(out, at - d, at - d, 0, mapPos(changes, at, assoc)),
  };
  let cur = piece.a + d;
  let j = firstEndingAtOrAfter(changes, cur);
  for (; j < changes.length && cur <= hi && out.length <= limit; j++) cur = emitSection(emit, changes[j], cur, hi, assoc);
  if (cur <= hi && out.length <= limit) emit.slope(cur, hi, offsetBefore(changes, j));
}

/** Composes one piece; constant pieces and slopes clear of every change map whole. */
function composePiece(out: Piece[], piece: Piece, changes: readonly Section[], assoc: number, limit: number): void {
  if (!piece.s) return pushPiece(out, piece.a, piece.b, 0, mapPos(changes, piece.o, assoc));
  const last = changes[changes.length - 1];
  if (piece.b + piece.o < changes[0].fromA) return pushPiece(out, piece.a, piece.b, 1, piece.o);
  if (piece.a + piece.o > last.toA) return pushPiece(out, piece.a, piece.b, 1, piece.o + last.toB - last.toA);
  composeSlopePiece(out, piece, changes, assoc, limit);
}

/**
 * Composes V with one validated transaction: `V'(p) = mapPos(V(p), assoc)`.
 * Parity with `ChangeDesc.mapPos` is exact for individual sections
 * (`iterChanges(f, true)`); joined ranges (`iterChangedRanges`) give the map
 * of the joined replacement instead, which differs at touching changes.
 *
 * `limit` stops composing once the result holds more than `limit` pieces and
 * returns `null`: pieces are only appended or widened, so the finished map
 * would hold more too, and a capped caller need not build it.
 */
export function composePieces(pieces: readonly Piece[], changes: readonly Section[], assoc: number): Piece[];
export function composePieces(pieces: readonly Piece[], changes: readonly Section[], assoc: number, limit: number): Piece[] | null;
export function composePieces(pieces: readonly Piece[], changes: readonly Section[], assoc: number, limit = Infinity): Piece[] | null {
  if (changes.every(isNoop)) return pieces.length > limit ? null : [...pieces];
  const out: Piece[] = [];
  for (const piece of pieces) {
    composePiece(out, piece, changes, assoc, limit);
    if (out.length > limit) return null;
  }
  return out;
}
