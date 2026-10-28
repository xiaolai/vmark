// @vitest-environment node
// WI-AL2.0j — every coordinator await is bounded: a prepare still waiting for its capture turn at the deadline refuses JOURNAL_TIMEOUT and never dispatches once the turn comes; a commit acknowledgement that never settles is applied not durable at the per-call deadline with no abort and no retry, and a late one changes nothing; an abort that never settles keeps the original refusal; readiness, the freeze payload and the prepare share one pre-apply budget, each prepare attempt bounded by the smaller of the per-call deadline and what remains; a timed-out attempt never invokes late; a prepare reply that lands late is aborted once with reason timedOut; the worst case answers within 17 000 ms | AL2.2g: a prepare that never settles is retried once with the same payload, then abandoned: JOURNAL_TIMEOUT uncertain (the budget ran out after a dispatch), and its late reply is aborted once with its page pair; a prepare dispatched with the budget nearly spent is abandoned when it times out; a late refusal still changes nothing
// Driven through the real chain — raw `invoke` → transport → `journalIpc` →
// page registration → request coordinator → the coordinator — on a fake
// clock (timers and `performance` only: the payload digest is real async work).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { untilReady } from "@/test/untilReady";

vi.unmock("@/services/agentJournal/journalTransport");
import { agentJournalEpochFake } from "@/test/agentJournalEpochFake";
import type { NamedPayload } from "../provenance/session";
import { bindJournalDocument } from "../documentBinding";
import { journalBasis } from "../documentIdentity";
import { registerUnsavedProvenanceSource } from "../unsavedProvenance";
import { JOURNAL_DEADLINE_MS, JOURNAL_PREAPPLY_BUDGET_MS } from "../journalDeadline";
import { EFFECTS_DEADLINE_MS, runJournaledMutation, type JournaledOutcome } from "../journaledMutation";
import { resetPageRegistration } from "../pageRegistration";
import { KEY, TAB, mutation, resetMutationFixture } from "./journaledMutationFixture";
import { boundPair, boundPrepare, requestAnswer, scriptWire } from "./journalWire";

const PREPARE = "agent_journal_prepare";
const TXN = "txn-1";
const REV = "rev-1";
const DOC = "doc-1";
const PREPARED = { doc: DOC, txn: TXN, revision: REV, generation: "1", baseline: null, certified: false, fallbackReason: null };
const COMMITTED = { doc: DOC, revision: REV, applied: true, durable: true, certified: false, fallbackReason: null };

let wire: ReturnType<typeof scriptWire>;

const never = (): Promise<never> => new Promise<never>(() => {});

/** A reply the test settles later, by hand. */
function deferred(): { reply: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void } {
  let resolve: (v: unknown) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { reply: () => promise, resolve, reject };
}

/** The journal commands sent, page registrations aside. */
const commands = () => wire.calls.map((c) => c.command).filter((c) => c !== "agent_journal_register_page");
const sent = (command: string) => commands().filter((c) => c === command).length;

/** Watch a run settle without awaiting it, so a hang is a failed assertion, not a test timeout. */
function track<T>(run: Promise<T>): { done: boolean; value?: T; error?: unknown } {
  const state: { done: boolean; value?: T; error?: unknown } = { done: false };
  run.then(
    (value) => Object.assign(state, { done: true, value }),
    (error: unknown) => Object.assign(state, { done: true, error }),
  );
  return state;
}

/** A provenance source whose freeze payload settles after `ms` (never when `null`). */
function slowPayload(ms: number | null): void {
  registerUnsavedProvenanceSource(TAB, {
    freeze: () => ({
      touched: false, capture: { view: "v", session: "s", seq: "1" }, inTurn: (send) => send(),
      payload: () =>
        ms === null ? never() : new Promise<NamedPayload | null>((resolve) => setTimeout(() => resolve(null), ms)),
      recorded: () => {},
      invalidate: () => {}, release: () => {},
    }),
    fork: () => ({ recorded: () => {}, invalidate: () => {} }),
  });
}

const timedOut = { status: "refused", refusal: { journalCode: "JOURNAL_TIMEOUT", uncertain: false } };
/** The budget ran out after a dispatch (R76 rule 3): a timeout, uncertain, abandoned. */
const abandoned = { status: "refused", refusal: { journalCode: "JOURNAL_TIMEOUT", uncertain: true } };

beforeEach(() => {
  resetMutationFixture();
  resetPageRegistration();
  wire = scriptWire();
  wire.on(PREPARE, (args) => boundPrepare(String(args.payload), PREPARED));
  wire.on("agent_journal_commit", (args) => boundPair(args, COMMITTED));
  wire.on("agent_journal_abort", (args) => boundPair(args, { durable: true }));
  wire.on("agent_journal_abandon", () => ({ state: "fenced" }));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runJournaledMutation — the commit and the abort are bounded", () => {
  it("a commit acknowledgement that never settles is applied, not durable, at the deadline: no abort, no second commit", async () => {
    const ack = deferred();
    wire.on("agent_journal_commit", ack.reply);
    const run = track(runJournaledMutation(mutation()));
    await untilReady(() => sent("agent_journal_commit") === 1);
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS - 1);
    expect(run.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(run.value).toEqual({ status: "applied", value: "v", durable: false });
    expect(commands()).toEqual([PREPARE, "agent_journal_commit"]);
    // The pre-write basis (no parent, no baseline), as a refused commit leaves it.
    expect(journalBasis(TAB, KEY)).toBeNull();

    // A late acknowledgement is ignored.
    await vi.advanceTimersByTimeAsync(9000 - JOURNAL_DEADLINE_MS);
    ack.resolve(boundPair(wire.argsOf("agent_journal_commit")[0], COMMITTED));
    await vi.advanceTimersByTimeAsync(0);
    expect(commands()).toEqual([PREPARE, "agent_journal_commit"]);
    expect(journalBasis(TAB, KEY)).toBeNull();
  });

  it("an abort that never settles keeps the refusal outcome at the deadline, with nothing else invoked", async () => {
    wire.on("agent_journal_abort", never);
    const run = track(runJournaledMutation(mutation({ verify: () => "edited" })));
    await untilReady(() => sent("agent_journal_abort") === 1);
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS - 1);
    expect(run.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(run.value).toEqual({ status: "aborted", reason: "edited" });
    expect(commands()).toEqual([PREPARE, "agent_journal_abort"]);
  });
});

describe("runJournaledMutation — the pre-apply budget", () => {
  it("a prepare still waiting for its capture turn at the deadline refuses JOURNAL_TIMEOUT and never dispatches", async () => {
    let openTurn: () => void = () => {};
    const turn = new Promise<void>((resolve) => (openTurn = resolve));
    registerUnsavedProvenanceSource(TAB, {
      freeze: () => ({
        touched: false, capture: { view: "v", session: "s", seq: "2" },
        inTurn: (send) => turn.then(send),
        payload: async () => null, recorded: () => {}, invalidate: () => {}, release: () => {},
      }),
      fork: () => ({ recorded: () => {}, invalidate: () => {} }),
    });
    const run = track(runJournaledMutation(mutation()));
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS);
    expect(run.value).toMatchObject(timedOut);
    openTurn();
    await vi.advanceTimersByTimeAsync(1);
    expect(wire.calls).toEqual([]);
  });

  it("readiness that never settles refuses JOURNAL_TIMEOUT with no prepare and no apply; settling late invokes nothing", async () => {
    const release = agentJournalEpochFake.holdNextBind();
    const bound = bindJournalDocument("tab:main/held", KEY);
    const apply = vi.fn(() => ({ postimage: "after", value: "v" }));
    const run = track(runJournaledMutation(mutation({ apply })));
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS - 1);
    expect(run.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(run.value).toMatchObject(timedOut);

    // Readiness lands 1 ms after its attempt timed out: still no invoke.
    await vi.advanceTimersByTimeAsync(1);
    release();
    await bound;
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS);
    expect(wire.calls).toEqual([]);
    expect(apply).not.toHaveBeenCalled();
  });

  /** Run a mutation whose prepare never answers in time through its retry and its abandon. */
  async function exhaust(run: { done: boolean }): Promise<void> {
    await untilReady(() => sent(PREPARE) === 1);
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS);
    await untilReady(() => sent(PREPARE) === 2);
    expect(run.done).toBe(false);
    await vi.advanceTimersByTimeAsync(JOURNAL_PREAPPLY_BUDGET_MS - JOURNAL_DEADLINE_MS);
    await untilReady(() => run.done);
  }

  it("a prepare that never settles is retried once with the same payload, then abandoned with no apply; its late reply is aborted once, reason timedOut", async () => {
    const reply = deferred();
    wire.on(PREPARE, reply.reply);
    const apply = vi.fn(() => ({ postimage: "after", value: "v" }));
    const run = track(runJournaledMutation(mutation({ apply })));
    await exhaust(run);
    expect(run.value).toMatchObject(abandoned);
    const [payload, retried] = wire.payloadsOf(PREPARE);
    expect(retried).toBe(payload);
    expect(wire.payloadsOf("agent_journal_abandon")).toEqual([payload]);
    expect(commands()).toEqual([PREPARE, PREPARE, "agent_journal_abandon"]);

    // Both attempts carried the same request: its one transaction is aborted once.
    reply.resolve(await boundPrepare(payload, PREPARED));
    await untilReady(() => sent("agent_journal_abort") === 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).not.toHaveBeenCalled();
    expect(commands()).toEqual([PREPARE, PREPARE, "agent_journal_abandon", "agent_journal_abort"]);
    const p: unknown = JSON.parse(payload);
    const pair = typeof p === "object" && p !== null && "pageIdentity" in p && "webviewGeneration" in p ? p : null;
    expect(wire.argsOf("agent_journal_abort")).toEqual([
      { txn: TXN, reason: "timedOut", pageIdentity: pair?.pageIdentity, webviewGeneration: pair?.webviewGeneration },
    ]);
  });

  it("a prepare refusal that lands late is dropped: nothing is aborted", async () => {
    const reply = deferred();
    wire.on(PREPARE, reply.reply);
    const run = track(runJournaledMutation(mutation()));
    await exhaust(run);
    expect(run.value).toMatchObject(abandoned);
    reply.reject(await requestAnswer(wire.payloadsOf(PREPARE)[0], "JOURNAL_BUSY", false, { state: "notAdmitted" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(commands()).toEqual([PREPARE, PREPARE, "agent_journal_abandon"]);
  });

  it("a freeze payload that never settles refuses JOURNAL_TIMEOUT when the budget runs out, with nothing invoked", async () => {
    slowPayload(null);
    const run = track(runJournaledMutation(mutation()));
    await vi.advanceTimersByTimeAsync(JOURNAL_PREAPPLY_BUDGET_MS - 1);
    expect(run.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(run.value).toMatchObject(timedOut);
    expect(wire.calls).toEqual([]);
  });

  it("after a slow freeze payload the prepare attempt gets only the remaining budget, and its timeout is abandoned, not retried", async () => {
    wire.on(PREPARE, never);
    slowPayload(6000);
    const run = track(runJournaledMutation(mutation()));
    await vi.advanceTimersByTimeAsync(6000);
    await untilReady(() => sent(PREPARE) === 1);
    await vi.advanceTimersByTimeAsync(JOURNAL_PREAPPLY_BUDGET_MS - 6000 - 1);
    expect(run.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await untilReady(() => run.done);
    expect(run.value).toMatchObject(abandoned);
    expect(commands()).toEqual([PREPARE, "agent_journal_abandon"]);
  });
});

describe("runJournaledMutation — the worst case", () => {
  it("a slow pre-apply, then effects and a commit that never settle: applied with error, not durable, within 17 000 ms", async () => {
    wire.on(PREPARE, (args) =>
      new Promise((resolve) => setTimeout(() => resolve(boundPrepare(String(args.payload), PREPARED)), 3999)),
    );
    wire.on("agent_journal_commit", never);
    slowPayload(3000);
    const worst = JOURNAL_PREAPPLY_BUDGET_MS + EFFECTS_DEADLINE_MS + JOURNAL_DEADLINE_MS;
    expect(worst).toBe(17_000);
    let effectsStarted = false;
    const t0 = performance.now();
    const run = track(runJournaledMutation(mutation({
      effects: () => {
        effectsStarted = true;
        return never();
      },
    })));
    await vi.advanceTimersByTimeAsync(3000);
    await untilReady(() => sent(PREPARE) === 1);
    await vi.advanceTimersByTimeAsync(3999);
    // The prepare reply is checked against a real digest before the effects
    // start their deadline; advancing the clock before then would fire nothing.
    await untilReady(() => effectsStarted);
    await vi.advanceTimersByTimeAsync(EFFECTS_DEADLINE_MS);
    await untilReady(() => sent("agent_journal_commit") === 1);
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS);
    await untilReady(() => run.done);
    expect(performance.now() - t0).toBeLessThanOrEqual(worst);
    const out = run.value as JournaledOutcome<string>;
    expect(out).toMatchObject({ status: "appliedWithError", durable: false });
    expect(commands()).toEqual([PREPARE, "agent_journal_commit"]);
  });
});
