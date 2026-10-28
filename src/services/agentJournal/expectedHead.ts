/**
 * Expected head — the parent a controlled prepare states and the
 * predecessor its frozen provenance names, under the journal's strict
 * compare-and-set: every controlled prepare names the head it expects, and
 * `null` means genesis.
 *
 * Key decisions:
 *   - A tab's journal basis is its expected head. A tab with none (never
 *     journaled, or its basis dropped after a pending save or a
 *     `STALE_PARENT`) reads the head before it writes, so a stale tab is
 *     refused until it re-reads, and a fresh one is never refused for not
 *     having read. The read is bounded by the mutation's pre-apply budget.
 *   - A save of the tab already in flight when the write began is waited for
 *     first: the buffer the write edits contains what that save records, so
 *     a head read before it lands names a parent the save is about to
 *     supersede. A save submitted later is not waited for — it may wait on
 *     this write's send turn, and it chains on this write's basis anyway.
 *   - The payload names its own basis (a revision, an observation, or
 *     `genesis`): it is sent only when that basis is a predecessor the tab
 *     can name as an `observedParent` — genesis, the expected head, or the
 *     tab's own revision or pending save. Ids alone cannot tell a revision
 *     from an observation, so anything else is dropped (fail closed) and
 *     the baseline is recorded as a `snapshotOnly` barrier on the head.
 *
 * @coordinates-with services/agentJournal/journaledMutation.ts — the only caller
 * @coordinates-with services/agentJournal/documentIdentity.ts — the basis and observed base
 * @coordinates-with src-tauri/src/agent_journal/admission/observed_base.rs — where the baseline is recorded
 * @module services/agentJournal/expectedHead
 */

import { readJournalHead } from "./epochClient";
import { journalBasis, journalObservedBase } from "./documentIdentity";
import type { JournalBaseRef } from "./journalClient";
import { JOURNAL_PREAPPLY_BUDGET_MS, journalTimeout, settleWithin, type JournalBudget } from "./journalDeadline";
import { toJournalRefusal, type JournalRefusal } from "./journalRefusal";

/** The parent to send, or why none can be stated (nothing was sent). */
export type ExpectedHead = { parent: string | null } | { refusal: JournalRefusal };

/**
 * The head `tabId` expects for `docKey`: its basis, else the journal's head,
 * read within `budget` — after `inFlight`, the tab's save that was already
 * submitted when the write began, has settled.
 */
export async function expectedHead(
  tabId: string,
  docKey: string,
  budget: JournalBudget,
  inFlight: Promise<unknown> | null,
): Promise<ExpectedHead> {
  if (inFlight && (await settleWithin(inFlight, budget.remaining())) === null) {
    return { refusal: journalTimeout("the tab's save in flight", JOURNAL_PREAPPLY_BUDGET_MS) };
  }
  const basis = journalBasis(tabId, docKey);
  if (basis !== null) return { parent: basis };
  try {
    const read = await settleWithin(readJournalHead(docKey), budget.remaining());
    if (read === null) return { refusal: journalTimeout("the head read", JOURNAL_PREAPPLY_BUDGET_MS) };
    return { parent: read.value };
  } catch (error) {
    return { refusal: toJournalRefusal(error) };
  }
}

/** The predecessor a payload on `basis` was built on, or `null` when the tab cannot name it. */
export function observedParentFor(tabId: string, docKey: string, parent: string | null, basis: string): JournalBaseRef | null {
  if (basis === "genesis") return { ref: "genesis" };
  const observed = journalObservedBase(tabId, docKey);
  if (observed?.ref === "revision" && observed.revision === basis) return observed;
  if (observed?.ref === "pending" && observed.observation === basis) return observed;
  if (basis === parent) return { ref: "revision", revision: basis };
  return null;
}
