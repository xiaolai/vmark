/**
 * Selection certificate — a Source `selection.set`'s exact change, sent with
 * its prepare so the journal can move older hunks through the edit instead
 * of blocking them all behind a whole-document barrier.
 *
 * Key decisions:
 *   - A certificate is a provenance payload without document, epoch and
 *     basis: the window cannot know the parent the journal mints (a baseline
 *     for unsaved text, or the head), so the journal binds those itself and
 *     checks the preimage hash against that parent's text.
 *   - The map is the one change CodeMirror will dispatch, composed exactly
 *     like a collector composes a transaction. It is validated as a full
 *     payload before it leaves (`encodePayload`), so a malformed change is
 *     refused here, never sent.
 *   - The journal checks it again at commit against the applied text; a
 *     certificate that does not reproduce it falls back to the barrier.
 *   - `certificateOf` is shared with the WYSIWYG post-apply certificate:
 *     both check that the map carries every surviving character to the same
 *     unit of the postimage before anything is sent.
 *
 * @coordinates-with src-tauri/src/agent_journal/certificate.rs — binds and checks it
 * @coordinates-with services/mcpBridge/v2/journaledEdit.ts — sends it with the prepare
 * @coordinates-with services/agentJournal/collectors/wysiwyg/wysiwygCertificate.ts — the WYSIWYG one
 * @module services/agentJournal/selectionCertificate
 */

import { Provenance } from "./provenance/accumulator";
import { encodePayload, type ProvenancePayload } from "./provenance/payload";

/** One replacement of `[from, to)` of the preimage by `insert`, in UTF-16 code units. */
export interface ExactChange {
  from: number;
  to: number;
  insert: string;
}

/** A provenance payload the journal has yet to bind to a document, epoch and parent. */
export type SelectionCertificate = Omit<ProvenancePayload, "document" | "epoch" | "basis">;

/** Placeholders for the fields the journal binds; stripped before sending. */
const UNBOUND = { document: "unbound", epoch: "0", basis: "unbound" };

/** `provenance`, which maps `pre` to `post`, as a certificate. Throws when it does not, or on malformed text. */
export async function certificateOf(pre: string, post: string, provenance: Provenance): Promise<SelectionCertificate> {
  provenance.checkTexts(pre, post);
  const { document: _d, epoch: _e, basis: _b, ...certificate } = await encodePayload({ ...UNBOUND, pre, post, provenance });
  return certificate;
}

/** The certificate of `change` applied to `pre`. Throws on a change outside `pre` or malformed text. */
export async function selectionCertificate(pre: string, { from, to, insert }: ExactChange): Promise<SelectionCertificate> {
  const post = pre.slice(0, from) + insert + pre.slice(to);
  const provenance = new Provenance(pre.length).compose([{ fromA: from, toA: to, fromB: from, toB: from + insert.length }]);
  return certificateOf(pre, post, provenance);
}
