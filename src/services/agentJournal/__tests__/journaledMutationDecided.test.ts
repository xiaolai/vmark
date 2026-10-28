// @vitest-environment node
// WI-AL2.2e — the journaled-mutation coordinator's decision arm (R106 rule 10): a revert prepare answered `decided` is a success with no transaction — nothing is verified, applied, committed or aborted; the tab's basis becomes the decision's head (the baseline it consumed) and the freeze is recorded there, or both are dropped when there is no head; the page is released, so a re-registration after it is not held up; a decision answered on the retry after a timed-out attempt is the same success; a decision that lands after the request was abandoned is never aborted
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { untilReady } from "@/test/untilReady";
import { invoke } from "@tauri-apps/api/core";

import { abandonSpy, answerPrepare } from "@/test/agentJournalWireFake";
import { forgetJournalBasis, journalBasis, rememberJournalBasis } from "../documentIdentity";
import { runJournaledMutation, type JournaledMutation, type JournaledOutcome } from "../journaledMutation";
import { noteStalePage } from "../pageRegistration";
import { revertPrepare, type PreparedRevertReply } from "../revertClient";
import type { RevertDecided } from "../revertReplies";
import { registerUnsavedProvenanceSource } from "../unsavedProvenance";
import { KEY, TAB, content, mutation, ops, resetMutationFixture } from "./journaledMutationFixture";

const CMD = "agent_journal_revert_prepare";
const DECIDED: RevertDecided = { doc: "d", hunk: "h-1", action: "conflicted", reviewGen: "8", generation: "5", baseline: "rev-b", head: "rev-b" };

type Outcome = JournaledOutcome<string> | { status: "decided"; decision: RevertDecided };
type Revert = JournaledMutation<string, PreparedRevertReply, Outcome, RevertDecided>;

const never = () => new Promise<never>(() => {});

function source() {
  const freeze = { touched: true, capture: { view: "v", session: "s", seq: "1" }, inTurn: <T>(send: () => Promise<T>) => send(), payload: vi.fn(async () => null), recorded: vi.fn(), invalidate: vi.fn(), release: vi.fn() };
  registerUnsavedProvenanceSource(TAB, { freeze: () => freeze, fork: () => ({ recorded: vi.fn(), invalidate: vi.fn() }) });
  return freeze;
}

/** Answer the revert prepare with `answer(n)` on its n-th attempt (from 1). */
function answering(answer: (n: number) => "never" | RevertDecided | Promise<RevertDecided>) {
  let n = 0;
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    if (command !== CMD) return undefined;
    n += 1;
    const a = answer(n);
    if (a === "never") return never();
    return answerPrepare(args, async () => ({ kind: "decided", response: await a }));
  });
}

const prepares = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === CMD);

function revert(overrides: Partial<Revert> = {}): Revert {
  const base = mutation();
  return {
    tabId: base.tabId,
    life: base.life,
    docKey: base.docKey,
    preimage: base.preimage,
    retryHint: base.retryHint,
    prepare: (b) => revertPrepare({ ...b, hunkId: "h-1", expectedReviewGen: "7" }),
    verify: vi.fn(() => null),
    apply: vi.fn(() => ({ postimage: "after", value: "v" })),
    recover: base.recover,
    outcome: (o) => o,
    decided: (decision) => ({ status: "decided", decision }),
    ...overrides,
  };
}

beforeEach(() => {
  resetMutationFixture();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(() => Promise.resolve());
  rememberJournalBasis(TAB, KEY, "rev-0");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runJournaledMutation — a decided revert", () => {
  it("answers the decision: nothing verified, applied, committed or aborted", async () => {
    answering(() => DECIDED);
    const m = revert();
    expect(await runJournaledMutation(m)).toEqual({ status: "decided", decision: DECIDED });
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.apply).not.toHaveBeenCalled();
    expect(content()).toBe("before");
    expect(ops()).toEqual([]);
  });

  it("keeps the decision's head as the tab's basis and records the freeze there", async () => {
    const freeze = source();
    answering(() => DECIDED);
    await runJournaledMutation(revert());
    expect(journalBasis(TAB, KEY)).toBe("rev-b");
    expect(freeze.recorded).toHaveBeenCalledWith("rev-b");
    expect(freeze.recorded).toHaveBeenCalledTimes(1);
    expect(freeze.invalidate).not.toHaveBeenCalled();
    expect(freeze.release).not.toHaveBeenCalled();
  });

  it("a decision with no head drops the basis and invalidates the freeze", async () => {
    const freeze = source();
    answering(() => ({ ...DECIDED, baseline: null, head: null }));
    expect(await runJournaledMutation(revert())).toMatchObject({ status: "decided" });
    expect(journalBasis(TAB, KEY)).toBeNull();
    expect(freeze.recorded).not.toHaveBeenCalled();
    expect(freeze.invalidate).toHaveBeenCalledTimes(1);
  });

  it("a decision with no decided adapter fails loud, after the basis and freeze are settled", async () => {
    const freeze = source();
    answering(() => DECIDED);
    // A caller past the type's check: the adapter is required wherever a decision can be answered.
    const { decided: _required, ...untyped } = revert();
    await expect(runJournaledMutation(untyped as unknown as Revert)).rejects.toThrow(/decided/);
    expect(journalBasis(TAB, KEY)).toBe("rev-b");
    expect(freeze.recorded).toHaveBeenCalledWith("rev-b");
  });

  it("releases the page: a re-registration after it is not held up", async () => {
    answering(() => DECIDED);
    await runJournaledMutation(revert());
    const sent = JSON.parse((prepares()[0][1] as { payload: string }).payload) as { pageIdentity: string; webviewGeneration: string };
    noteStalePage(sent);
    // The fake journal holds no "rev-b": the next write starts from its genesis.
    forgetJournalBasis(TAB, KEY);
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "applied" });
  });

  it("accepts a decision answered on the retry after a timed-out attempt", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    answering((n) => (n === 1 ? "never" : DECIDED));
    const out = runJournaledMutation(revert());
    await untilReady(() => prepares().length === 1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await out).toEqual({ status: "decided", decision: DECIDED });
    expect(journalBasis(TAB, KEY)).toBe("rev-b");
    expect(abandonSpy).not.toHaveBeenCalled();
  });

  it("a decision landing after the request was abandoned is never aborted and changes nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const late: Array<(d: RevertDecided) => void> = [];
    answering(() => new Promise<RevertDecided>((r) => late.push(r)));
    const freeze = source();
    const out = runJournaledMutation(revert());
    await untilReady(() => prepares().length === 1);
    await vi.advanceTimersByTimeAsync(5000);
    await untilReady(() => prepares().length === 2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await out).toMatchObject({ status: "refused", refusal: { uncertain: true } });
    expect(freeze.invalidate).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    for (const answer of late) answer(DECIDED);
    for (let i = 0; i < 50; i += 1) await new Promise((r) => setImmediate(r));
    expect(ops()).toEqual([]);
    expect(freeze.recorded).not.toHaveBeenCalled();
    expect(journalBasis(TAB, KEY)).toBe("rev-0");
  });
});
