// WI-AL2.2g — one prepare request through the real transport, IPC validation and page registration: the payload is frozen once and resent byte for byte (retry and abandon); each attempt is bounded by min(5000, remaining budget) and readiness that never settles invokes nothing, while a prepare answered in time leaves no timer; a second uncertain answer (JOURNAL_UNAVAILABLE) or budget expiry after dispatch (JOURNAL_TIMEOUT, both uncertain) abandons once with the original payload, and a timeout before dispatch is a clean, released JOURNAL_TIMEOUT; an own staleGeneration ends with no retry and no abandon and renews the registration; a confirmed provenance refusal falls back once under a new request id, an uncertain one retries the same payload; a page hidden while a prepare is in flight discards its reply with no abandon, even when the budget also ran out; late prepared replies are aborted timedOut with the request's pair; the generation stays an opaque string; a capture turn that fails after its send was dispatched invalidates and abandons once, as JOURNAL_TIMEOUT when the budget is spent or the turn itself timed out; a restored page's next registration names the old pair in replaces
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { untilReady } from "@/test/untilReady";

vi.unmock("@/services/agentJournal/journalTransport");

import { agentJournalEpochFake } from "@/test/agentJournalEpochFake";
import { bindJournalDocument, resetJournalBindings } from "../documentBinding";
import { parseControlledPrepared, type ControlledPrepared, type PrepareSpec } from "../journalClient";
import type { JournalBudget } from "../journalDeadline";
import { runPrepareRequest, type PrepareRequest } from "../journalRequest";
import { resetPageRegistration } from "../pageRegistration";
import { boundPair, boundPrepare, preparedReply, requestAnswer, scriptWire } from "./journalWire";

const PREPARE = "agent_journal_prepare";
const REGISTER = "agent_journal_register_page";
const never = () => new Promise<never>(() => {});
type Wire = ReturnType<typeof scriptWire>;
let wire: Wire;

function spec(baselineProvenance: unknown = null): PrepareSpec<ControlledPrepared> {
  const fields = { docKey: "path:/a.md", parent: null, preimage: "before", baselineProvenance };
  return { command: PREPARE, fields, parse: parseControlledPrepared };
}

function run(over: Partial<PrepareRequest<ControlledPrepared>> = {}) {
  return runPrepareRequest({ build: () => spec(), ...over });
}

/** Reject with a request answer for the payload sent. */
const answer = (journalCode: string, unsure: boolean, request: Record<string, unknown>, extra?: Record<string, unknown>) =>
  (args: Record<string, unknown>) => requestAnswer(String(args.payload), journalCode, unsure, request, extra).then((e) => Promise.reject(e));

const prepares = () => wire.payloadsOf(PREPARE);
const abandons = () => wire.payloadsOf("agent_journal_abandon");
const decoded = (p: string): Record<string, unknown> => JSON.parse(p);

/** Fake only the clocks the coordinator reads; the payload digest still settles on its own. */
const fakeClock = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });

function pagehide(persisted: boolean): void {
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted }));
}

beforeEach(() => {
  resetPageRegistration();
  resetJournalBindings();
  wire = scriptWire();
  wire.on("agent_journal_abort", (args) => boundPair(args, { durable: true }));
  wire.on("agent_journal_abandon", () => ({ state: "fenced" }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("journal request — frozen payload and identity", () => {
  it("freezes the fields, request id and page identity once", async () => {
    wire.state.fixedGeneration = "9007199254740993";
    wire.on(PREPARE, (a) => boundPrepare(String(a.payload), preparedReply()));
    const out = await run();
    expect(out).toMatchObject({ ok: true, prepared: { txn: "txn-1" } });
    const p = decoded(prepares()[0]);
    expect(p).toMatchObject({ docKey: "path:/a.md", webviewGeneration: "9007199254740993" });
    expect(prepares()[0]).toContain('"webviewGeneration":"9007199254740993"');
    expect(String(p.requestId)).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(p.pageIdentity)).toMatch(/^[0-9a-f]{32}$/);
    const [registered] = wire.argsOf(REGISTER);
    expect(p.pageIdentity).toBe(registered.pageIdentity);
    expect(out.ok && out.pair).toEqual({ pageIdentity: p.pageIdentity, webviewGeneration: "9007199254740993" });
  });

  it("a prepare reply for another request id is rejected before apply", async () => {
    wire.on(PREPARE, async (a) => ({ bind: { requestId: "x", digest: "0".repeat(64) }, reply: (await boundPrepare(String(a.payload), preparedReply())) }));
    const out = await run();
    expect(out).toMatchObject({ ok: false, disposition: "invalidate", refusal: { uncertain: true } });
  });
});

describe("journal request — uncertainty, retry and abandon", () => {
  it("double_uncertain_abandon_sends_original_payload", async () => {
    wire.on(PREPARE, () => Promise.reject(new Error("dropped")));
    const out = await run();
    expect(out).toMatchObject({ ok: false, disposition: "invalidate", refusal: { journalCode: "JOURNAL_UNAVAILABLE", uncertain: true } });
    expect(prepares()).toHaveLength(2);
    expect(prepares()[1]).toBe(prepares()[0]);
    expect(abandons()).toEqual([prepares()[0]]);
  });

  it("the abandon sends the prepare's payload byte for byte", async () => {
    wire.on(PREPARE, answer("JOURNAL_BUSY", true, { state: "inFlight" }));
    await run({ build: () => spec({ a: "é中", b: [1, 2] }) });
    expect(abandons()).toHaveLength(1);
    expect(abandons()[0]).toBe(prepares()[0]);
  });

  it("own_stale_generation_ends_without_abandon, and the next request registers afresh", async () => {
    wire.on(PREPARE, answer("STALE_REQUEST", true, { state: "staleGeneration" }));
    const out = await run();
    expect(out).toMatchObject({ ok: false, disposition: "invalidate" });
    expect(prepares()).toHaveLength(1);
    expect(abandons()).toEqual([]);
    const old = decoded(prepares()[0]);
    wire.on(PREPARE, (a) => boundPrepare(String(a.payload), preparedReply()));
    const next = await run();
    expect(next.ok).toBe(true);
    expect(wire.argsOf(REGISTER).at(-1)).toMatchObject({
      replaces: { pageIdentity: old.pageIdentity, webviewGeneration: old.webviewGeneration },
    });
  });

  it("a capture turn that fails after its send was dispatched invalidates and abandons the payload once", async () => {
    wire.on(PREPARE, (a) => boundPrepare(String(a.payload), preparedReply()));
    const turn = async <R,>(send: () => Promise<R>): Promise<R> => {
      await send();
      throw new Error("the capture turn failed");
    };
    const out = await run({ turn });
    expect(out).toMatchObject({ ok: false, disposition: "invalidate", refusal: { journalCode: "JOURNAL_UNAVAILABLE", uncertain: true } });
    expect(abandons()).toEqual(prepares());
    expect(prepares()).toHaveLength(1);
  });

  it("a capture turn that fails after its send, once the budget is spent, ends JOURNAL_TIMEOUT and abandons once", async () => {
    let left = 7000;
    const budget: JournalBudget = { remaining: () => left };
    wire.on(PREPARE, (a) => boundPrepare(String(a.payload), preparedReply()));
    const turn = async <R,>(send: () => Promise<R>): Promise<R> => {
      await send();
      left = 0;
      throw new Error("the capture turn failed");
    };
    const out = await run({ turn, budget });
    expect(out).toMatchObject({ ok: false, disposition: "invalidate", refusal: { journalCode: "JOURNAL_TIMEOUT", uncertain: true } });
    expect(abandons()).toEqual(prepares());
  });

  it("a capture turn that times out after its send ends JOURNAL_TIMEOUT, uncertain, and abandons once", async () => {
    wire.on(PREPARE, (a) => boundPrepare(String(a.payload), preparedReply()));
    const turn = async <R,>(send: () => Promise<R>): Promise<R> => {
      await send();
      throw { code: "conflict", message: "JOURNAL_TIMEOUT: the turn ran out", detail: { journalCode: "JOURNAL_TIMEOUT" } };
    };
    const out = await run({ turn });
    expect(out).toMatchObject({ ok: false, disposition: "invalidate", refusal: { journalCode: "JOURNAL_TIMEOUT", uncertain: true } });
    expect(abandons()).toEqual(prepares());
  });

  it("a clean notAdmitted releases with no retry and no abandon", async () => {
    wire.on(PREPARE, answer("STALE_PARENT", false, { state: "notAdmitted" }));
    expect(await run()).toMatchObject({ ok: false, disposition: "release", refusal: { journalCode: "STALE_PARENT" } });
    expect(prepares()).toHaveLength(1);
    expect(abandons()).toEqual([]);
  });
});

describe("journal request — provenance fallback", () => {
  it("a confirmed provenance notAdmitted falls back once under a new request id", async () => {
    let n = 0;
    wire.on(PREPARE, (a) => {
      n += 1;
      if (n === 1) return answer("INVALID_REQUEST", false, { state: "notAdmitted" }, { field: "provenance" })(a);
      return boundPrepare(String(a.payload), preparedReply());
    });
    expect(await run({ build: () => spec({ map: 1 }) })).toMatchObject({ ok: true });
    const [first, second] = prepares().map(decoded);
    expect(first.baselineProvenance).toEqual({ map: 1 });
    expect(second.baselineProvenance).toBeNull();
    expect(second.requestId).not.toBe(first.requestId);
  });

  it("a second provenance refusal is not retried again", async () => {
    wire.on(PREPARE, answer("INVALID_REQUEST", false, { state: "notAdmitted" }, { field: "provenance" }));
    expect(await run({ build: () => spec({ map: 1 }) })).toMatchObject({ ok: false, disposition: "release" });
    expect(prepares()).toHaveLength(2);
  });

  it("an uncertain provenance-shaped error resends the same payload", async () => {
    let n = 0;
    wire.on(PREPARE, (a) => {
      n += 1;
      if (n === 1) return Promise.reject({ code: "x", message: "INVALID_REQUEST", detail: { journalCode: "INVALID_REQUEST", field: "provenance", uncertain: true } });
      return boundPrepare(String(a.payload), preparedReply());
    });
    expect(await run({ build: () => spec({ map: 1 }) })).toMatchObject({ ok: true });
    expect(prepares()).toHaveLength(2);
    expect(prepares()[1]).toBe(prepares()[0]);
  });
});

describe("journal request — deadlines", () => {
  it("a prepare answered in time leaves no deadline timer behind", async () => {
    fakeClock();
    wire.on(PREPARE, (a) => boundPrepare(String(a.payload), preparedReply()));
    expect(await run()).toMatchObject({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("readiness that never settles refuses JOURNAL_TIMEOUT with zero invokes, and never invokes late", async () => {
    fakeClock();
    const land = agentJournalEpochFake.holdNextBind();
    void bindJournalDocument("path:/moved-from.md", "path:/a.md");
    const out = run({ docKey: "path:/a.md" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await out).toMatchObject({ ok: false, disposition: "release", refusal: { journalCode: "JOURNAL_TIMEOUT", uncertain: false } });
    land();
    await vi.advanceTimersByTimeAsync(10);
    expect(wire.calls).toEqual([]);
  });

  it("a slow first attempt leaves the retry only the remaining budget; abandon is bounded on its own", async () => {
    fakeClock();
    wire.on(PREPARE, never);
    wire.on("agent_journal_abandon", never);
    const t0 = performance.now();
    const out = run();
    let settled = false;
    void out.then(() => (settled = true));
    await untilReady(() => prepares().length === 1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(prepares()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(abandons()).toHaveLength(1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).toBe(true);
    expect(performance.now() - t0).toBeLessThanOrEqual(12000);
    expect(await out).toMatchObject({ ok: false, disposition: "invalidate", refusal: { journalCode: "JOURNAL_TIMEOUT", uncertain: true } });
    expect(prepares()).toHaveLength(2);
  });

  it("budget_expiry_abandon_sends_original_payload when the budget ends between prepared and apply", async () => {
    let left = 7000;
    const budget: JournalBudget = { remaining: () => left };
    wire.on(PREPARE, (a) => {
      left = 0;
      return boundPrepare(String(a.payload), preparedReply());
    });
    expect(await run({ budget })).toMatchObject({ ok: false, disposition: "invalidate", refusal: { journalCode: "JOURNAL_TIMEOUT", uncertain: true } });
    expect(abandons()).toEqual(prepares());
  });

  it("a prepared reply that lands after its attempt is aborted timedOut with the request's pair", async () => {
    fakeClock();
    let late: (v: unknown) => void = () => {};
    let n = 0;
    wire.on(PREPARE, (a) => {
      n += 1;
      if (n === 1) return new Promise((r) => (late = r)).then(() => boundPrepare(String(a.payload), preparedReply(9)));
      return boundPrepare(String(a.payload), preparedReply(1));
    });
    const out = run();
    await untilReady(() => prepares().length === 1);
    await vi.advanceTimersByTimeAsync(5000);
    const done = await out;
    expect(done).toMatchObject({ ok: true, prepared: { txn: "txn-1" } });
    late(null);
    await untilReady(() => wire.argsOf("agent_journal_abort").length > 0);
    const p = decoded(prepares()[0]);
    expect(wire.argsOf("agent_journal_abort")).toEqual([
      { txn: "txn-9", reason: "timedOut", pageIdentity: p.pageIdentity, webviewGeneration: p.webviewGeneration },
    ]);
  });
});

describe("journal request — page lifetime", () => {
  it("a page hidden while the prepare is in flight discards its reply: no apply, no abandon, a fresh identity next", async () => {
    let reply: () => void = () => {};
    wire.on(PREPARE, (a) => new Promise((r) => (reply = () => r(boundPrepare(String(a.payload), preparedReply())))));
    const out = run();
    await vi.waitFor(() => expect(prepares()).toHaveLength(1));
    pagehide(true);
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    reply();
    expect(await out).toMatchObject({ ok: false, disposition: "invalidate" });
    expect(abandons()).toEqual([]);
    const old = decoded(prepares()[0]);
    wire.on(PREPARE, (a) => boundPrepare(String(a.payload), preparedReply(2)));
    expect(await run()).toMatchObject({ ok: true });
    const fresh = decoded(prepares()[1]);
    expect(fresh.pageIdentity).not.toBe(old.pageIdentity);
    expect(wire.argsOf(REGISTER).at(-1)).toEqual({
      pageIdentity: fresh.pageIdentity,
      replaces: { pageIdentity: old.pageIdentity, webviewGeneration: old.webviewGeneration },
    });
  });

  it("a page hidden while the prepare is in flight is discarded, not abandoned, even when the budget also ran out", async () => {
    let left = 7000;
    const budget: JournalBudget = { remaining: () => left };
    let reply: () => void = () => {};
    wire.on(PREPARE, (a) => new Promise((r) => (reply = () => r(boundPrepare(String(a.payload), preparedReply())))));
    const out = run({ budget });
    await vi.waitFor(() => expect(prepares()).toHaveLength(1));
    pagehide(true);
    left = 0;
    reply();
    expect(await out).toMatchObject({ ok: false, disposition: "invalidate", refusal: { journalCode: "STALE_PAGE" } });
    expect(abandons()).toEqual([]);
  });

  it("restore_without_started_has_a_recovery_path", async () => {
    wire.on(PREPARE, (a) => boundPrepare(String(a.payload), preparedReply()));
    const first = await run();
    expect(first).toMatchObject({ ok: true });
    if (first.ok) first.finish();
    pagehide(true);
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    const again = await run();
    expect(again).toMatchObject({ ok: true });
    const [old, fresh] = wire.argsOf(REGISTER);
    expect(wire.argsOf(REGISTER)).toHaveLength(2);
    expect(fresh.pageIdentity).not.toBe(old.pageIdentity);
    // The new registration names the old pair in `replaces` (R99), so the journal revokes it; no other call ends it.
    const p = decoded(prepares()[0]);
    expect(fresh.replaces).toEqual({ pageIdentity: p.pageIdentity, webviewGeneration: p.webviewGeneration });
    expect(wire.calls.map((c) => c.command).filter((c) => c !== PREPARE && c !== REGISTER)).toEqual([]);
  });
});
