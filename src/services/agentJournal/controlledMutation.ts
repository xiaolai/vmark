/**
 * Controlled mutation — the editor side of the journal's protocol for an
 * MCP write: prepare (durable, takes the document's reservation), then
 * re-verify the editor, apply, and commit.
 *
 * Pipeline: prepare → verify() → apply() → commit. A prepare refusal
 * applies nothing. A verify failure, or an editor that refuses the apply,
 * appends `aborted` and applies nothing. A commit that fails after the
 * apply is `applied` with `durable: false` — the content changed, so it is
 * never reported as an error. A queued commit lands later (basis: its
 * revision); a refused one ends `uncommitted` (basis: the pre-write head).
 *
 * A prepare answered with a decision (`DecidedReply`: a hunk revert the
 * journal recorded as a review decision instead) holds no transaction:
 * nothing is verified, applied, committed or aborted, and the outcome is
 * `decided`, carrying the head the decision was recorded on.
 *
 * An apply that THROWS may have changed the document part-way, so it is
 * never aborted on trust: `recover()` reads the document back. Unchanged
 * (the preimage) → `aborted`, carrying the error in `thrown`. Changed → the text
 * it holds is committed as the postimage and the outcome is
 * `appliedWithError`. Unreadable → `recoveryRequired`: neither committed nor
 * aborted, the transaction keeps the document's reservation and the journal
 * reports it uncommitted on its next start, so the preimage stays restorable.
 * A verify that throws ran before anything was applied: aborted, `thrown`.
 * Either way the abort reports the basis like any other, so the caller keeps
 * a baseline the prepare recorded before it rethrows the error.
 *
 * A prepared write may carry `effects`, run after a successful apply and
 * before its commit; what it returns rides on the commit. An effects step
 * that throws still commits the applied text (without extras) and the
 * outcome is `appliedWithError` carrying that error — never a skipped commit.
 *
 * Key decisions:
 *   - `verify` and `apply` are synchronous and run back to back with no
 *     `await` between them, so nothing the user does can land in between.
 *   - A failed or rejected abort still ends as `aborted`: the request is
 *     refused either way, and the journal keeps the reservation until its
 *     drainer lands the queued record.
 *   - The prepare is one request of the journal's protocol, run by
 *     `journalRequest.ts`: frozen payload, page identity, bounded attempts,
 *     one retry, abandon, the provenance fallback, and the freeze
 *     disposition a refusal carries (`release` only when the journal proved
 *     nothing was admitted, or nothing was sent).
 *   - Commit and abort name the page pair the request was sent for. A
 *     commit past its deadline is not durable on the pre-write basis, with
 *     no retry and no abort; its late acknowledgement is logged and
 *     ignored. A `STALE_PAGE` commit (the page that prepared it is gone) is
 *     not durable and never retried, and the registration is renewed.
 *   - A commit acknowledgement that names another document or revision, or
 *     says nothing was applied, is not trusted: the write is reported not
 *     durable on the pre-write basis. The reply's bind (txn and pair) is
 *     checked before that, in `journalClient.ts`.
 *   - An applied write's durability is reported to the recording store
 *     under `docKey` (`recordingReport.ts`): not durable reads "history not
 *     recorded" in the panel.
 *
 * @coordinates-with services/agentJournal/journalClient.ts — the IPC calls
 * @coordinates-with services/agentJournal/journalRequest.ts — the prepare request
 * @coordinates-with services/agentJournal/journaledMutation.ts — every tab mutation, through `runPreparedWrite`
 * @module services/agentJournal/controlledMutation
 */

import {
  commitControlledWrite,
  isDecidedReply,
  type AbortReason,
  type CommitExtras,
  type DecidedReply,
  type PreparedTxn,
  type PrepareSpec,
} from "./journalClient";
import { JOURNAL_DEADLINE_MS, withJournalDeadline, type JournalBudget } from "./journalDeadline";
import { JournalRefusal } from "./journalRefusal";
import { runPrepareRequest, type RequestDisposition } from "./journalRequest";
import { abortTxn } from "./requestEnding";
import { noteStalePage, type PagePair } from "./pageRegistration";
import { journalWarn } from "@/utils/debug";
import { beginWriteReport } from "./recordingReport";

export type ControlledOutcome<T, D = never> =
  /** `disposition`: what the caller does with the freeze it took (`journalRequest.ts`). */
  | { status: "refused"; refusal: JournalRefusal; disposition: RequestDisposition }
  /**
   * `basis` is the revision the tab's buffer now derives from: the baseline
   * the prepare recorded for its unjournaled text, else the parent it
   * stated. The caller keeps it as the tab's next parent. `thrown`: the
   * verify or apply threw (the document unchanged); the caller rethrows
   * `thrown.error` once it has kept the basis.
   */
  | { status: "aborted"; reason: AbortReason; basis: string | null; thrown?: { error: unknown } }
  /**
   * `basis`: the committed revision; or, when the journal refused the
   * commit (the transaction then ends `uncommitted` and the head does not
   * move), the same pre-write basis an aborted write reports.
   */
  | { status: "applied"; value: T; revision: string; durable: boolean; basis: string | null }
  /**
   * The apply threw after changing the document: `postimage`, the text read
   * back, was committed in its place. Or the apply succeeded and its effects
   * step threw: `postimage` was committed without extras. `durable` and
   * `basis` as for `applied`; there is no `value`.
   */
  | { status: "appliedWithError"; error: unknown; postimage: string; revision: string; durable: boolean; basis: string | null }
  /**
   * The apply threw and the document could not be read back: transaction
   * `txn` is left open (neither committed nor aborted), holding the
   * document's reservation for the journal's recovery. The tab's basis is
   * unknown.
   */
  | { status: "recoveryRequired"; error: unknown; txn: string }
  /** The journal recorded decision `decision` instead; `head`: the tab's basis now (a decision never moves it). */
  | { status: "decided"; decision: D; head: string | null };

/** A controlled write; its prepare is the caller's (an MCP edit, a restore). */
export interface PreparedWrite<T, P extends PreparedTxn, D = never> {
  /** The parent the prepare stated, read once it was built; the basis when it records no baseline. */
  parent: () => string | null;
  /** The text the prepare records as overwritten: what `recover` reads when nothing changed. */
  preimage: string;
  /** The document's journal key, so an applied write's durability is reported. */
  docKey?: string;
  /** The prepare request; built inside its first attempt's deadline. */
  prepare: () => Promise<PrepareSpec<P | DecidedReply<D>>> | PrepareSpec<P | DecidedReply<D>>;
  verify: (prepared: P) => AbortReason | null;
  apply: (prepared: P) => { postimage: string; value: T } | { refused: AbortReason };
  /** After an apply that threw: settle the document and return its text; throw when it cannot be read. */
  recover: (prepared: P) => string;
  /** After a successful apply, before its commit: extra fields for the commit. A throw is answered `appliedWithError`. */
  effects?: (postimage: string) => Promise<CommitExtras>;
  /** What is left of the caller's pre-apply budget; absent: the per-call deadline alone. */
  budget?: JournalBudget;
  /** Sends the prepare in its provenance capture's turn; absent: sent at once. */
  turn?: <R>(send: () => Promise<R>) => Promise<R>;
}

/** What a commit needs beyond its text: the transaction, the pair it was prepared for, the basis, the report. */
interface CommitContext {
  prepared: PreparedTxn;
  pair: PagePair;
  basis: string | null;
  report: (durable: boolean) => void;
}

/** Commit `postimage`: whether it landed durably, and the tab's basis afterwards. */
async function commit(
  { prepared, pair, basis, report }: CommitContext,
  postimage: string,
  extras?: CommitExtras,
): Promise<{ durable: boolean; basis: string | null }> {
  try {
    const ack = await withJournalDeadline(
      "the commit",
      () => commitControlledWrite(prepared.txn, postimage, pair, extras),
      JOURNAL_DEADLINE_MS,
      (late) => journalWarn("a commit acknowledgement arrived after its deadline; ignored:", late),
    );
    const landed = ack.applied && ack.doc === prepared.doc && ack.revision === prepared.revision;
    if (!landed) journalWarn("commit acknowledged another write; treating it as not durable:", ack);
    const durable = landed && ack.durable;
    report(durable);
    return { durable, basis: landed ? prepared.revision : basis };
  } catch (error) {
    if (error instanceof JournalRefusal && error.journalCode === "STALE_PAGE") {
      journalWarn(`the page that prepared ${prepared.txn} is no longer registered; the commit is not durable`);
      noteStalePage(pair);
    }
    report(false);
    return { durable: false, basis };
  }
}

/** Append `aborted` and answer it on the prepare's basis; `thrown` when the verify or apply threw. */
type Aborted<T> = (reason: AbortReason, thrown?: { error: unknown }) => Promise<ControlledOutcome<T>>;

/** Run a controlled write with the caller's prepare: verify → apply → commit, or abort. */
export async function runPreparedWrite<T, P extends PreparedTxn, D = never>(
  write: PreparedWrite<T, P, D>,
): Promise<ControlledOutcome<T, D>> {
  const report = beginWriteReport(write.docKey);
  const run = await runPrepareRequest({
    build: write.prepare,
    ...(write.docKey !== undefined && { docKey: write.docKey }),
    ...(write.budget && { budget: write.budget }),
    ...(write.turn && { turn: write.turn }),
  });
  if (!run.ok) return { status: "refused", refusal: run.refusal, disposition: run.disposition };
  try {
    const { prepared } = run;
    if (isDecidedReply<D, P>(prepared)) return { status: "decided", decision: prepared.decision, head: prepared.head };
    return await settlePrepared(write, { prepared, pair: run.pair, report });
  } finally {
    run.finish();
  }
}

/** Verify, apply and commit (or abort) a prepared write. */
async function settlePrepared<T, P extends PreparedTxn, D>(
  write: PreparedWrite<T, P, D>,
  { prepared, pair, report }: { prepared: P; pair: PagePair; report: (durable: boolean) => void },
): Promise<ControlledOutcome<T>> {
  const basis = prepared.baseline ?? write.parent();
  const ctx: CommitContext = { prepared, pair, basis, report };
  const aborted: Aborted<T> = async (reason, thrown) => {
    await abortTxn(prepared.txn, reason, pair);
    return { status: "aborted", reason, basis, ...(thrown && { thrown }) };
  };
  let reason: AbortReason | null;
  try {
    reason = write.verify(prepared);
  } catch (error) {
    return aborted("applyRefused", { error });
  }
  if (reason !== null) return aborted(reason);
  let applied: ReturnType<PreparedWrite<T, P, D>["apply"]>;
  try {
    applied = write.apply(prepared);
  } catch (error) {
    return recoverFromThrownApply(write, prepared, { ctx, aborted }, error);
  }
  if ("refused" in applied) return aborted(applied.refused);
  const { postimage } = applied;
  const effects = write.effects ? await settleEffects(write.effects, postimage) : { extras: undefined };
  const landed = await commit(ctx, postimage, effects.extras);
  if ("error" in effects) {
    journalWarn("the commit effects failed; committed the applied text without them:", effects.error);
    return { status: "appliedWithError", error: effects.error, postimage, revision: prepared.revision, ...landed };
  }
  return { status: "applied", value: applied.value, revision: prepared.revision, ...landed };
}

/** Run the effects step: its extras, or the error it threw (synchronously or not). */
async function settleEffects(
  effects: (postimage: string) => Promise<CommitExtras>,
  postimage: string,
): Promise<{ extras: CommitExtras } | { extras: undefined; error: unknown }> {
  try {
    return { extras: await effects(postimage) };
  } catch (error) {
    return { extras: undefined, error };
  }
}

/** An apply threw: abort only once the document reads back unchanged (see the header). */
async function recoverFromThrownApply<T, P extends PreparedTxn, D>(
  write: PreparedWrite<T, P, D>,
  prepared: P,
  { ctx, aborted }: { ctx: CommitContext; aborted: Aborted<T> },
  error: unknown,
): Promise<ControlledOutcome<T>> {
  let postimage: string;
  try {
    postimage = write.recover(prepared);
  } catch (readError) {
    journalWarn("an apply failed and the document could not be read back; its transaction stays open:", error, readError);
    ctx.report(false);
    return { status: "recoveryRequired", error, txn: prepared.txn };
  }
  if (postimage === write.preimage) return aborted("applyRefused", { error });
  journalWarn("an apply failed part-way; committing the text the document now holds:", error);
  const landed = await commit(ctx, postimage);
  return { status: "appliedWithError", error, postimage, revision: prepared.revision, ...landed };
}
