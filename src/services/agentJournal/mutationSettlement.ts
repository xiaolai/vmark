/**
 * Mutation settlement — what a journaled mutation's controlled outcome
 * settles: the tab's journal basis, the provenance freeze and forks its apply
 * took, and the answer the caller's outcome mapper receives.
 *
 * Key decisions:
 *   - One function decides every settlement from the outcome alone
 *     (`settleControlledOutcome`), so a new outcome status is a type error in
 *     one switch, not a branch that can forget the basis or the freeze.
 *   - The freeze is settled at most once, by whichever settlement comes
 *     first (`release` or `recordFreeze`); `invalidateUnsettled` reaches only
 *     what nothing recorded, and invalidates every fork (a fork already
 *     recorded ignores it — the first settlement wins).
 *   - Settlement returns what to do next — answer, map a decision, or
 *     rethrow — and does not call the mapper, so the coordinator's
 *     `finally` still runs after the mapper, as each caller's answer did.
 *
 * @coordinates-with services/agentJournal/journaledMutation.ts — the coordinator
 * @coordinates-with services/agentJournal/controlledMutation.ts — the outcomes settled
 * @module services/agentJournal/mutationSettlement
 */

import type { AbortReason } from "./journalClient";
import type { ControlledOutcome } from "./controlledMutation";
import type { JournalRefusal } from "./journalRefusal";
import { forkUnsavedProvenance } from "./unsavedProvenance";
import type { ProvenanceFork, ProvenanceFreeze } from "./provenance/session";
import { forgetJournalBasis, isJournalTabLive, rememberJournalBasis } from "./documentIdentity";

/** The settled result the outcome mapper turns into the caller's answer. */
export type JournaledOutcome<T> =
  | { status: "refused"; refusal: JournalRefusal }
  | { status: "aborted"; reason: AbortReason }
  | { status: "applied"; value: T; durable: boolean }
  /** The apply threw after changing the buffer, or the effects hook failed; the applied text was committed. */
  | { status: "appliedWithError"; error: unknown; durable: boolean }
  /** The apply threw and the tab could not be read back; the journal keeps the transaction open. */
  | { status: "recoveryRequired"; error: unknown };

/** The provenance one mutation holds: the tab's freeze and every fork its apply took. */
export class MutationProvenance {
  private readonly forks: ProvenanceFork[] = [];
  private freezeSettled = false;

  constructor(
    private readonly tabId: string,
    readonly freeze: ProvenanceFreeze | null,
  ) {}

  /** Fork the tab's window onto `postimage`, the text the store now holds. */
  fork(postimage: string): void {
    const f = forkUnsavedProvenance(this.tabId, postimage);
    if (f) this.forks.push(f);
  }

  /** Nothing was admitted: give the freeze back. */
  release(): void {
    this.freezeSettled = true;
    this.freeze?.release();
  }

  /** Record the freeze at `head`; with no head it is left to `invalidateUnsettled`. */
  recordFreeze(head: string | null): void {
    if (head === null) return;
    this.freezeSettled = true;
    this.freeze?.recorded(head);
  }

  /** Record every fork at the committed `revision`. */
  recordForks(revision: string): void {
    for (const f of this.forks) f.recorded(revision);
  }

  /** Invalidate whatever no settlement recorded. */
  invalidateUnsettled(): void {
    for (const f of this.forks) f.invalidate();
    if (!this.freezeSettled) this.freeze?.invalidate();
  }
}

/** Records the journal's answer as the tab's basis (`null` forgets it), unless the tab closed since `life`. */
export type BasisSettler = (basis: string | null) => void;

export function basisSettler(tabId: string, docKey: string, life: number): BasisSettler {
  return (basis) => {
    if (!isJournalTabLive(tabId, life)) return;
    if (basis === null) forgetJournalBasis(tabId, docKey);
    else rememberJournalBasis(tabId, docKey, basis);
  };
}

/** What the coordinator does once an outcome is settled. */
export type Settled<T, D> =
  | { next: "answer"; outcome: JournaledOutcome<T> }
  | { next: "decided"; decision: D }
  | { next: "rethrow"; error: unknown };

/** Settle the basis and provenance `outcome` implies, and say what comes next (see the header). */
export function settleControlledOutcome<T, D>(
  outcome: ControlledOutcome<T, D>,
  provenance: MutationProvenance,
  settleBasis: BasisSettler,
): Settled<T, D> {
  switch (outcome.status) {
    case "refused":
      if (outcome.disposition === "release") provenance.release();
      if (outcome.refusal.journalCode === "STALE_PARENT") settleBasis(null);
      return { next: "answer", outcome: { status: "refused", refusal: outcome.refusal } };
    case "decided":
      settleBasis(outcome.head);
      provenance.recordFreeze(outcome.head);
      return { next: "decided", decision: outcome.decision };
    case "recoveryRequired":
      settleBasis(null);
      return { next: "answer", outcome: { status: "recoveryRequired", error: outcome.error } };
    case "aborted":
      settleBasis(outcome.basis);
      provenance.recordFreeze(outcome.basis);
      if (outcome.thrown) return { next: "rethrow", error: outcome.thrown.error };
      return { next: "answer", outcome: { status: "aborted", reason: outcome.reason } };
    case "appliedWithError":
    case "applied": {
      settleBasis(outcome.basis);
      if (outcome.basis === outcome.revision) provenance.recordForks(outcome.revision);
      const settled: JournaledOutcome<T> =
        outcome.status === "applied"
          ? { status: "applied", value: outcome.value, durable: outcome.durable }
          : { status: "appliedWithError", error: outcome.error, durable: outcome.durable };
      return { next: "answer", outcome: settled };
    }
  }
}
