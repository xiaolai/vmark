/**
 * Unsaved provenance — the explicit point where a tab's provenance source
 * (its `ProvenanceSession`, through `provenanceSessions.ts`) hands the
 * journal what the tab's editors certified since its journaled text.
 *
 * Key decisions:
 *   - A save or a controlled write FREEZES the open window at the exact
 *     buffer it records; the freeze names the payload for the basis the
 *     caller declares, and is told what the journal did with it
 *     (`recorded(id)` / `invalidate()`), so the next window starts on a
 *     known record or is never certified (fail closed).
 *   - A controlled write's apply FORKS the session onto the applied text:
 *     the agent's own change is never certified as a person's.
 *   - With no source registered both answer `null`: the journal records a
 *     `snapshotOnly` barrier, and every older live hunk is blocked rather
 *     than mapped through edits nobody certified.
 *   - A source that throws is not swallowed: the write is refused rather
 *     than guessed.
 *
 * @coordinates-with services/agentJournal/provenance/session.ts — freeze and fork
 * @coordinates-with services/agentJournal/saveJournal.ts — freezes a save's buffer
 * @coordinates-with services/agentJournal/journaledMutation.ts — freezes the preimage, forks at the apply
 * @module services/agentJournal/unsavedProvenance
 */

import type { ProvenancePayload } from "./provenance/payload";
import type { ProvenanceFork, ProvenanceFreeze } from "./provenance/session";

/** A provenance payload as the journal's wire carries it (the journal re-validates every field). */
export type JournalProvenancePayload = ProvenancePayload;

export interface UnsavedProvenanceSource {
  freeze(buffer: string): ProvenanceFreeze;
  fork(text: string): ProvenanceFork;
}

const sources = new Map<string, UnsavedProvenanceSource>();

/** Register the source for `tabId`; returns its disposer. */
export function registerUnsavedProvenanceSource(tabId: string, source: UnsavedProvenanceSource): () => void {
  sources.set(tabId, source);
  return () => {
    if (sources.get(tabId) === source) sources.delete(tabId);
  };
}

/** Freeze the tab's open window at `buffer`, or `null` with no source. */
export function freezeUnsavedProvenance(tabId: string, buffer: string): ProvenanceFreeze | null {
  return sources.get(tabId)?.freeze(buffer) ?? null;
}

/** Start the tab's next window on a controlled write's applied text, or `null` with no source. */
export function forkUnsavedProvenance(tabId: string, text: string): ProvenanceFork | null {
  return sources.get(tabId)?.fork(text) ?? null;
}

/** Forget every source. For tests. */
export function resetUnsavedProvenanceSources(): void {
  sources.clear();
}
