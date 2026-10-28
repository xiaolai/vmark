/**
 * Save move — the Save As half of a recorded save: which key the tab's
 * journal document moves from, and the bind that moves it before the
 * capture is sent (ADR-AL7).
 *
 * Key decisions:
 *   - The move starts where the journal holds the tab's document: the key
 *     the tab held, or — while a bind to it runs or after one failed — that
 *     bind's origin (`journalBindOrigin`), which still holds the tab's basis.
 *     So a save after a failed Save As retries the bind from the original
 *     source, and a Save As onward from an unbound key binds that source.
 *   - Only a Save As the tab still holds the destination of moves it: of two
 *     in flight at once the later submission owns the tab
 *     (`saveTargetClaim.ts`), and the earlier wrote a copy.
 *   - Fail closed: the move answers the bind's refusal, and the caller sends
 *     no capture. The basis moves only once the bind landed.
 *
 * @coordinates-with services/agentJournal/saveJournal.ts — the caller
 * @coordinates-with services/agentJournal/documentBinding.ts — the bind and its origin
 * @module services/agentJournal/saveMove
 */

import { useDocumentStore } from "@/stores/documentStore";
import { bindJournalDocument, journalBindOrigin, journalDocumentReady, type JournalBindResult } from "./documentBinding";
import { carryJournalBasis, docKeyFor, isJournalTabLive, journalKeyNow } from "./documentIdentity";

/** The tab's key now, or `null` once it is closed. */
function heldKey(tabId: string, windowLabel: string): string | null {
  const doc = useDocumentStore.getState().getDocument(tabId);
  return doc ? docKeyFor({ tabId, filePath: doc.filePath }, windowLabel) : null;
}

/** The key tab `tabId`'s document moves from in a save to `docKey`, or `null` when it does not move. */
export function movedFrom(tabId: string, docKey: string, windowLabel: string): string | null {
  const held = heldKey(tabId, windowLabel);
  const from = held === null || held === docKey ? null : held;
  const origin = journalBindOrigin(from ?? docKey);
  // @edge-case The tab's state is still at the origin (the bind has not
  // landed): the save moves it from there.
  if (origin !== null && origin !== docKey && journalKeyNow(tabId, origin) === origin) return origin;
  return from;
}

/**
 * Move the tab's document from `from` to `docKey` when the tab holds
 * `docKey`; answers whether the journal holds its document at `docKey`.
 * The move starts where the tab's state for `from` is now, which an earlier
 * move or the session sync may have carried.
 */
export async function moveForSave(
  move: { tabId: string; docKey: string; from: string | null; life: number },
  windowLabel: string,
): Promise<JournalBindResult> {
  const { tabId, docKey, from, life } = move;
  if (from === null || heldKey(tabId, windowLabel) !== docKey) return journalDocumentReady(docKey);
  const source = journalKeyNow(tabId, from);
  if (source === docKey) return journalDocumentReady(docKey);
  const bound = await bindJournalDocument(source, docKey);
  if (bound.ok && isJournalTabLive(tabId, life) && journalKeyNow(tabId, source) === source) {
    carryJournalBasis(tabId, source, docKey);
  }
  return bound;
}
