/**
 * Block map — one WYSIWYG window's bounded breaks: the anchored Markdown
 * (base) against the flushed one (head), certified block by block.
 *
 * Key decisions:
 *   - A base interval is certified only when every block in it paired on the
 *     ProseMirror side (pmCorrespondence.ts), its span text is identical in
 *     both images, and every separator inside it lies between two paired
 *     blocks adjacent in both documents and is itself identical. Everything
 *     else — touched blocks, the separators beside them, unchanged blocks
 *     whose serialization changed (neighbour dependencies, global passes) —
 *     is a bounded break, named by why it broke.
 *   - Head and tail text join a run only at the document edge.
 *   - A touched block with no characters of its own (the empty paragraph of
 *     an empty document) is a zero-width break at its position: a gap of no
 *     width is skipped only when no unpaired block sits in it, so a net-zero
 *     edit there is never an identity.
 *   - The segments must tile both images and certified text must be
 *     identical, or there is no bounded map (the caller breaks the whole
 *     document).
 *
 * @coordinates-with services/agentJournal/collectors/wysiwyg/pmCorrespondence.ts — the pairs
 * @coordinates-with utils/markdownPipeline/serializerSpans.ts — the spans
 * @coordinates-with services/agentJournal/provenance/window.ts — the ranges it returns
 * @module services/agentJournal/collectors/wysiwyg/blockMap
 */

import type { BlockSpan } from "@/utils/markdownPipeline/serializerSpans";
import type { DeferredRange } from "../../provenance/session";
import type { BlockPairs } from "./pmCorrespondence";

export interface SpannedText {
  readonly markdown: string;
  readonly spans: readonly BlockSpan[];
}

type BreakReason = "pm-touched" | "pm-inserted" | "pm-removed" | "separator" | "serialization-changed";

type Segment =
  | { kind: "certified"; from: number; to: number; delta: number }
  | { kind: "break"; from: number; to: number; postFrom: number; postTo: number; reasons: BreakReason[] };

interface Run {
  from: number;
  to: number;
  delta: number;
  firstPair: number;
  lastPair: number;
}

const empty = (s: BlockSpan) => s.from === s.to;

/** Indices of the non-empty spans overlapping [from, to); spans ascend. */
function overlapping(spans: readonly BlockSpan[], from: number, to: number): number[] {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].to <= from) lo = mid + 1;
    else hi = mid;
  }
  const out: number[] = [];
  for (let i = lo; i < spans.length && spans[i].from < to; i++) if (!empty(spans[i])) out.push(i);
  return out;
}

/** Indices of the empty spans at `at`; spans ascend. */
function emptyAt(spans: readonly BlockSpan[], at: number): number[] {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].to < at) lo = mid + 1;
    else hi = mid;
  }
  const out: number[] = [];
  for (let i = lo; i < spans.length && spans[i].from <= at; i++) if (spans[i].from === at && empty(spans[i])) out.push(i);
  return out;
}

interface Pairing {
  paired0: ReadonlySet<number>;
  paired1: ReadonlySet<number>;
  changed0: ReadonlySet<number>;
  changed1: ReadonlySet<number>;
}

/** Why a gap broke; `[]` for a gap of no width that no unpaired block sits in (nothing to break). */
function reasonsFor(gap: { from: number; to: number; postFrom: number; postTo: number }, sp0: readonly BlockSpan[], sp1: readonly BlockSpan[], p: Pairing): BreakReason[] {
  const reasons = new Set<BreakReason>();
  if (gap.from === gap.to && gap.postFrom === gap.postTo) {
    // @edge-case A touched empty block has no width; it still broke.
    if (emptyAt(sp0, gap.from).some((i) => !p.paired0.has(i))) reasons.add("pm-removed");
    if (emptyAt(sp1, gap.postFrom).some((i) => !p.paired1.has(i))) reasons.add("pm-inserted");
    if (reasons.size === 2) return ["pm-touched"];
    return [...reasons];
  }
  for (const i of overlapping(sp0, gap.from, gap.to)) {
    if (p.changed0.has(i)) reasons.add("serialization-changed");
    else if (!p.paired0.has(i)) reasons.add("pm-removed");
  }
  for (const i of overlapping(sp1, gap.postFrom, gap.postTo)) if (!p.paired1.has(i) && !p.changed1.has(i)) reasons.add("pm-inserted");
  if (reasons.has("pm-removed") && reasons.has("pm-inserted")) {
    reasons.delete("pm-removed");
    reasons.delete("pm-inserted");
    reasons.add("pm-touched");
  }
  if (reasons.size === 0) reasons.add("separator");
  return [...reasons];
}

function runsOf(base: SpannedText, head: SpannedText, pairs: BlockPairs): Run[] {
  const { markdown: md0, spans: sp0 } = base;
  const { markdown: md1, spans: sp1 } = head;
  const runs: Run[] = [];
  pairs.forEach(([a, b], k) => {
    if (empty(sp0[a])) return; // no position of its own: adjacency glue only
    const delta = sp1[b].from - sp0[a].from;
    const last = runs[runs.length - 1];
    if (last) {
      const [pa, pb] = pairs[last.lastPair];
      const between = k - last.lastPair - 1;
      const glued = between === a - pa - 1 && between === b - pb - 1;
      const sepSame = md0.slice(sp0[pa].to, sp0[a].from) === md1.slice(sp1[pb].to, sp1[b].from);
      if (glued && sepSame && delta === last.delta) {
        last.to = sp0[a].to;
        last.lastPair = k;
        return;
      }
    }
    runs.push({ from: sp0[a].from, to: sp0[a].to, delta, firstPair: k, lastPair: k });
  });
  const first = runs[0];
  if (first) {
    const [a, b] = pairs[first.firstPair];
    if (first.firstPair === a && first.firstPair === b && md0.slice(0, sp0[a].from) === md1.slice(0, sp1[b].from)) first.from = 0;
  }
  const last = runs[runs.length - 1];
  if (last) {
    const [a, b] = pairs[last.lastPair];
    const after = pairs.length - 1 - last.lastPair;
    if (after === sp0.length - 1 - a && after === sp1.length - 1 - b && md0.slice(sp0[a].to) === md1.slice(sp1[b].to)) last.to = md0.length;
  }
  return runs;
}

function segmentsOf(base: SpannedText, head: SpannedText, pmPairs: BlockPairs): Segment[] {
  const textOf = (t: SpannedText, i: number) => t.markdown.slice(t.spans[i].from, t.spans[i].to);
  const pairs: (readonly [number, number])[] = [];
  const changed0 = new Set<number>();
  const changed1 = new Set<number>();
  for (const [a, b] of pmPairs) {
    if (textOf(base, a) === textOf(head, b)) pairs.push([a, b]);
    else {
      changed0.add(a);
      changed1.add(b);
    }
  }
  const pairing: Pairing = { paired0: new Set(pairs.map(([a]) => a)), paired1: new Set(pairs.map(([, b]) => b)), changed0, changed1 };
  const segments: Segment[] = [];
  let cursor = 0;
  let postCursor = 0;
  const pushBreak = (to: number, postTo: number) => {
    const gap = { from: cursor, to, postFrom: postCursor, postTo };
    const reasons = reasonsFor(gap, base.spans, head.spans, pairing);
    if (reasons.length > 0) segments.push({ kind: "break", ...gap, reasons });
  };
  for (const run of runsOf(base, head, pairs)) {
    pushBreak(run.from, run.from + run.delta);
    segments.push({ kind: "certified", from: run.from, to: run.to, delta: run.delta });
    cursor = run.to;
    postCursor = run.to + run.delta;
  }
  pushBreak(base.markdown.length, head.markdown.length);
  return segments;
}

/** Tiling of both images and certified text identity; the first violation, or null. */
function violation(segments: readonly Segment[], md0: string, md1: string): string | null {
  let pre = 0;
  let post = 0;
  for (const seg of segments) {
    if (seg.from !== pre) return `pre-image gap at ${pre}`;
    if (seg.kind === "certified") {
      if (seg.from + seg.delta !== post || seg.to <= seg.from) return `certified segment misplaced at ${seg.from}`;
      if (md0.slice(seg.from, seg.to) !== md1.slice(post, seg.to + seg.delta)) return `certified text differs at ${seg.from}`;
      post = seg.to + seg.delta;
    } else {
      if (seg.postFrom !== post || seg.postTo < seg.postFrom || seg.to < seg.from) return `break misplaced at ${seg.from}`;
      post = seg.postTo;
    }
    pre = seg.to;
  }
  return pre === md0.length && post === md1.length ? null : "segments do not cover both images";
}

/** The bounded breaks turning `base` into `head` (base coordinates, ascending), or why there are none. */
export function blockRanges(base: SpannedText, head: SpannedText, pmPairs: BlockPairs, origin: string): DeferredRange[] | { problem: string } {
  const segments = segmentsOf(base, head, pmPairs);
  const problem = violation(segments, base.markdown, head.markdown);
  if (problem) return { problem };
  const ranges: DeferredRange[] = [];
  for (const s of segments) {
    if (s.kind === "break") ranges.push({ from: s.from, to: s.to, insert: s.postTo - s.postFrom, origin: `${origin}:${s.reasons.join("+")}` });
  }
  return ranges;
}
