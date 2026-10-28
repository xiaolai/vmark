/**
 * Ledger oracle types (test support) — the shapes the oracle, the corpus and
 * the engine stand-in share.
 *
 * A revision is one capture window: an operation list, each operation one
 * certified single-change transaction over the text the previous one
 * produced, `[from, to, insert]` in UTF-16 units; `{ uncertified: [...] }` is
 * a range its source could not certify (a bounded break). A string is a
 * snapshot-only update: the new text with no history (a whole-document break).
 */

export type CertifiedOp = readonly [number, number, string];
export type Op = CertifiedOp | { readonly uncertified: CertifiedOp };
export type Revision = readonly Op[] | string;

/** One agent hunk: a canonical change of base → target with both texts. */
export interface LedgerHunk {
  readonly fromA: number;
  readonly toA: number;
  readonly fromB: number;
  readonly toB: number;
  readonly baseText: string;
  readonly targetText: string;
}
