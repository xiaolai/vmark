/**
 * Journaled mutation — the one coordinator for changing a tab's buffer as a
 * controlled mutation of the agent edit journal. Its callers (an MCP edit,
 * `mcpBridge/v2/journaledEdit.ts`; a history restore, `historyRestore.ts`)
 * differ only in their adapters: prepare, verify, apply, recover, effects
 * and the outcome mapper.
 *
 * Pipeline: refuse an evicted basis → freeze the tab's unsaved provenance at
 * the preimage (and await its payload, then the caller's `recheck`) → state
 * the expected head and name the payload's predecessor (`expectedHead.ts`)
 * → the caller's prepare → verify → apply, forking the provenance window onto the
 * applied text → effects → commit (`controlledMutation.ts`) → settle the
 * tab's journal basis → settle the freeze and the forks → map the outcome.
 *
 * Key decisions:
 *   - A basis evicted from the bounded identity table refuses STALE_PARENT
 *     before anything is sent: the retry rebases on the journal's head
 *     instead of writing without a compare-and-set.
 *   - Every prepare states the head it expects: the tab's basis, else the
 *     head read as the prepare is built, inside its send turn and after the
 *     document is ready, so a save answered before it is already the head.
 *     A head read that is refused or outlives its deadline refuses with
 *     nothing sent. A payload is sent only with the
 *     predecessor it names (`observedParent`); one the tab cannot name is
 *     dropped, so the baseline is a `snapshotOnly` barrier.
 *   - Basis: a STALE_PARENT refusal, an unreadable apply
 *     (`recoveryRequired`) or a commit refused with no basis drops it;
 *     otherwise the outcome's basis is kept. A tab closed since `life` was
 *     taken (perhaps reopened under the same id) learns nothing.
 *   - Provenance: the apply forks the window in the same synchronous step,
 *     so the mutation's own change is never certified as a person's. Forks
 *     are recorded at the committed revision; an abort records the freeze at
 *     the baseline its prepare recorded; a refusal releases the freeze only
 *     when its disposition says so (the journal proved nothing was
 *     admitted, or nothing was sent: `journalRequest.ts`); anything left
 *     unsettled is invalidated. A caller may supply its own `freeze` (a
 *     hunk revert freezes only an epoch already armed, never arming one).
 *   - An apply that throws is read back through `recover`, never assumed
 *     undone: a changed buffer bumps the tab's MCP revision (the store may
 *     have thrown before its own bump), forks like an applied text, and is
 *     committed (`appliedWithError`); an unchanged one aborts, keeps the
 *     basis, then rethrows the error; an unreadable one stays open
 *     (`recoveryRequired`).
 *   - A commit that fails is still applied, `durable: false`, on the
 *     pre-mutation basis; the journal's degraded queue then refuses the next
 *     mutation until it drains. It is not read back: the applied text is
 *     known.
 *   - The effects hook (optional; absent by default) runs after a successful
 *     apply and before the commit, and what it returns rides on the commit.
 *     It fails LOUD: a hook that throws, or has not settled within
 *     `EFFECTS_DEADLINE_MS`, never skips the commit. The applied text is
 *     committed without extras (the journal records its conservative
 *     barrier) and the outcome is the degraded `appliedWithError`, carrying
 *     the hook's error. It never runs after an abort or a thrown apply.
 *   - A prepare answered with a decision (a hunk revert recorded as a
 *     review decision, `controlledMutation.ts`) changed no text: the tab's
 *     basis becomes the decision's head (the baseline it consumed) and the
 *     freeze is recorded there; with no head both are dropped. The
 *     caller's `decided` adapter maps it; a caller that can be answered a
 *     decision and has none fails loud.
 *   - The outcome mapper runs before the freeze and forks are invalidated,
 *     as each caller's answer did.
 *   - Every await is bounded, so the answer fits the MCP bridge's total
 *     (`journalDeadline.ts`): the pre-apply budget starts before the freeze
 *     payload, and a payload or prepare attempt that outlives it refuses
 *     `JOURNAL_TIMEOUT` with nothing applied; then the effects deadline and
 *     one bounded commit (`controlledMutation.ts`).
 *
 * @coordinates-with services/agentJournal/controlledMutation.ts — the protocol
 * @coordinates-with services/agentJournal/unsavedProvenance.ts — the freeze and fork
 * @coordinates-with services/agentJournal/documentIdentity.ts — the basis
 * @coordinates-with services/agentJournal/expectedHead.ts — the parent and observedParent
 * @coordinates-with services/agentJournal/mutationSettlement.ts — basis, freeze and fork settlement
 * @module services/agentJournal/journaledMutation
 */

import { useRevisionStore } from "@/stores/documentStore";
import type { AbortReason, CommitExtras, DecidedReply, JournalBaseRef, PreparedTxn, PrepareSpec } from "./journalClient";
import { expectedHead, observedParentFor } from "./expectedHead";
import { runPreparedWrite } from "./controlledMutation";
import { JournalRefusal } from "./journalRefusal";
import { JOURNAL_PREAPPLY_BUDGET_MS, journalTimeout, settleWithin, startJournalBudget, type JournalBudget } from "./journalDeadline";
import { freezeUnsavedProvenance, type JournalProvenancePayload } from "./unsavedProvenance";
import type { NamedPayload, ProvenanceFreeze } from "./provenance/session";
import type { CaptureId } from "./provenance/captureId";
import { forgetJournalBasis, isJournalBasisEvicted, outstandingSaveBase } from "./documentIdentity";
import { basisSettler, MutationProvenance, settleControlledOutcome, type JournaledOutcome } from "./mutationSettlement";

/** How long the effects hook may take before the commit goes ahead without it. */
export const EFFECTS_DEADLINE_MS = 5000;

/** What the coordinator hands the caller's prepare: the shared baseline fields. */
interface MutationBaseline {
  docKey: string;
  /** The head the tab expects (its basis, else the head it read); `null` is genesis. */
  parent: string | null;
  preimage: string;
  baselineProvenance: JournalProvenancePayload | null;
  /** The predecessor `baselineProvenance` was built on; absent with no payload. */
  observedParent?: JournalBaseRef;
  baselineTouched: boolean;
  /** The freeze's capture id; absent when the tab has no provenance source. */
  capture?: CaptureId;
}

export type { JournaledOutcome } from "./mutationSettlement";

interface MutationAdapters<T, P extends PreparedTxn, O, D> {
  tabId: string;
  /** The tab's journal lifecycle token, taken before the caller's first await. */
  life: number;
  /** The journal key the mutation is prepared and committed under. */
  docKey: string;
  /** The buffer as the mutation found it. */
  preimage: string;
  /** Ends the evicted-basis refusal's message (`retry`, `re-read and retry`). */
  retryHint: string;
  /** Freezes the tab's provenance at the preimage instead of `freezeUnsavedProvenance` (a hunk revert's never arms). */
  freeze?: (preimage: string) => ProvenanceFreeze | null;
  /** After the provenance payload was awaited: why the tab must not be prepared now, or `null`. */
  recheck?: () => AbortReason | null;
  /** The prepare request (`controlledPrepare`, `restorePrepare`); the coordinator sends it. */
  prepare: (baseline: MutationBaseline) => Promise<PrepareSpec<P | DecidedReply<D>>> | PrepareSpec<P | DecidedReply<D>>;
  /** After the prepare ack, synchronously: why the mutation must not go ahead, or `null`. */
  verify: (prepared: P) => AbortReason | null;
  /** Apply now, synchronously; `postimage` is the text the store then holds. */
  apply: (prepared: P) => { postimage: string; value: T } | { refused: AbortReason };
  /** After an apply that threw: bring the store into agreement and return the tab's text; throw when it cannot be read. */
  recover: () => string;
  /** After a successful apply, before the commit: extra fields for the commit (see the header). */
  effects?: (preimage: string, postimage: string) => Promise<CommitExtras>;
  outcome: (outcome: JournaledOutcome<T>) => O | Promise<O>;
}

/** Maps a decision the journal recorded instead of preparing a write (see the header). */
interface DecidedAdapter<D, O> {
  decided: (decision: D) => O | Promise<O>;
}

/** A tab mutation; one whose prepare can be answered a decision (`D` not `never`) must map it. */
export type JournaledMutation<T, P extends PreparedTxn, O, D = never> = MutationAdapters<T, P, O, D> &
  ([D] extends [never] ? unknown : DecidedAdapter<D, O>);

/** `run()`, or a rejection once `EFFECTS_DEADLINE_MS` passes without it settling. */
function withinEffectsDeadline(run: () => Promise<CommitExtras>): Promise<CommitExtras> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the commit effects did not settle within ${EFFECTS_DEADLINE_MS} ms`)), EFFECTS_DEADLINE_MS);
  });
  const running = new Promise<CommitExtras>((settle) => settle(run()));
  return Promise.race([running, expired]).finally(() => clearTimeout(timer));
}

/**
 * The prepare the coordinator sends, and the parent it stated: read once the
 * prepare is built (see the header). The baseline payload rides only with the
 * predecessor it names.
 */
function preparer<T, P extends PreparedTxn, O, D>(
  m: JournaledMutation<T, P, O, D>,
  budget: JournalBudget,
  inFlightSave: ReturnType<typeof outstandingSaveBase>,
  freeze: ProvenanceFreeze | null,
  named: NamedPayload | null,
): { prepare: () => Promise<PrepareSpec<P | DecidedReply<D>>>; parent: () => string | null } {
  const { tabId, docKey, preimage } = m;
  let parent: string | null = null;
  const prepare = async (): Promise<PrepareSpec<P | DecidedReply<D>>> => {
    const expected = await expectedHead(tabId, docKey, budget, inFlightSave);
    if ("refusal" in expected) throw expected.refusal;
    parent = expected.parent;
    const observedParent = named ? observedParentFor(tabId, docKey, parent, named.basis) : null;
    return m.prepare({
      docKey,
      parent,
      preimage,
      baselineProvenance: observedParent && named ? named.payload : null,
      ...(observedParent && { observedParent }),
      baselineTouched: freeze?.touched ?? false,
      ...(freeze && { capture: freeze.capture }),
    });
  };
  return { prepare, parent: () => parent };
}

/** Run one journaled mutation of `m.tabId`; the outcome mapper's answer. Rethrows an apply that threw with nothing changed. */
export async function runJournaledMutation<T, P extends PreparedTxn, O, D = never>(m: JournaledMutation<T, P, O, D>): Promise<O> {
  const { tabId, docKey, preimage } = m;
  const budget = startJournalBudget();
  if (isJournalBasisEvicted(tabId, docKey)) {
    forgetJournalBasis(tabId, docKey);
    const evicted = new JournalRefusal("STALE_PARENT", `the tab's journal basis was evicted; ${m.retryHint}`);
    return m.outcome({ status: "refused", refusal: evicted });
  }
  const inFlightSave = outstandingSaveBase(tabId, docKey);
  const freeze = m.freeze ? m.freeze(preimage) : freezeUnsavedProvenance(tabId, preimage);
  const provenance = new MutationProvenance(tabId, freeze);
  const { effects } = m;
  try {
    const frozen = freeze ? await settleWithin(freeze.payload(null), budget.remaining()) : { value: null };
    if (frozen === null) {
      // Nothing was sent: a client-side refusal releases.
      provenance.release();
      return await m.outcome({ status: "refused", refusal: journalTimeout("the provenance freeze", JOURNAL_PREAPPLY_BUDGET_MS) });
    }
    // The payload awaited: the tab may have changed under it.
    const changed = freeze ? (m.recheck?.() ?? null) : null;
    if (changed) return await m.outcome({ status: "aborted", reason: changed });
    const { prepare, parent } = preparer(m, budget, inFlightSave, freeze, frozen.value);
    const outcome = await runPreparedWrite({
      parent,
      preimage,
      docKey,
      prepare,
      ...(freeze && { turn: (send) => freeze.inTurn(send) }),
      verify: m.verify,
      apply: (prepared) => {
        const applied = m.apply(prepared);
        if ("postimage" in applied) provenance.fork(applied.postimage);
        return applied;
      },
      recover: () => {
        const postimage = m.recover();
        if (postimage !== preimage) {
          // The store may have thrown before its own revision bump: a client
          // holding the old revision token must not overwrite the mutation.
          useRevisionStore.getState().updateRevision(tabId);
          provenance.fork(postimage);
        }
        return postimage;
      },
      budget,
      ...(effects && { effects: (postimage: string) => withinEffectsDeadline(() => effects(preimage, postimage)) }),
    });

    const settled = settleControlledOutcome(outcome, provenance, basisSettler(tabId, docKey, m.life));
    if (settled.next === "rethrow") throw settled.error;
    if (settled.next === "answer") return await m.outcome(settled.outcome);
    // The type requires the adapter of every prepare that can answer a decision; fail loud on a caller that slipped past it.
    const { decided } = m as Partial<DecidedAdapter<D, O>>;
    if (!decided) throw new Error("the journal recorded a decision, and this mutation has no decided adapter");
    return await decided(settled.decision);
  } finally {
    // The first settlement wins, so this only reaches what nothing recorded.
    provenance.invalidateUnsettled();
  }
}
