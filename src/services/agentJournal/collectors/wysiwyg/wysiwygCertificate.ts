/**
 * WYSIWYG apply certificate — the map a WYSIWYG `selection.set` sends with
 * its commit: the window the collector built for the apply's flushes,
 * materialized against the journal's preimage, as a provenance payload the
 * journal binds to the transaction's parent.
 *
 * Key decisions:
 *   - The same materialization as a person's flush (`materializeWindow`):
 *     bounded breaks over the touched blocks, their separators and any
 *     neighbour whose serialization changed, certified block by block
 *     under the production serializer. Block count or type never certifies
 *     anything.
 *   - Fail closed to a whole break, never to no certificate: a window that
 *     ends in a whole break (an unobserved transaction, a capped chain, a
 *     base that does not serialize to the preimage), ranges that do not
 *     turn the preimage into the postimage, or a capture interrupted during
 *     the apply. The journal then records the barrier and reports why
 *     (`wholeBreak`), so every fallback is counted.
 *   - Built after the apply, from immutable ProseMirror documents: nothing
 *     the editor does afterwards changes it.
 *
 * @coordinates-with services/agentJournal/collectors/wysiwyg/wysiwygCollector.ts — the capture
 * @coordinates-with services/agentJournal/collectors/wysiwyg/wysiwygWindow.ts — the materialization
 * @coordinates-with services/agentJournal/selectionCertificate.ts — the certificate shape
 * @module services/agentJournal/collectors/wysiwyg/wysiwygCertificate
 */

import type { Schema } from "@tiptap/pm/model";
import { Provenance } from "../../provenance/accumulator";
import { composeRanges, isDeferredWhole, rangesFit, type DeferredOutcome } from "../../provenance/window";
import { certificateOf, type SelectionCertificate } from "../../selectionCertificate";
import { WYSIWYG_ORIGIN, materializeWindow, type PendingWindow } from "./wysiwygWindow";

/** What the collector saw of one apply: the window its flushes built, or why it cannot be bounded. */
export type WysiwygApplyCapture = { readonly schema: Schema; readonly window: PendingWindow } | { readonly whole: string };

/** The certificate of the captured apply that turned `pre` into `post`. Throws only on malformed text. */
export async function wysiwygApplyCertificate(capture: WysiwygApplyCapture, pre: string, post: string): Promise<SelectionCertificate> {
  const out: DeferredOutcome =
    "whole" in capture ? { whole: "snapshotOnly", origin: capture.whole } : materializeWindow(capture.schema, capture.window, pre);
  const acc = new Provenance(pre.length);
  if (isDeferredWhole(out)) acc.breakWhole(post.length, out.whole, out.origin);
  else if (rangesFit(out, pre, post)) composeRanges(acc, out, WYSIWYG_ORIGIN);
  else acc.breakWhole(post.length, "snapshotOnly", `${WYSIWYG_ORIGIN}:unmatched`);
  return certificateOf(pre, post, acc);
}
