// @vitest-environment node
// WI-AL1.3 — the IPC client for the controlled-mutation protocol: payloads cross as JSON strings so a lone surrogate reaches Rust escaped (INVALID_TEXT, never replaced), generations are decimal strings, malformed replies and refusals become JournalRefusal, abort reasons are the closed set; a selection certificate crosses verbatim, the certified flag and fallback reason of each reply are checked, and a fallback is logged (WI-AL2.1c), including a declared script whose rotation breaks went over its cap (WI-AL2.1b); the prepare runs as a request with a bound reply, and commit and abort name the page pair and check its bind (WI-AL2.2g)
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
vi.mock("@/utils/debug", () => ({ journalWarn: vi.fn() }));
import { stubProvenancePayload } from "@/test/provenancePayloadFixture";

vi.unmock("@/services/agentJournal/journalTransport");
import { invoke } from "@tauri-apps/api/core";
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";
import { journalActorFor } from "../journalActor";
import { JournalRefusal } from "../journalRefusal";
import { journalWarn } from "@/utils/debug";
import { abortControlledWrite, commitControlledWrite, controlledPrepare, type PrepareInput } from "../journalClient";
import { runPrepareRequest } from "../journalRequest";
import { resetPageRegistration, type PagePair } from "../pageRegistration";
import { boundPair, boundPrepare, requestAnswer, scriptWire } from "./journalWire";
import { selectionCertificate, type SelectionCertificate } from "../selectionCertificate";

const invokeMock = vi.mocked(invoke);
const TXN = "0190d3c4-0000-7000-8000-000000000001";
const REV = "0190d3c4-0000-7000-8000-000000000002";
const DOC = "0190d3c4-0000-7000-8000-000000000003";

const input = {
  docKey: "path:/a.md",
  parent: null,
  preimage: "before",
  actor: journalActorFor(TEST_ATTRIBUTION),
  tool: "document.write",
  baselineProvenance: null,
  baselineTouched: false,
};

const PAIR: PagePair = { pageIdentity: "a".repeat(32), webviewGeneration: "3" };

type Wire = ReturnType<typeof scriptWire>;
let wire: Wire;

beforeEach(() => {
  resetPageRegistration();
  wire = scriptWire();
  vi.mocked(journalWarn).mockReset();
});

/** Answer the next prepare with `reply` under its bind (or reject with `error`). */
function nextPrepare(reply: unknown, raw = false): void {
  wire.on("agent_journal_prepare", (a) => (raw ? reply : boundPrepare(String(a.payload), reply)));
}

/** Run one controlled prepare request; its prepared transaction, or its refusal thrown. */
async function prepareControlledWrite(fields: PrepareInput) {
  const run = await runPrepareRequest({ build: () => controlledPrepare(fields) });
  if (!run.ok) throw run.refusal;
  run.finish();
  return run.prepared;
}

/** The decoded payload of the first prepare sent. */
const sentPayload = () => wire.payloadsOf("agent_journal_prepare")[0];

/** Answer the next commit or abort with `reply` bound to what it named. */
function nextPaired(command: string, reply: unknown): void {
  wire.on(command, (a) => boundPair(a, reply));
}

const PREPARED = { doc: DOC, txn: TXN, revision: REV, generation: "1", baseline: null };
let CERT: SelectionCertificate;
beforeAll(async () => {
  CERT = await selectionCertificate("abc", { from: 1, to: 2, insert: "x" });
});

describe("selection certificates", () => {
  it("sends a prepare's certificate verbatim", async () => {
    nextPrepare({ ...PREPARED, certified: true, fallbackReason: null });
    await prepareControlledWrite({ ...input, certificate: CERT });
    expect(JSON.parse(sentPayload())).toMatchObject({ certificate: CERT });
    expect(journalWarn).not.toHaveBeenCalled();
  });

  it("warns when the prepare admitted the write uncertified", async () => {
    nextPrepare({ ...PREPARED, certified: false, fallbackReason: "notTheParent" });
    await prepareControlledWrite({ ...input, certificate: CERT });
    expect(journalWarn).toHaveBeenCalledWith(expect.stringContaining("notTheParent"));
  });

  it("warns when the commit fell back to a barrier, and still answers applied and durable", async () => {
    nextPaired("agent_journal_commit", { doc: DOC, revision: REV, applied: true, durable: true, certified: false, fallbackReason: "notThePostimage" });
    expect(await commitControlledWrite(TXN, "after", PAIR)).toEqual({ doc: DOC, revision: REV, applied: true, durable: true });
    expect(journalWarn).toHaveBeenCalledWith(expect.stringContaining("notThePostimage"));
  });

  it("accepts a commit whose declared script's rotation breaks went over the cap", async () => {
    nextPaired("agent_journal_commit", { doc: DOC, revision: REV, applied: true, durable: true, certified: false, fallbackReason: "overCap" });
    expect(await commitControlledWrite(TXN, "after", PAIR)).toEqual({ doc: DOC, revision: REV, applied: true, durable: true });
    expect(journalWarn).toHaveBeenCalledWith(expect.stringContaining("overCap"));
  });

  it.each([
    ["a missing certified flag", { ...PREPARED, fallbackReason: null }],
    ["an unknown fallback reason", { ...PREPARED, certified: false, fallbackReason: "becauseOfReasons" }],
    ["a certified prepare with a fallback reason", { ...PREPARED, certified: true, fallbackReason: "wholeBreak" }],
  ])("refuses a prepare reply with %s", async (_label, reply) => {
    nextPrepare(reply);
    await expect(prepareControlledWrite(input)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE", uncertain: true });
  });

  it("refuses a commit reply without its certified flag", async () => {
    nextPaired("agent_journal_commit", { doc: DOC, revision: REV, applied: true, durable: true, fallbackReason: null });
    await expect(commitControlledWrite(TXN, "x", PAIR)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });
});

describe("prepareControlledWrite", () => {
  it("sends the request as one JSON string and returns the prepared transaction", async () => {
    nextPrepare({ doc: DOC, txn: TXN, revision: REV, generation: "18446744073709551615", baseline: null, certified: false, fallbackReason: null });
    const p = await prepareControlledWrite(input);
    expect(p.generation).toBe("18446744073709551615");
    const sent: Record<string, unknown> = JSON.parse(sentPayload());
    const { requestId, incarnation, webviewGeneration, pageIdentity } = sent;
    expect(wire.argsOf("agent_journal_prepare")).toEqual([
      { payload: JSON.stringify({ ...input, requestId, incarnation, webviewGeneration, pageIdentity }) },
    ]);
  });

  it("sends a flushed provenance map verbatim as baselineProvenance", async () => {
    nextPrepare({ doc: DOC, txn: TXN, revision: REV, generation: "1", baseline: REV, certified: false, fallbackReason: null });
    const map = stubProvenancePayload({ epoch: "1", basis: "genesis" });
    await prepareControlledWrite({ ...input, baselineProvenance: map });
    expect(JSON.parse(sentPayload())).toMatchObject({ baselineProvenance: map });
  });

  it("sends whether a person touched the buffer as baselineTouched", async () => {
    nextPrepare({ doc: DOC, txn: TXN, revision: REV, generation: "1", baseline: REV, certified: false, fallbackReason: null });
    await prepareControlledWrite({ ...input, baselineTouched: true });
    expect(JSON.parse(sentPayload())).toMatchObject({ baselineTouched: true });
  });

  it("escapes a lone surrogate instead of replacing it, so Rust can refuse it", async () => {
    nextPrepare({ doc: DOC, txn: TXN, revision: REV, generation: "1", baseline: null, certified: false, fallbackReason: null });
    await prepareControlledWrite({ ...input, preimage: "a\uD800" });
    expect(sentPayload()).toContain("a\\ud800");
  });

  it("surfaces a typed refusal as JournalRefusal", async () => {
    wire.on("agent_journal_prepare", (a) => requestAnswer(String(a.payload), "JOURNAL_BUSY", false, { state: "notAdmitted" }).then((e) => Promise.reject(e)));
    await expect(prepareControlledWrite(input)).rejects.toMatchObject({ journalCode: "JOURNAL_BUSY", uncertain: false });
  });

  it.each([
    ["undefined", undefined],
    ["a numeric generation", { doc: DOC, txn: TXN, revision: REV, generation: 7, baseline: null, certified: false, fallbackReason: null }],
    ["a non-canonical generation", { doc: DOC, txn: TXN, revision: REV, generation: "07", baseline: null, certified: false, fallbackReason: null }],
    ["a missing txn", { doc: DOC, revision: REV, generation: "1", baseline: null, certified: false, fallbackReason: null }],
  ])("refuses a malformed reply (%s) as JOURNAL_UNAVAILABLE", async (_label, reply) => {
    nextPrepare(reply);
    const err = await prepareControlledWrite(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JournalRefusal);
    expect((err as JournalRefusal).journalCode).toBe("JOURNAL_UNAVAILABLE");
  });
});

describe("commitControlledWrite", () => {
  it("sends the postimage and returns applied + durable", async () => {
    nextPaired("agent_journal_commit", { doc: DOC, revision: REV, applied: true, durable: false, certified: false, fallbackReason: null });
    const c = await commitControlledWrite(TXN, "after", PAIR);
    expect(c).toEqual({ doc: DOC, revision: REV, applied: true, durable: false });
    expect(invokeMock).toHaveBeenCalledWith("agent_journal_commit", {
      txn: TXN,
      ...PAIR,
      payload: JSON.stringify({ postimage: "after" }),
    });
  });

  it("carries commit extras beside the postimage; an extra never replaces the postimage", async () => {
    nextPaired("agent_journal_commit", { doc: DOC, revision: REV, applied: true, durable: true, certified: false, fallbackReason: null });
    await commitControlledWrite(TXN, "after", PAIR, { review: { hunks: [] }, postimage: "forged" });
    expect(invokeMock).toHaveBeenCalledWith("agent_journal_commit", {
      txn: TXN,
      ...PAIR,
      payload: JSON.stringify({ review: { hunks: [] }, postimage: "after" }),
    });
  });

  it("rejects with a JournalRefusal when the commit is refused", async () => {
    wire.on("agent_journal_commit", () => Promise.reject({ code: "conflict", message: "m", detail: { journalCode: "JOURNAL_DEGRADED" } }));
    await expect(commitControlledWrite(TXN, "x", PAIR)).rejects.toMatchObject({ journalCode: "JOURNAL_DEGRADED" });
  });
});

describe("bound commit and abort replies", () => {
  it.each([
    ["another txn", { txn: "other" }],
    ["another page identity", { pageIdentity: "b".repeat(32) }],
    ["another generation", { webviewGeneration: "4" }],
    ["an extra field", { extra: "1" }],
  ])("a commit reply bound to %s is refused before its fields are read", async (_label, change) => {
    wire.on("agent_journal_commit", (a) => ({ bind: { txn: a.txn, ...PAIR, ...change }, reply: { doc: DOC, revision: REV, applied: true, durable: true, certified: false, fallbackReason: null } }));
    await expect(commitControlledWrite(TXN, "x", PAIR)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });

  it("an unbound commit reply is refused", async () => {
    wire.on("agent_journal_commit", () => ({ doc: DOC, revision: REV, applied: true, durable: true, certified: false, fallbackReason: null }));
    await expect(commitControlledWrite(TXN, "x", PAIR)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });

  it("an abort reply bound to another pair is refused", async () => {
    wire.on("agent_journal_abort", (a) => ({ bind: { txn: a.txn, pageIdentity: "c".repeat(32), webviewGeneration: PAIR.webviewGeneration }, reply: { durable: true } }));
    await expect(abortControlledWrite(TXN, "closed", PAIR)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });
});

describe("abortControlledWrite", () => {
  it.each(["edited", "closed", "composing", "selection", "applyRefused"] as const)(
    "records the %s reason",
    async (reason) => {
      nextPaired("agent_journal_abort", { durable: true });
      expect(await abortControlledWrite(TXN, reason, PAIR)).toEqual({ durable: true });
      expect(invokeMock).toHaveBeenCalledWith("agent_journal_abort", { txn: TXN, ...PAIR, reason });
    },
  );

  it("refuses a malformed abort reply", async () => {
    nextPaired("agent_journal_abort", { durable: "yes" });
    await expect(abortControlledWrite(TXN, "closed", PAIR)).rejects.toBeInstanceOf(JournalRefusal);
  });
});
