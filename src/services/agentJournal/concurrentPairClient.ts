/**
 * Concurrent pair client — reads both pairs of a revision edited in two
 * windows (`agent_journal_concurrent_pair`): what the saving window started
 * from, the version before it in the timeline, and what was saved.
 *
 * Key decisions:
 *   - The reply is checked before it is trusted (`journalIpc.ts`): exactly
 *     three string fields, the empty text allowed. Anything else is a
 *     malformed reply, refused as `JOURNAL_UNAVAILABLE`.
 *   - Every text is present: the journal keeps a live revision's texts and
 *     refuses a lost one (`JOURNAL_CORRUPT`) rather than answer with a gap,
 *     so the caller never has to guess what a missing text means.
 *
 * @coordinates-with src-tauri/src/agent_journal/controller_concurrent_pair.rs — the reply
 * @module services/agentJournal/concurrentPairClient
 */

import { callJournalBound, isObject, malformed } from "./journalIpc";

/** A concurrent revision's texts: observed before → result is the saving window's own change; linear before → result is what review, revert and export see. */
export interface ConcurrentPair {
  /** The text the saving window started from. */
  observedBefore: string;
  /** The text of the revision before it in the timeline. */
  linearBefore: string;
  /** The text that was saved. */
  result: string;
}

const COMMAND = "agent_journal_concurrent_pair";
const FIELDS = ["observedBefore", "linearBefore", "result"] as const;

/** Both pairs of concurrent `revision` of `docKey`. Rejects with a `JournalRefusal`. */
export async function readConcurrentPair(docKey: string, revision: string): Promise<ConcurrentPair> {
  const r = await callJournalBound(COMMAND, { payload: JSON.stringify({ docKey, revision }) });
  if (!isObject(r) || Object.keys(r).length !== FIELDS.length) throw malformed(COMMAND);
  const { observedBefore, linearBefore, result } = r;
  if (typeof observedBefore !== "string" || typeof linearBefore !== "string" || typeof result !== "string") {
    throw malformed(COMMAND);
  }
  return { observedBefore, linearBefore, result };
}
