/**
 * Journal request — the coordinator of one prepare request: it freezes the
 * request's payload under the page's identity, sends it in bounded attempts,
 * reads each answer into what the caller may do with the provenance it
 * froze, and ends a request whose fate stays unknown.
 *
 * Pipeline: readiness → the capture turn → attempt (register the page,
 * freeze `P`, re-check, invoke, check the bound reply) → classify →
 * prepared | retry once | provenance fallback | refused → abandon, abort
 * late replies, release the page.
 *
 * Key decisions:
 *   - `P` is serialized once per logical request; a retry and the abandon
 *     resend those bytes. The page pair inside `P` is the one acquired by
 *     the first attempt, kept for the whole request.
 *   - Every attempt is bounded by `min(5000, remaining budget)`. The first
 *     attempt's clock covers readiness and the wait for the capture turn; a
 *     clock that ran out before the invoke never invokes. The turn is taken
 *     once, around every attempt.
 *   - Freeze disposition: `release` only when the journal answered a
 *     validated `notAdmitted` with `uncertain: false`, or nothing was sent
 *     (a client-side refusal with no dispatch in doubt). A request that
 *     ended (`terminal`, `terminalPending`, `abandoned`), an own
 *     `staleGeneration`, a discarded reply and any uncertain end are
 *     `invalidate`, and nothing is applied.
 *   - An uncertain answer (a timeout, a transport failure, a malformed or
 *     mis-bound reply, `inFlight`, `unavailable`, `staleIncarnation`,
 *     `conflict`, or a client-side failure after a dispatch) is retried once
 *     with the same `P`. A second one abandons `P` once (bounded on its own),
 *     `JOURNAL_UNAVAILABLE {uncertain}`; a budget spent after a dispatch
 *     does too, as `JOURNAL_TIMEOUT {uncertain}`. Before any dispatch a
 *     timeout is a clean, released `JOURNAL_TIMEOUT`.
 *   - An own `staleGeneration` is not retried and not abandoned: the page's
 *     registration is renewed. A provenance `notAdmitted` is resent once as
 *     a new logical request (new id, new `P`) without the baseline map.
 *   - A page hidden (`pagehide`) between the first attempt and the apply
 *     discards the request: nothing is applied and nothing abandoned.
 *   - A prepared reply that lands after its attempt is aborted `timedOut`
 *     with the request's pair, unless it is the transaction adopted.
 *   - A reply with no transaction (a revert's recorded decision) is a
 *     success: accepted even once the budget is spent (nothing is left to
 *     apply), and never aborted when it lands late.
 *
 * @coordinates-with services/agentJournal/pageRegistration.ts — the page pair and lifetime
 * @coordinates-with services/agentJournal/requestEnding.ts — abandon and abort
 * @coordinates-with services/agentJournal/controlledMutation.ts — its caller
 * @module services/agentJournal/journalRequest
 */

import { journalDocumentReady } from "./documentBinding";
import { JOURNAL_DEADLINE_MS, journalTimeout, settleWithin, startJournalBudget, withJournalDeadline, type JournalBudget } from "./journalDeadline";
import { callJournal, freezePreparePayload, mintRequestId, parseBound, sha256Hex } from "./journalIpc";
import { JournalRefusal, toJournalRefusal } from "./journalRefusal";
import type { RequestExpectation } from "./journalSettlement";
import { acquirePage, noteStalePage, pageLifetime, releasePage, type PagePair, type RegisteredPage } from "./pageRegistration";
import { abandonRequest, abortTxn } from "./requestEnding";
import type { PrepareSpec } from "./journalClient";
import { journalWarn } from "@/utils/debug";

/** What the caller does with the freeze it took for the request. */
export type RequestDisposition = "release" | "invalidate";

export type PrepareRun<P> =
  /** `finish()`: the write has settled (committed, aborted or left open); called once. */
  | { ok: true; prepared: P; pair: PagePair; finish: () => void }
  | { ok: false; refusal: JournalRefusal; disposition: RequestDisposition };

export interface PrepareRequest<P> {
  /** The request; built inside the first attempt's deadline. */
  build: () => Promise<PrepareSpec<P>> | PrepareSpec<P>;
  /** Wait for a running bind of this key before the first attempt (`documentBinding.ts`). */
  docKey?: string;
  budget?: JournalBudget;
  /** Sends in the provenance capture's turn; called once. */
  turn?: <R>(send: () => Promise<R>) => Promise<R>;
}

type Sent = { payload: string; expect: RequestExpectation };
type Answered<P> = { prepared: P; page: RegisteredPage };
type Outcome<P> = ({ kind: "prepared" } & Answered<P>) | { kind: "refused"; refusal: JournalRefusal; disposition: RequestDisposition; abandon: boolean };
type Step<P> = Outcome<P> | { kind: "again" };

const refused = <P>(refusal: JournalRefusal, disposition: RequestDisposition, abandon = false): Outcome<P> => ({ kind: "refused", refusal, disposition, abandon });
const pairOf = ({ pageIdentity, webviewGeneration }: RegisteredPage): PagePair => ({ pageIdentity, webviewGeneration });

/** Run one prepare request; see the header. */
export function runPrepareRequest<P extends { readonly txn?: string }>(request: PrepareRequest<P>): Promise<PrepareRun<P>> {
  return new PrepareRequestRun(request, request.budget ?? startJournalBudget()).run();
}

class PrepareRequestRun<P extends { readonly txn?: string }> {
  private spec: PrepareSpec<P> | null = null;
  /** The page this request holds (acquired once, released once). */
  private page: RegisteredPage | null = null;
  private sent: Sent | null = null;
  /** A dispatched request's fate is unknown. */
  private inDoubt = false;
  private uncertainAnswers = 0;
  private fellBack = false;
  private pageGone = false;
  private ended = false;
  private adopted: string | null = null;
  private readonly lates: Answered<P>[] = [];
  private readonly abortedLate = new Set<string>();
  private readonly lifetime = pageLifetime();

  constructor(
    private readonly request: PrepareRequest<P>,
    private readonly budget: JournalBudget,
  ) {}

  async run(): Promise<PrepareRun<P>> {
    const ms = Math.min(JOURNAL_DEADLINE_MS, this.budget.remaining());
    let outcome: Outcome<P> = refused(journalTimeout("the prepare", JOURNAL_DEADLINE_MS), "release");
    if (ms > 0) {
      try {
        outcome = await this.firstTurn(ms, performance.now() + ms);
      } catch (error) {
        const refusal = toJournalRefusal(error);
        outcome = this.inDoubt ? this.giveUp(this.spent() || refusal.journalCode === "JOURNAL_TIMEOUT") : refused(refusal, "release");
      }
    }
    this.ended = true;
    return this.settle(outcome);
  }

  /** Readiness, then the turn, under the first attempt's clock until the turn starts. */
  private async firstTurn(ms: number, deadline: number): Promise<Outcome<P>> {
    const turn = this.request.turn ?? ((send) => send());
    let inside = false;
    const running = (async () => {
      await this.ready();
      return turn(async () => {
        inside = true;
        if (this.ended) throw journalTimeout("the prepare", ms);
        return this.loop(deadline);
      });
    })();
    const settled = await settleWithin(running, ms);
    if (settled) return settled.value;
    if (inside) return running;
    this.ended = true;
    throw journalTimeout("the prepare", ms);
  }

  private async ready(): Promise<void> {
    if (this.request.docKey === undefined) return;
    const ready = await journalDocumentReady(this.request.docKey);
    if (!ready.ok) throw ready.refusal;
  }

  private async loop(firstDeadline: number): Promise<Outcome<P>> {
    let ms = firstDeadline - performance.now();
    for (let n = 0; ; n += 1) {
      if (n > 0) ms = Math.min(JOURNAL_DEADLINE_MS, this.budget.remaining());
      const attempt = { dispatched: false };
      let step: Step<P>;
      try {
        if (ms <= 0) throw journalTimeout("the prepare", JOURNAL_DEADLINE_MS);
        step = this.afterPrepared(await this.attempt(ms, attempt, n > 0));
      } catch (error) {
        step = this.classify(error, attempt.dispatched);
      }
      if (step.kind !== "again") return step;
    }
  }

  /** One bounded attempt: nothing is invoked once its clock ran out. */
  private attempt(ms: number, attempt: { dispatched: boolean }, readyAgain: boolean): Promise<Answered<P>> {
    const started = performance.now();
    const live = () => !this.ended && performance.now() - started < ms;
    const timedOut = () => journalTimeout("the prepare", ms);
    const body = async (): Promise<Answered<P>> => {
      if (readyAgain) await this.ready();
      this.spec ??= await this.request.build();
      const spec = this.spec;
      const page = this.page ?? (await this.acquire(live, timedOut));
      const sent = this.sent ?? (await this.freeze(spec, page));
      if (!live()) throw timedOut();
      if (pageLifetime() !== this.lifetime) {
        this.pageGone = true;
        throw new JournalRefusal("STALE_PAGE", "the page was hidden before its agent edit was sent");
      }
      attempt.dispatched = true;
      this.inDoubt = true;
      const r = await callJournal(spec.command, { payload: sent.payload }, sent.expect);
      const bind = { requestId: sent.expect.requestId, digest: sent.expect.digest };
      return { prepared: spec.parse(spec.command, parseBound(spec.command, r, bind)), page };
    };
    return withJournalDeadline("the prepare", body, ms, (late) => this.late(late));
  }

  private async acquire(live: () => boolean, timedOut: () => JournalRefusal): Promise<RegisteredPage> {
    let held = false;
    const page = await acquirePage(() => (held = live()));
    if (!held) throw timedOut();
    return (this.page = page);
  }

  private async freeze(spec: PrepareSpec<P>, page: RegisteredPage): Promise<Sent> {
    const requestId = mintRequestId();
    const payload = freezePreparePayload(spec.fields, requestId, page);
    return (this.sent = { payload, expect: { requestId, digest: await sha256Hex(payload) } });
  }

  private afterPrepared({ prepared, page }: Answered<P>): Step<P> {
    this.adopted = prepared.txn ?? null;
    if (pageLifetime() !== this.lifetime) return this.discard();
    // A decision (no transaction) leaves nothing to apply, so a spent budget does not undo it.
    if (prepared.txn !== undefined && this.spent()) return this.giveUp(true);
    return { kind: "prepared", prepared, page };
  }

  private classify(error: unknown, dispatched: boolean): Step<P> {
    if (this.pageGone) return this.discard();
    const refusal = toJournalRefusal(error);
    if (!dispatched) return this.inDoubt ? this.uncertainAnswer() : refused(refusal, "release");
    const settlement = refusal.settlement;
    if (settlement === null) return this.uncertainAnswer();
    switch (settlement.kind) {
      case "notAdmitted":
        this.inDoubt = false;
        return this.fallBack(refusal) ?? refused(refusal, "release");
      case "uncertain":
        if (settlement.cause !== "staleGeneration") return this.uncertainAnswer();
        if (this.page) noteStalePage(pairOf(this.page));
        return refused(refusal, "invalidate");
      default:
        return refused(refusal, "invalidate");
    }
  }

  /** A confirmed provenance refusal: once, a new logical request without the baseline map. */
  private fallBack(refusal: JournalRefusal): Step<P> | null {
    const spec = this.spec;
    if (refusal.field !== "provenance" || this.fellBack || !spec || !("baselineProvenance" in spec.fields) || spec.fields.baselineProvenance === null) return null;
    journalWarn("baseline provenance refused; recording the baseline snapshot-only:", refusal.message);
    this.fellBack = true;
    this.spec = { ...spec, fields: { ...spec.fields, baselineProvenance: null } };
    this.sent = null;
    this.uncertainAnswers = 0;
    return { kind: "again" };
  }

  private uncertainAnswer(): Step<P> {
    this.uncertainAnswers += 1;
    if (this.uncertainAnswers >= 2 || this.spent()) return this.giveUp(this.spent());
    return { kind: "again" };
  }

  private readonly spent = (): boolean => this.budget.remaining() <= 0;
  /** A dispatched request ends unknown: a spent budget or clock is `JOURNAL_TIMEOUT`, else `JOURNAL_UNAVAILABLE`. */
  private giveUp(timedOut: boolean): Outcome<P> {
    const code = timedOut ? "JOURNAL_TIMEOUT" : "JOURNAL_UNAVAILABLE";
    const message = `the agent edit journal did not confirm the prepare${timedOut ? " in time" : ""}; nothing was applied`;
    return refused(new JournalRefusal(code, message, null, null, { uncertain: true }), "invalidate", true);
  }

  private discard(): Outcome<P> {
    const message = "the page was hidden while its agent edit was prepared; nothing was applied";
    return refused(new JournalRefusal("STALE_PAGE", message, null, null, { uncertain: this.inDoubt }), this.inDoubt ? "invalidate" : "release");
  }

  /** A prepared reply that landed after its attempt's deadline. */
  private late(answered: Answered<P>): void {
    if (!this.ended) {
      this.lates.push(answered);
      return;
    }
    // A retry resends the same request, so two late replies can name one txn: abort it once.
    // A late decision holds no transaction: there is nothing to abort.
    const txn = answered.prepared.txn;
    if (txn === undefined || txn === this.adopted || this.abortedLate.has(txn)) return;
    this.abortedLate.add(txn);
    void abortTxn(txn, "timedOut", pairOf(answered.page));
  }

  private async settle(outcome: Outcome<P>): Promise<PrepareRun<P>> {
    let ending = outcome;
    if (ending.kind === "prepared" && pageLifetime() !== this.lifetime) ending = this.discard();
    if (ending.kind === "refused" && ending.abandon && this.sent && this.page) {
      await abandonRequest(this.sent.payload, this.sent.expect, pairOf(this.page));
    }
    for (const late of this.lates.splice(0)) this.late(late);
    if (ending.kind === "refused") {
      this.release();
      return { ok: false, refusal: ending.refusal, disposition: ending.disposition };
    }
    return { ok: true, prepared: ending.prepared, pair: pairOf(ending.page), finish: () => this.release() };
  }

  private release(): void {
    if (this.page === null) return;
    this.page = null;
    releasePage();
  }
}
