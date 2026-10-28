/**
 * Ledger engine (test support) — the review ledger's revert path as the
 * writer runs it, over the production TypeScript pieces; `ledgerCheck.ts`
 * holds it to the identity oracle step by step.
 *
 * Its domain is one agent revision followed by human saves and reverts:
 * hunks are pending, conflicted, reverted or resolved, never kept, settled or
 * superseded. Later agent revisions (supersession, rotation breaks) are the
 * Rust `rotation_fuzz` and `review_op_table` tests' domain, keep and settle
 * the `review_restart` tests'.
 *
 * Production pieces: hunks are the canonical diff of base → target (one hunk
 * per changed run); each revision is one capture window composed by the
 * provenance accumulator (`compose`, `breakRange` for an uncertified range,
 * `breakWhole` for a snapshot); spans map through the span mapping the golden
 * fixture pins to the Rust writer. The revert decision is the writer's
 * (`agent_journal/revert_gate.rs` `gate` and `decide`, the refusal of a
 * revert that hits another live hunk in `writer_revert.rs`, the restored span
 * in `span_map.rs`), ported here; `gate` is pinned to the shared
 * `revertGate` vectors by the test.
 */

import { Provenance, type Break } from "../../../provenance/accumulator";
import { mapSpan } from "../../../provenance/__tests__/spanMapping";
import { exactCanonicalDiff } from "../../canonicalDiff";
import type { CertifiedOp, LedgerHunk, Revision } from "./ledgerTypes";

type ItemState = "pending" | "conflicted" | "reverted" | "kept" | "resolvedByHumanEdit";

/** What the gate reads of a hunk. */
export interface GateItem {
  id: string;
  state: ItemState;
  from: number;
  to: number;
  growing: boolean;
  block: Break | null;
}

export interface Item extends GateItem {
  readonly hunk: LedgerHunk;
  edited: boolean;
}

export const hunksOf = (base: string, target: string): LedgerHunk[] =>
  exactCanonicalDiff(base, target).map((c) => ({ ...c, baseText: base.slice(c.fromA, c.toA), targetText: target.slice(c.fromB, c.toB) }));

export const initialItems = (hunks: readonly LedgerHunk[]): Item[] =>
  hunks.map((h, i) => ({ id: `h${i}`, hunk: h, state: "pending", from: h.fromB, to: h.toB, growing: h.targetText === "", block: null, edited: false }));

const REVERTABLE: readonly ItemState[] = ["pending", "conflicted", "reverted"];

/** Steps 1–2: a blocked span, then a deletion anchor sharing its offset with another revertable anchor. */
export function gate(item: GateItem, items: readonly GateItem[]): { code: "AMBIGUOUS_REVERT"; hunk: string; block: Break | null } | null {
  if (item.block) return { code: "AMBIGUOUS_REVERT", hunk: item.id, block: item.block };
  const collides =
    item.growing && items.some((o) => o.id !== item.id && REVERTABLE.includes(o.state) && o.growing && o.from === item.from);
  return collides ? { code: "AMBIGUOUS_REVERT", hunk: item.id, block: null } : null;
}

type Decision = { kind: "apply"; from: number; to: number; insert: string } | { kind: "foundBase" } | { kind: "conflicted" };

const splitsPair = (s: string, p: number) =>
  p > 0 && p < s.length && /[\uD800-\uDBFF]/.test(s[p - 1]) && /[\uDC00-\uDFFF]/.test(s[p]);

/** Steps 3–6 over `current`, with the hunk's texts in their live direction. */
export function decide(span: { from: number; to: number; growing: boolean }, base: string, target: string, current: string): Decision {
  const { from, to } = span;
  if (Math.max(from, to) > current.length || Math.min(from, to) < 0) throw new Error(`span [${from}, ${to}) outside the text`);
  for (const p of [from, to]) if (splitsPair(current, p)) throw new Error(`span offset ${p} falls inside a surrogate pair`);
  if (from > to) return { kind: "conflicted" };
  const here = current.slice(from, to);
  if (here === base) return { kind: "foundBase" };
  if (!span.growing && here !== target) return { kind: "conflicted" };
  return { kind: "apply", from, to: span.growing ? from : to, insert: base };
}

type Mapped = Pick<Item, "from" | "to" | "block" | "edited">;

/** Each item through one window (block and edited are sticky), and whether the window hit it unblocked. */
function mapThrough(items: readonly Item[], P: Provenance): Map<Item, { next: Mapped; hit: boolean }> {
  const out = new Map<Item, { next: Mapped; hit: boolean }>();
  for (const it of items) {
    const m = mapSpan(P, it);
    const block = it.block ?? m.block;
    out.set(it, { next: { from: m.span.from, to: m.span.to, block, edited: it.edited || m.edited }, hit: !block && m.hit });
  }
  return out;
}

function windowOf(text: string, revision: Revision): { text: string; P: Provenance } {
  const P = new Provenance(text.length);
  if (typeof revision === "string") return { text: revision, P: P.breakWhole(revision.length, "snapshotOnly", "snapshot") };
  for (const op of revision) {
    const uncertified = !Array.isArray(op);
    const [from, to, insert] = uncertified ? (op as { uncertified: CertifiedOp }).uncertified : (op as CertifiedOp);
    if (uncertified) P.breakRange(from, to, insert.length, "uncertifiedRange", "probe");
    else P.compose([{ fromA: from, toA: to, fromB: from, toB: from + insert.length }]);
    text = text.slice(0, from) + insert + text.slice(to);
  }
  return { text, P };
}

/**
 * Human saves: each revision's window maps every span; an unblocked active
 * hunk the window hit whose live text is its base text is resolved by the
 * human edit (the capture transition). Returns the final text.
 */
export function mapRevisions(items: Item[], text: string, revisions: readonly Revision[]): string {
  for (const rev of revisions) {
    const w = windowOf(text, rev);
    text = w.text;
    for (const [it, { next, hit }] of mapThrough(items, w.P)) {
      Object.assign(it, next);
      const active = it.state === "pending" || it.state === "conflicted";
      if (active && hit && it.from <= it.to && text.slice(it.from, it.to) === it.hunk.baseText) it.state = "resolvedByHumanEdit";
    }
  }
  return text;
}

type RevertStatus = "applied" | "foundBase" | "conflicted" | "refused" | "ambiguous";
export type RevertResult = { status: "applied"; text: string; from: number } | { status: Exclude<RevertStatus, "applied">; text: string };

/**
 * One revert, as the writer admits and applies it. The content changes only
 * on `applied`. A revert that does not apply records the decision
 * `review_rules.rs` `decision_target` allows from the hunk's state —
 * found base from pending or conflicted resolves it, a conflict from pending
 * marks it conflicted — and anything else records nothing (`refused`).
 */
export function revertOne(item: Item, items: Item[], current: string): RevertResult {
  if (gate(item, items)) return { status: "ambiguous", text: current };
  const [base, target] = item.state === "reverted" ? [item.hunk.targetText, item.hunk.baseText] : [item.hunk.baseText, item.hunk.targetText];
  const d = decide(item, base, target, current);
  if (d.kind === "apply") {
    const P = new Provenance(current.length).compose([{ fromA: d.from, toA: d.to, fromB: d.from, toB: d.from + d.insert.length }]);
    const mapped = mapThrough(items.filter((o) => o !== item), P);
    // A revert that would edit another live hunk is conflicted (`writer_revert.rs` `revert_effects`).
    if (![...mapped.values()].some((m) => m.hit)) {
      for (const [o, { next }] of mapped) Object.assign(o, next);
      const restored = { from: d.from, to: d.from + d.insert.length };
      Object.assign(item, restored, { growing: restored.from === restored.to, block: null, state: item.state === "reverted" ? "pending" : "reverted" });
      return { status: "applied", text: current.slice(0, d.from) + d.insert + current.slice(d.to), from: d.from };
    }
  }
  if (d.kind === "foundBase" && (item.state === "pending" || item.state === "conflicted")) {
    item.state = "resolvedByHumanEdit";
    return { status: "foundBase", text: current };
  }
  if (d.kind !== "foundBase" && item.state === "pending") {
    item.state = "conflicted";
    return { status: "conflicted", text: current };
  }
  return { status: "refused", text: current };
}

