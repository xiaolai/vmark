/**
 * Token oracle (test support) — the identity oracle for hunk reverts, which
 * never reads the provenance accumulator, the span mapping or the engine's
 * review states it checks.
 *
 * The text is a token list: UTF-16 units carrying an identity (their offset
 * in the agent's target, the revert that wrote them, or "new") and zero-width
 * boundary markers carrying an affinity. Each operation applies CodeMirror's
 * section rules to the tokens directly (pinned to `ChangeSet.mapPos` by the
 * rules test): on a pure insertion, left-affine markers stay before the new
 * text and right-affine ones after; on a replacement, markers at its start
 * stay before, markers at its end go after, and interior markers split by
 * affinity. A hunk whose live text is non-empty has Rf (right) at its start
 * and Lt (left) at its end, region Rf..Lt; one whose live text is empty (a
 * deletion anchor, or a reverted pure insertion) has Lg (left) and Rg (right),
 * region Lg..Rg. A revert re-places the hunk's markers around the text it
 * wrote, as the writer puts the span on the restored range.
 *
 * From identities alone the oracle knows where each hunk is, whether an
 * uncertified range reached it (closed), whether a revert would touch another
 * hunk (the accumulator's definition of a hit: a replacement deletes its units
 * and touches its interior gaps, an insertion touches its gap; only stacked
 * hunks can meet this way, as a later agent revision over an older one), when a human save resolves a hunk (its region
 * holds its base text, unbroken), what each revert must do, and the exact
 * text it must produce.
 */

import type { LedgerHunk, Op, Revision } from "./ledgerTypes";

type MarkerKind = "Rf" | "Lt" | "Lg" | "Rg";
interface Marker {
  readonly h: number;
  readonly k: MarkerKind;
  readonly left: boolean;
}
type Token = { readonly c: string; readonly id: number | string } | { readonly m: Marker };

const isMarker = (t: Token): t is Extract<Token, { m: Marker }> => "m" in t;

const markers = (h: number, empty: boolean): [Token, Token] =>
  empty
    ? [{ m: { h, k: "Lg", left: true } }, { m: { h, k: "Rg", left: false } }]
    : [{ m: { h, k: "Rf", left: false } }, { m: { h, k: "Lt", left: true } }];

export interface OracleRegion {
  from: number;
  to: number;
  growing: boolean;
  inverted: boolean;
}

export class TokenOracle {
  readonly hunks: readonly LedgerHunk[];
  /** A snapshot revision voided every identity. */
  snapshot = false;
  /** Hunks an uncertified range reached. */
  readonly affected = new Set<number>();
  readonly reverted = new Set<number>();
  /** Hunks a human save or a revert found at their base text. */
  readonly resolved = new Set<number>();
  /** Hunks a refused revert marked conflicted. */
  readonly conflicted = new Set<number>();
  #tokens: Token[] = [];
  #writes = 0;

  constructor(target: string, hunks: readonly LedgerHunk[]) {
    this.hunks = hunks;
    const at = new Map<number, Token[]>();
    const put = (p: number, t: Token) => at.set(p, [...(at.get(p) ?? []), t]);
    hunks.forEach((h, i) => {
      const [start, end] = markers(i, h.targetText === "");
      put(h.fromB, start);
      put(h.toB, end);
    });
    for (let p = 0; p <= target.length; p++) {
      this.#tokens.push(...(at.get(p) ?? []));
      if (p < target.length) this.#tokens.push({ c: target[p], id: p });
    }
  }

  text(): string {
    return this.#tokens.map((t) => (isMarker(t) ? "" : t.c)).join("");
  }

  /** The hunk's live texts: a reverted hunk shows its base and reverts to its target. */
  live(i: number): { base: string; target: string } {
    const h = this.hunks[i];
    return this.reverted.has(i) ? { base: h.targetText, target: h.baseText } : { base: h.baseText, target: h.targetText };
  }

  growing(i: number): boolean {
    return this.#tokens.some((t) => isMarker(t) && t.m.h === i && t.m.k === "Lg");
  }

  #marker(i: number, k: MarkerKind): number {
    const idx = this.#tokens.findIndex((t) => isMarker(t) && t.m.h === i && t.m.k === k);
    if (idx < 0) throw new Error(`oracle lost marker ${k} of hunk ${i}`);
    return idx;
  }

  #at(idx: number): number {
    let x = 0;
    for (let j = 0; j < idx; j++) if (!isMarker(this.#tokens[j])) x++;
    return x;
  }

  pos(i: number, k: MarkerKind): number {
    return this.#at(this.#marker(i, k));
  }

  /** One change, with CodeMirror section rules; returns the index of the first inserted token. */
  change(from: number, to: number, insert: string, id: (k: number) => number | string = () => "new"): number {
    const pre: Token[] = [];
    const post: Token[] = [];
    const insertion = from === to;
    let x = 0;
    for (const t of this.#tokens) {
      if (!isMarker(t)) {
        if (x < from) pre.push(t);
        else if (x >= to) post.push(t);
        x++;
        continue;
      }
      const before = x < from || (x === from && (!insertion || t.m.left)) || (x > from && x < to && t.m.left);
      (before ? pre : post).push(t);
    }
    // One token per UTF-16 unit, like the offsets.
    const fresh = Array.from({ length: insert.length }, (_, k): Token => ({ c: insert[k], id: id(k) }));
    this.#tokens = [...pre, ...fresh, ...post];
    return pre.length;
  }

  applyRevision(revision: Revision): void {
    if (typeof revision === "string") {
      this.snapshot = true;
      return;
    }
    for (const op of revision) this.#apply(op);
    // The capture transition: an active, unbroken hunk whose region holds its base text.
    this.hunks.forEach((_, i) => {
      if (!this.reverted.has(i) && !this.resolved.has(i) && this.foundBase(i)) this.resolved.add(i);
    });
  }

  #apply(op: Op): void {
    if (Array.isArray(op)) {
      this.change(...(op as [number, number, string]));
      return;
    }
    const [x0, x1, insert] = (op as { uncertified: [number, number, string] }).uncertified;
    this.hunks.forEach((_, i) => {
      const r = this.region(i);
      if (r.from <= x1 && r.to >= x0) this.affected.add(i);
    });
    this.change(x0, x1, insert);
  }

  /** The region a revert replaces (live text) or the anchor it inserts at (empty). */
  region(i: number): OracleRegion {
    const g = this.growing(i);
    const a = this.#marker(i, g ? "Lg" : "Rf");
    const b = this.#marker(i, g ? "Rg" : "Lt");
    return { from: this.#at(a), to: this.#at(b), growing: g, inverted: a > b };
  }

  #regionText(i: number): string | null {
    const r = this.region(i);
    return r.inverted ? null : this.text().slice(r.from, r.to);
  }

  #blocked(i: number): boolean {
    return this.snapshot || this.affected.has(i);
  }

  /** Unbroken, and the region holds the live base text. */
  foundBase(i: number): boolean {
    return !this.#blocked(i) && this.#regionText(i) === this.live(i).base;
  }

  #revertable(j: number): boolean {
    return !this.resolved.has(j);
  }

  /** Another revertable empty region shares hunk `i`'s anchor (R16). */
  collides(i: number): boolean {
    if (!this.growing(i)) return false;
    const p = this.pos(i, "Lg");
    return this.hunks.some((_, j) => j !== i && this.#revertable(j) && this.growing(j) && this.pos(j, "Lg") === p);
  }

  /** The revert of `i` would delete a unit of, or touch a gap inside, another unbroken hunk. */
  revertHits(i: number): boolean {
    const r = this.region(i);
    const a = r.from;
    const b = r.growing ? r.from : r.to;
    // A replacement deletes units a..b-1 and touches its interior gaps; an insertion touches gap a.
    const [d0, d1] = b > a ? [a, b - 1] : [1, 0];
    const [g0, g1] = b > a ? [a + 1, b - 1] : [a, a];
    const meets = (x0: number, x1: number, lo: number, hi: number) => x0 <= x1 && lo <= hi && x0 <= hi && x1 >= lo;
    return this.hunks.some((_, j) => {
      if (j === i || this.#blocked(j)) return false;
      const s = this.region(j);
      const lo = Math.min(s.from, s.to);
      const hi = Math.max(s.from, s.to);
      return meets(d0, d1, lo, hi - 1) || (s.growing ? meets(g0, g1, lo, hi) : meets(g0, g1, lo + 1, hi - 1));
    });
  }

  /**
   * What a revert of `i` must do, from the oracle's regions and its own
   * review states: refused as ambiguous when broken or collided; found at
   * its base; conflicted when its region is inverted, holds other text, or
   * its revert would touch another hunk; otherwise applied. A non-applying
   * outcome records a decision only from pending (conflicted) or from an
   * active state (found base); else it is `refused`.
   */
  revertOutcome(i: number): "applied" | "foundBase" | "conflicted" | "refused" | "ambiguous" {
    if (this.#blocked(i) || this.collides(i)) return "ambiguous";
    const active = !this.reverted.has(i) && !this.resolved.has(i);
    if (this.foundBase(i)) return active ? "foundBase" : "refused";
    const here = this.#regionText(i);
    const applies = here !== null && (this.growing(i) || here === this.live(i).target) && !this.revertHits(i);
    if (applies) return "applied";
    return active && !this.conflicted.has(i) ? "conflicted" : "refused";
  }

  /** Records the outcome `revertOutcome` named: the oracle's own state moves, never the engine's. */
  record(i: number, outcome: ReturnType<TokenOracle["revertOutcome"]>): void {
    if (outcome === "applied") this.revert(i);
    else if (outcome === "foundBase") this.resolved.add(i);
    else if (outcome === "conflicted") this.conflicted.add(i);
  }

  /** Applies hunk `i`'s revert at its markers and re-places them on the restored text. */
  revert(i: number): OracleRegion {
    const r = this.region(i);
    const insert = this.live(i).base;
    this.#tokens = this.#tokens.filter((t) => !(isMarker(t) && t.m.h === i));
    const at = this.change(r.from, r.growing ? r.from : r.to, insert, (k) => `r${i}.${this.#writes}.${k}`);
    this.#writes++;
    const [start, end] = markers(i, insert === "");
    this.#tokens.splice(at + insert.length, 0, end);
    this.#tokens.splice(at, 0, start);
    // A revert toggles: reverted ↔ pending (a conflicted hunk returns as pending).
    this.conflicted.delete(i);
    if (this.reverted.has(i)) this.reverted.delete(i);
    else this.reverted.add(i);
    return r;
  }
}
