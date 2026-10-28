/**
 * Request ending — the two bounded calls that end what a prepare request
 * opened when its coordinator does not go on to commit: the abort of an
 * open transaction, and the abandon of a request whose fate is unknown.
 *
 * Key decisions:
 *   - Each is bounded by its own deadline, outside the pre-apply budget,
 *     and neither is retried. Whether it landed is not reported: a refused
 *     or queued abort leaves the reservation to the journal's degraded
 *     queue, and an abandon that fails leaves the request to the sweep that
 *     ends a page's transactions.
 *   - The abandon sends the prepare's payload `P` byte for byte, never a
 *     re-serialization: the journal digests it and refuses one that differs.
 *     Its reply is validated (`{state}` from a closed set); a refusal is
 *     validated like a prepare's.
 *   - An abort or abandon answered `STALE_PAGE`, or `staleGeneration` for
 *     the current pair, renews the page's registration (`pageRegistration.ts`).
 *
 * @coordinates-with services/agentJournal/journalRequest.ts — its caller for abandons and late prepares
 * @coordinates-with services/agentJournal/controlledMutation.ts — its caller for aborts
 * @coordinates-with src-tauri/src/agent_journal/commands.rs — `agent_journal_abort`, `agent_journal_abandon`
 * @module services/agentJournal/requestEnding
 */

import { abortControlledWrite, type JournalAbortReason } from "./journalClient";
import { JOURNAL_DEADLINE_MS, withJournalDeadline } from "./journalDeadline";
import { callJournal, isObject } from "./journalIpc";
import { JournalRefusal } from "./journalRefusal";
import type { RequestExpectation } from "./journalSettlement";
import { noteStalePage, type PagePair } from "./pageRegistration";
import { journalWarn } from "@/utils/debug";

const ABANDON = "agent_journal_abandon";
const ABANDON_STATES: readonly string[] = [
  "fenced",
  "aborted",
  "abortQueued",
  "terminalPending",
  "terminal",
  "abandoned",
  "decided",
  "answered",
];

/** Append `aborted` for `txn`, bounded; see the header. */
export async function abortTxn(txn: string, reason: JournalAbortReason, pair: PagePair): Promise<void> {
  try {
    await withJournalDeadline("an abort", () => abortControlledWrite(txn, reason, pair));
  } catch (error) {
    if (!(error instanceof JournalRefusal)) return;
    if (error.journalCode === "JOURNAL_TIMEOUT") {
      journalWarn(`the abort of ${txn} was not answered in time; the document stays reserved until it lands`);
    } else if (error.journalCode === "STALE_PAGE") {
      journalWarn(`the page that prepared ${txn} is no longer registered; its abort was refused`);
      noteStalePage(pair);
    }
  }
}

/** Abandon the request payload `payload` sent, once, bounded; see the header. */
export async function abandonRequest(payload: string, expect: RequestExpectation, pair: PagePair): Promise<void> {
  try {
    const r = await withJournalDeadline("the abandon", () => callJournal(ABANDON, { payload }, expect), JOURNAL_DEADLINE_MS);
    if (!isObject(r) || typeof r.state !== "string" || !ABANDON_STATES.includes(r.state)) {
      journalWarn(`the abandon of request ${expect.requestId} answered a malformed reply:`, r);
    }
  } catch (error) {
    const settlement = error instanceof JournalRefusal ? error.settlement : null;
    if (settlement?.kind === "uncertain" && settlement.cause === "staleGeneration") noteStalePage(pair);
    journalWarn(`the abandon of request ${expect.requestId} was not confirmed:`, error);
  }
}
