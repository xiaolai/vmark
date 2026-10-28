/**
 * Span serializer — production's Markdown for a ProseMirror document plus
 * the span of every top-level block in it, so an edit inside some blocks
 * can be certified as a change of their text alone.
 *
 * Pipeline: each top-level child → `proseMirrorToMdast` alone, its mdast
 * nodes tagged with the child's index → `prepareMdastForStringify` → the
 * production processor with a recording root handler → the recorded pieces
 * rebuilt into the container output → `finishSerialization` → spans shifted
 * through the cosmetic pass's edits.
 *
 * Key decisions:
 *   - Fidelity is checked, not assumed: the rebuilt container output must
 *     equal what the root handler returned, and the final string must equal
 *     the reference (production's `serializeMarkdown` output) byte for byte,
 *     or there are no spans.
 *   - The root handler runs the stock `containerFlow` and only records each
 *     root child's output and the pieces its position tracker is moved over
 *     (outputs and separators): the separators are captured as emitted, not
 *     re-derived from the join functions' results.
 *   - Every cosmetic edit must lie inside one block's span; the leading-rule
 *     swap keeps every offset.
 *   - Budget: a document whose canonical Markdown is over
 *     `SPAN_SERIALIZE_LIMIT` characters is not serialized a second time; it has
 *     no spans. The node size is only a cheap first gate (it skips even the
 *     reference serialization of a huge document): it excludes attributes, so
 *     a tiny document with a multi-megabyte image URL or link href passes it.
 *   - A block that produced no mdast node gets a zero-width span where the
 *     previous block ended.
 *
 * @coordinates-with serializer.ts — the processor and the steps it shares
 * @coordinates-with serializerCosmetics.ts — the edits spans are shifted through
 * @coordinates-with services/agentJournal/collectors/wysiwyg/wysiwygCollector.ts — the caller
 * @module utils/markdownPipeline/serializerSpans
 */

import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { Root, RootContent } from "mdast";
import { serializeMarkdown } from "./adapter";
import { proseMirrorToMdast } from "./proseMirrorToMdast";
import type { HardBreakSpelling } from "./serializerBreak";
import type { CosmeticEdit } from "./serializerCosmetics";
import { createSerializerProcessor, finishSerialization, prepareMdastForStringify } from "./serializer";
import type { MarkdownPipelineOptions } from "./types";

/** Largest document given spans: its canonical Markdown length (and, first, its ProseMirror content size). */
export const SPAN_SERIALIZE_LIMIT = 1_000_000;

/** Final-string span of one top-level block. */
export interface BlockSpan {
  readonly from: number;
  readonly to: number;
}

export type SpanSerialization =
  | { ok: true; markdown: string; spans: readonly BlockSpan[] }
  | { ok: false; reason: string };

// The slice of mdast-util-to-markdown's State this file touches.
type Handle = ((node: unknown, parent: unknown, state: State, info: unknown) => string) & Record<string, unknown>;
interface Tracker {
  move(value: string): string;
}
interface State {
  handle: Handle;
  createTracker(info: unknown): Tracker;
  containerFlow(node: Root, info: unknown): string;
}
type Tagged = { data?: Record<string, unknown> };

interface Recording {
  /** Each root child's output, in order. */
  outputs: { tag: number; out: string }[];
  /** Every piece the root's container flow emitted: outputs and separators, alternating. */
  pieces: string[];
  container: string | null;
}
let active: Recording | null = null;

const TAG = "vmarkPmBlock";

function tagOf(node: RootContent): number {
  const tag = (node as Tagged).data?.[TAG];
  if (typeof tag !== "number") throw new Error(`root child ${node.type} lost its block tag`);
  return tag;
}

/**
 * Records the root's stock `containerFlow`: each root child's output, and
 * every piece the flow emits through its position tracker (the children's
 * outputs and the separators between them), so the separators are the ones
 * the dependency chose, never re-derived here. The tracker is the first one
 * the flow creates; nested containers create their own and are untouched.
 */
function recordingRoot(node: Root, _parent: unknown, state: State, info: unknown): string {
  const rec = active;
  if (!rec) throw new Error("the span root handler ran outside a recording");
  const handle = state.handle;
  const createTracker = state.createTracker;
  const recording = function (this: unknown, child: unknown, parent: unknown, s: State, i: unknown) {
    const out = handle.call(this, child, parent, s, i);
    if (parent === node) rec.outputs.push({ tag: tagOf(child as RootContent), out });
    return out;
  };
  // `state.handle` is a zwitch whose properties phrasing peeks read: keep them.
  state.handle = Object.assign(recording, handle);
  state.createTracker = function (this: unknown, trackerInfo: unknown) {
    state.createTracker = createTracker;
    const tracker = createTracker.call(this, trackerInfo);
    const move = tracker.move;
    tracker.move = (value) => {
      rec.pieces.push(value);
      return move.call(tracker, value);
    };
    return tracker;
  };
  try {
    rec.container = state.containerFlow(node, info);
    return rec.container;
  } finally {
    state.handle = handle;
    state.createTracker = createTracker;
  }
}

const processors = new Map<HardBreakSpelling, ReturnType<typeof createSerializerProcessor>>();
function processorFor(spelling: HardBreakSpelling) {
  let p = processors.get(spelling);
  if (!p) processors.set(spelling, (p = createSerializerProcessor(spelling, recordingRoot)));
  return p;
}

function taggedRoot(schema: Schema, doc: PMNode, opts: MarkdownPipelineOptions): Root {
  const children: RootContent[] = [];
  doc.forEach((child, _offset, index) => {
    const one = proseMirrorToMdast(schema, doc.type.create(doc.attrs, child), { preserveBlankLines: opts.preserveBlankLines });
    for (const n of one.children) {
      (n as Tagged).data = { ...(n as Tagged).data, [TAG]: index };
      children.push(n);
    }
  });
  return { type: "root", children };
}

function record(root: Root, spelling: HardBreakSpelling): { rec: Recording; raw: string } {
  const rec: Recording = { outputs: [], pieces: [], container: null };
  active = rec;
  try {
    return { rec, raw: String(processorFor(spelling).stringify(root)) };
  } finally {
    active = null;
  }
}

/**
 * Raw spans per block (its mdast nodes are consecutive), or why there are
 * none. The recorded pieces must alternate each child's output with one
 * separator and concatenate to the container output, or the flow was not
 * observed as assumed and there are no spans.
 */
function blockSpans(rec: Recording): { tag: number; from: number; to: number }[] | string {
  const { outputs, pieces, container } = rec;
  const shapeHolds =
    container !== null &&
    pieces.length === Math.max(0, 2 * outputs.length - 1) &&
    outputs.every(({ out }, k) => pieces[2 * k] === out) &&
    pieces.join("") === container;
  if (!shapeHolds) return "container-decomposition";
  const spans: { tag: number; from: number; to: number }[] = [];
  let at = 0;
  for (let k = 0; k < outputs.length; k++) {
    const { tag, out } = outputs[k];
    const from = at;
    at += out.length + (pieces[2 * k + 1]?.length ?? 0);
    const last = spans[spans.length - 1];
    if (last && last.tag === tag) last.to = from + out.length;
    else if (last && last.tag > tag) return "block-tags-out-of-order";
    else spans.push({ tag, from, to: from + out.length });
  }
  return spans;
}

/** Each cosmetic edit lies inside one span; both lists ascending, one sweep. */
function editsInside(spans: readonly { from: number; to: number }[], edits: readonly CosmeticEdit[]): boolean {
  let k = 0;
  for (const e of edits) {
    while (k < spans.length && spans[k].to < e.end) k++;
    if (k === spans.length || spans[k].from > e.start) return false;
  }
  return true;
}

/** Position in the conservative string → position in the final one; `edits` ascending. */
function shiftThrough(edits: readonly CosmeticEdit[]): (pos: number) => number {
  const cumulative: number[] = [];
  let acc = 0;
  for (const e of edits) cumulative.push((acc += e.replacement.length - (e.end - e.start)));
  return (pos) => {
    let lo = 0;
    let hi = edits.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (edits[mid].end <= pos) lo = mid + 1;
      else hi = mid;
    }
    return pos + (lo === 0 ? 0 : cumulative[lo - 1]);
  };
}

/** `reference` is production's output when the caller already has it; it is what fidelity is checked against. */
export function serializeWithSpans(schema: Schema, doc: PMNode, opts: MarkdownPipelineOptions, reference?: string): SpanSerialization {
  if (doc.content.size > SPAN_SERIALIZE_LIMIT) return { ok: false, reason: "size-budget" };
  try {
    const expected = reference ?? serializeMarkdown(schema, doc, opts);
    if (expected.length > SPAN_SERIALIZE_LIMIT) return { ok: false, reason: "size-budget" };
    const tagged = taggedRoot(schema, doc, opts);
    const prepared = prepareMdastForStringify(tagged);
    if (prepared.children.map(tagOf).join() !== tagged.children.map(tagOf).join()) return { ok: false, reason: "transform-regrouped" };
    const { rec, raw } = record(prepared, opts.hardBreakStyle ?? "backslash");
    const raws = blockSpans(rec);
    if (typeof raws === "string") return { ok: false, reason: raws };
    if (raw !== rec.container && raw !== `${rec.container}\n`) return { ok: false, reason: "root-finalization" };
    const finished = finishSerialization(tagged.children[0]?.type === "thematicBreak", raw);
    if (finished.text !== expected) return { ok: false, reason: "fidelity: span output differs from production" };
    const edits = [...finished.edits].sort((x, y) => x.start - y.start);
    if (!editsInside(raws, edits)) return { ok: false, reason: "cosmetic-edit-outside-block" };
    const shift = shiftThrough(edits);
    const byTag = new Map(raws.map((b) => [b.tag, b]));
    const spans: BlockSpan[] = [];
    let cursor = 0;
    for (let i = 0; i < doc.childCount; i++) {
      const b = byTag.get(i);
      if (b) {
        spans.push({ from: shift(b.from), to: shift(b.to) });
        cursor = shift(b.to);
      } else spans.push({ from: cursor, to: cursor });
    }
    return { ok: true, markdown: expected, spans };
  } catch (error) {
    return { ok: false, reason: `span-serialize: ${error instanceof Error ? error.message : String(error)}` };
  }
}
