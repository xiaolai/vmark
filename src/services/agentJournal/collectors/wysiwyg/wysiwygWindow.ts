/**
 * WYSIWYG window — what one or more consecutive flushes of an editor claim
 * between the anchored document and the last flushed one, held until the
 * session materializes it against its base text.
 *
 * Pipeline: each flush `extendWindow`s the pending window with the edges the
 * ledger chained (or a whole-document reason) → the session runs
 * `materializeWindow(base text)` → the base and head documents are
 * serialized with spans → their blocks are paired → bounded ranges.
 *
 * Key decisions:
 *   - Fail closed: no anchor, a collector that does not hold the session's
 *     text, an unobserved transaction, an unknown step, a base document that
 *     does not serialize to the session's base text, spans that cannot be
 *     certified, or a map that does not tile — each is one whole-document
 *     break whose origin says which.
 *   - A window that holds steps names at least one break: when the block map
 *     names none (a net-zero edit that touched no block, only a position
 *     between two), nothing locates it and the window is a whole break
 *     (`unlocated-steps`), never an identity.
 *   - Budgets: the edges a window retains across flushes are bounded by
 *     `MAX_WINDOW_STEPS` step maps, the serializer's size budget bounds what
 *     is serialized again, and the correspondence's range-mapping budget
 *     bounds pairing the blocks; past any of them the window is a
 *     `capOverflow`.
 *   - The head's spans are kept for the next window, so a document is
 *     serialized with spans once per window, not twice.
 *
 * @coordinates-with services/agentJournal/collectors/wysiwyg/wysiwygCollector.ts — the owner
 * @coordinates-with services/agentJournal/collectors/wysiwyg/blockMap.ts — the ranges
 * @module services/agentJournal/collectors/wysiwyg/wysiwygWindow
 */

import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { serializeWithSpans, type SpanSerialization } from "@/utils/markdownPipeline/serializerSpans";
import type { MarkdownPipelineOptions } from "@/utils/markdownPipeline/types";
import type { DeferredOutcome } from "../../provenance/session";
import { blockRanges } from "./blockMap";
import { correspond } from "./pmCorrespondence";
import { MAX_RETAINED_STEPS, type ChainResult, type Edge } from "./txnLedger";

/** Most step maps one window retains across flushes. */
export const MAX_WINDOW_STEPS = MAX_RETAINED_STEPS;

export const WYSIWYG_ORIGIN = "wysiwyg";

export type WholeReason = "no-certificate" | "unobserved-transaction" | "chain-cap" | "window-budget";

/** A document and, once known, its spans under some options. */
export interface Spanned {
  readonly doc: PMNode;
  spans: { key: string; result: SpanSerialization } | null;
}

export interface PendingWindow {
  readonly from: Spanned;
  readonly edges: readonly Edge[];
  readonly steps: number;
  readonly whole: WholeReason | null;
  readonly head: Spanned;
  readonly headMarkdown: string;
  readonly opts: MarkdownPipelineOptions;
  ran: boolean;
}

const optionsKey = (o: MarkdownPipelineOptions) => JSON.stringify([o.preserveLineBreaks ?? null, o.preserveBlankLines ?? null, o.hardBreakStyle ?? null]);

/** The window after one more flush: `prior` (still pending) extended, or a new one from `from`. */
export function extendWindow(
  prior: PendingWindow | null,
  from: Spanned,
  step: ChainResult | WholeReason,
  head: Spanned,
  headMarkdown: string,
  opts: MarkdownPipelineOptions,
): PendingWindow {
  const start = prior ?? { from, edges: [], steps: 0, whole: null };
  let whole = start.whole ?? (typeof step === "string" ? step : step.ok ? null : step.reason);
  const added = typeof step !== "string" && step.ok ? step.edges : [];
  const steps = start.steps + added.reduce((n, e) => n + e.maps.length, 0);
  if (!whole && steps > MAX_WINDOW_STEPS) whole = "window-budget";
  const edges = whole ? [] : [...start.edges, ...added];
  return { from: start.from, edges, steps: whole ? 0 : steps, whole, head, headMarkdown, opts, ran: false };
}

/** `s`'s spans under `opts` (cached); a `reference` the text must equal is checked on every call, cached or not. */
function spansOf(schema: Schema, s: Spanned, opts: MarkdownPipelineOptions, reference?: string): SpanSerialization {
  const key = optionsKey(opts);
  if (s.spans?.key !== key) s.spans = { key, result: serializeWithSpans(schema, s.doc, opts, reference) };
  const result = s.spans.result;
  if (reference !== undefined && result.ok && result.markdown !== reference) return { ok: false, reason: "fidelity: span output differs from production" };
  return result;
}

const whole = (reason: string, budget = false): DeferredOutcome => ({ whole: budget ? "capOverflow" : "snapshotOnly", origin: `${WYSIWYG_ORIGIN}:${reason}` });

function uncertified(result: SpanSerialization): DeferredOutcome {
  if (result.ok) return null;
  return result.reason === "size-budget" ? whole("size-budget", true) : whole("serializer-uncertified");
}

/** The window's ranges over `baseText`, or the whole-document break it ends in. */
export function materializeWindow(schema: Schema, w: PendingWindow, baseText: string): DeferredOutcome {
  w.ran = true;
  if (w.whole) return whole(w.whole, w.whole === "chain-cap" || w.whole === "window-budget");
  if (w.edges.some((e) => e.unknownSteps.length > 0)) return whole("unknown-step");
  const base = spansOf(schema, w.from, w.opts);
  if (!base.ok) return uncertified(base);
  if (base.markdown !== baseText) return whole("base-mismatch");
  const head = spansOf(schema, w.head, w.opts, w.headMarkdown);
  if (!head.ok) return uncertified(head);
  const pairs = correspond(w.from.doc, w.head.doc, w.edges);
  if (pairs === null) return whole("correspondence-budget", true);
  const out = blockRanges(base, head, pairs, WYSIWYG_ORIGIN);
  if (!Array.isArray(out)) return whole("invariant");
  return out.length === 0 && w.edges.length > 0 ? whole("unlocated-steps") : out;
}
