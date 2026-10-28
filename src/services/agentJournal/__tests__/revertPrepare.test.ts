// WI-AL2.2e — the revert prepare request (R106 rule 10): it sends agent_journal_revert_prepare with the hunk, the expected reviewGen and the shared baseline fields, and reads `{kind, response}` whole — `prepared` is the writer's patch, `decided` is a success with no transaction whose head is the decision's; any other shape is malformed; through the request coordinator a decision is accepted immediately, on the retry after a timed-out attempt, and with the budget already spent, and a decision that lands after the request was abandoned is aborted never (it has no transaction)
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { untilReady } from "@/test/untilReady";

vi.unmock("@/services/agentJournal/journalTransport");

import { resetJournalBindings } from "../documentBinding";
import type { JournalBudget } from "../journalDeadline";
import { JournalRefusal } from "../journalRefusal";
import { runPrepareRequest } from "../journalRequest";
import { resetPageRegistration } from "../pageRegistration";
import { parseRevertReply, revertPrepare, type RevertPrepareInput } from "../revertClient";
import { boundPair, boundPrepare, scriptWire } from "./journalWire";

const CMD = "agent_journal_revert_prepare";
const HASH = `sha256-${"a".repeat(64)}`;
const PREPARED = {
  doc: "d",
  txn: "txn-1",
  revision: "rev-1",
  generation: "4",
  baseline: null,
  hunk: "h-1",
  reviewGen: "7",
  from: 1,
  to: 2,
  insert: "x",
  postimageHash: HASH,
};
const DECIDED = { doc: "d", hunk: "h-1", action: "conflicted", reviewGen: "8", generation: "5", baseline: "obs-1", head: "rev-0" };

const INPUT: RevertPrepareInput = {
  docKey: "path:/a.md",
  parent: "rev-0",
  preimage: "abc",
  hunkId: "h-1",
  expectedReviewGen: "7",
  baselineProvenance: null,
  baselineTouched: false,
};

const never = () => new Promise<never>(() => {});
let wire: ReturnType<typeof scriptWire>;

function refused(fn: () => unknown): JournalRefusal {
  try {
    fn();
  } catch (error) {
    if (error instanceof JournalRefusal) return error;
  }
  throw new Error("expected a JournalRefusal");
}

const prepares = () => wire.payloadsOf(CMD);
const run = (budget?: JournalBudget) => runPrepareRequest({ build: () => revertPrepare(INPUT), ...(budget && { budget }) });

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

describe("revertPrepare — the request", () => {
  it("names the revert command and sends the input as its fields", () => {
    const spec = revertPrepare(INPUT);
    expect(spec.command).toBe(CMD);
    expect(spec.fields).toEqual(INPUT);
  });
});

describe("parseRevertReply — {kind, response}", () => {
  it("reads a prepared reply as the writer's patch", () => {
    expect(parseRevertReply(CMD, { kind: "prepared", response: PREPARED })).toEqual({ kind: "prepared", ...PREPARED });
  });

  it("reads a decided reply as a decision with its head and no transaction", () => {
    const out = parseRevertReply(CMD, { kind: "decided", response: DECIDED });
    expect(out).toEqual({ kind: "decided", decision: DECIDED, head: "rev-0" });
    expect("txn" in out).toBe(false);
  });

  it.each([
    ["an unknown kind", { kind: "applied", response: PREPARED }],
    ["no response", { kind: "prepared" }],
    ["an extra field", { kind: "decided", response: DECIDED, txn: "t" }],
    ["a decided reply holding a patch", { kind: "decided", response: PREPARED }],
    ["a prepared reply holding a decision", { kind: "prepared", response: DECIDED }],
    ["not an object", "prepared"],
  ])("refuses %s as malformed", (_label, reply) => {
    expect(refused(() => parseRevertReply(CMD, reply)).journalCode).toBe("JOURNAL_UNAVAILABLE");
  });
});

describe("revert prepare through the request coordinator — a decision is a success", () => {
  it("accepts an immediate decision and aborts nothing", async () => {
    wire.on(CMD, (a) => boundPrepare(String(a.payload), { kind: "decided", response: DECIDED }));
    const out = await run();
    expect(out).toMatchObject({ ok: true, prepared: { kind: "decided", head: "rev-0" } });
    if (out.ok) out.finish();
    expect(wire.argsOf("agent_journal_abort")).toEqual([]);
    expect(wire.argsOf("agent_journal_abandon")).toEqual([]);
  });

  it("accepts a decision answered on the retry after a timed-out attempt", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    let n = 0;
    wire.on(CMD, (a) => {
      n += 1;
      return n === 1 ? never() : boundPrepare(String(a.payload), { kind: "decided", response: DECIDED });
    });
    const out = run();
    await untilReady(() => prepares().length === 1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await out).toMatchObject({ ok: true, prepared: { kind: "decided" } });
    expect(prepares()[1]).toBe(prepares()[0]);
    expect(wire.argsOf("agent_journal_abandon")).toEqual([]);
  });

  it("accepts a decision even when the budget ran out as it was answered: nothing is left to apply", async () => {
    let left = 7000;
    wire.on(CMD, (a) => {
      left = 0;
      return boundPrepare(String(a.payload), { kind: "decided", response: DECIDED });
    });
    expect(await run({ remaining: () => left })).toMatchObject({ ok: true, prepared: { kind: "decided" } });
    expect(wire.argsOf("agent_journal_abandon")).toEqual([]);
  });

  it("a decision landing after the request was abandoned is never aborted", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const late: Array<() => void> = [];
    wire.on(CMD, (a) => new Promise((r) => late.push(() => r(boundPrepare(String(a.payload), { kind: "decided", response: DECIDED })))));
    const out = run();
    await untilReady(() => prepares().length === 1);
    await vi.advanceTimersByTimeAsync(5000);
    await untilReady(() => prepares().length === 2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await out).toMatchObject({ ok: false, disposition: "invalidate", refusal: { uncertain: true } });
    expect(wire.argsOf("agent_journal_abandon")).toHaveLength(1);
    vi.useRealTimers();
    for (const answer of late) answer();
    for (let i = 0; i < 50; i += 1) await new Promise((r) => setImmediate(r));
    expect(wire.argsOf("agent_journal_abort")).toEqual([]);
  });
});
