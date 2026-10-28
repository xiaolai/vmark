// @vitest-environment node
// WI-AL1.6 — the history panel's IPC client: a restore prepare sends one JSON string and returns the text to apply (with the overwritten buffer's baseline and the uncommitted entry it resolves); uncommitted entries are listed with their preview and discarded by document key; malformed replies and refusals become JournalRefusal; the restore prepare runs as a request with a frozen payload and a bound reply (WI-AL2.2g)
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/agentJournal/journalTransport", () => import("@/test/agentJournalWireFake").then((m) => m.callBindingTransportModule()));

import { invoke } from "@tauri-apps/api/core";
import { JournalRefusal } from "../journalRefusal";
import { discardUncommitted, listUncommitted, restorePrepare, type RestorePrepareInput } from "../historyClient";
import { runPrepareRequest } from "../journalRequest";
import { resetPageRegistration } from "../pageRegistration";
import { boundPrepare, digestOf, requestAnswer, scriptWire } from "./journalWire";

const invokeMock = vi.mocked(invoke);
const TXN = "0190d3c4-0000-7000-8000-000000000001";
const REV = "0190d3c4-0000-7000-8000-000000000002";
const DOC = "0190d3c4-0000-7000-8000-000000000003";

const input: RestorePrepareInput = {
  docKey: "path:/a.md",
  parent: REV,
  preimage: "unsaved 𝒳",
  source: { from: "uncommittedPreimage", txn: TXN },
  baselineProvenance: null,
  baselineTouched: false,
};

const prepared = { doc: DOC, txn: TXN, revision: REV, generation: "18446744073709551615", baseline: REV, text: "", resolves: TXN };

beforeEach(() => {
  resetPageRegistration();
  wire = scriptWire();
});

type Wire = ReturnType<typeof scriptWire>;
let wire: Wire;
const RESTORE = "agent_journal_restore_prepare";

/** Run one restore prepare request; its prepared restore, or its refusal thrown. */
async function prepareRestore(fields: RestorePrepareInput) {
  const run = await runPrepareRequest({ build: () => restorePrepare(fields) });
  if (!run.ok) throw run.refusal;
  run.finish();
  return run.prepared;
}

describe("restorePrepare", () => {
  it("a restore sends a frozen payload and checks its bound reply", async () => {
    wire.on(RESTORE, (a) => boundPrepare(String(a.payload), prepared));
    const p = await prepareRestore(input);
    const [sent] = wire.payloadsOf(RESTORE);
    const fields: Record<string, unknown> = JSON.parse(sent);
    const { requestId, incarnation, webviewGeneration, pageIdentity } = fields;
    expect(wire.argsOf(RESTORE)).toEqual([{ payload: JSON.stringify({ ...input, requestId, incarnation, webviewGeneration, pageIdentity }) }]);
    expect(pageIdentity).toBe(wire.argsOf("agent_journal_register_page")[0].pageIdentity);
    expect(p).toEqual(prepared);
  });

  it("a restore reply bound to another request is not trusted", async () => {
    wire.on(RESTORE, async (a) => ({ bind: { requestId: "other", digest: await digestOf(String(a.payload)) }, reply: prepared }));
    await expect(prepareRestore(input)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE", uncertain: true });
    expect(wire.payloadsOf("agent_journal_abandon")).toEqual([wire.payloadsOf(RESTORE)[0]]);
  });

  it("accepts an empty text to restore and no baseline", async () => {
    wire.on(RESTORE, (a) => boundPrepare(String(a.payload), { ...prepared, baseline: null, resolves: null }));
    expect(await prepareRestore(input)).toMatchObject({ text: "", baseline: null, resolves: null });
  });

  it.each([
    ["a missing text", { ...prepared, text: undefined }],
    ["a numeric generation", { ...prepared, generation: 3 }],
    ["a non-decimal generation", { ...prepared, generation: "03" }],
    ["a malformed resolves", { ...prepared, resolves: 5 }],
    ["null", null],
  ])("refuses %s as JOURNAL_UNAVAILABLE", async (_label, reply) => {
    wire.on(RESTORE, (a) => boundPrepare(String(a.payload), reply));
    await expect(prepareRestore(input)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });

  it("reads a rejection as a JournalRefusal", async () => {
    wire.on(RESTORE, (a) => requestAnswer(String(a.payload), "STALE_PARENT", false, { state: "notAdmitted" }).then((e) => Promise.reject(e)));
    const err = await prepareRestore(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JournalRefusal);
    expect(err).toMatchObject({ journalCode: "STALE_PARENT", uncertain: false });
  });
});

describe("listUncommitted", () => {
  const row = {
    txn: TXN,
    actor: { type: "mcp", principal: { state: "anonymous" }, connectionId: "c1", sessionLabel: "claude" },
    tool: "document.write",
    seq: "7",
    preview: "長".repeat(120),
    complete: false,
  };

  it("lists a document's uncommitted entries with the agent's full attribution (WI-AL1.7)", async () => {
    invokeMock.mockResolvedValueOnce([row, { ...row, txn: REV, actor: { type: "human" }, preview: "", complete: true }]);
    const rows = await listUncommitted("path:/a.md");
    expect(invokeMock).toHaveBeenCalledWith("agent_journal_uncommitted", { payload: JSON.stringify({ docKey: "path:/a.md" }) });
    expect(rows).toEqual([
      {
        txn: TXN,
        actor: { type: "mcp", principal: { state: "anonymous" }, connectionId: "c1", sessionLabel: "claude", displayName: null },
        tool: "document.write",
        seq: "7",
        preview: row.preview,
        complete: false,
      },
      { txn: REV, actor: { type: "human" }, tool: "document.write", seq: "7", preview: "", complete: true },
    ]);
  });

  it("returns an empty list for a document with none", async () => {
    invokeMock.mockResolvedValueOnce([]);
    expect(await listUncommitted("tab:main/t1")).toEqual([]);
  });

  it.each([
    ["not an array", { rows: [] }],
    ["a numeric seq", [{ ...row, seq: 7 }]],
    ["a missing txn", [{ ...row, txn: "" }]],
    ["a non-boolean complete", [{ ...row, complete: "no" }]],
    ["an unknown actor type", [{ ...row, actor: { type: "robot" } }]],
  ])("refuses %s as JOURNAL_UNAVAILABLE", async (_label, reply) => {
    invokeMock.mockResolvedValueOnce(reply);
    await expect(listUncommitted("path:/a.md")).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });
});

describe("discardUncommitted", () => {
  it("discards by document key and transaction", async () => {
    invokeMock.mockResolvedValueOnce({ durable: true });
    expect(await discardUncommitted("path:/a.md", TXN)).toEqual({ durable: true });
    expect(invokeMock).toHaveBeenCalledWith("agent_journal_discard", { payload: JSON.stringify({ docKey: "path:/a.md", txn: TXN }) });
  });

  it("refuses a malformed reply", async () => {
    invokeMock.mockResolvedValueOnce({});
    await expect(discardUncommitted("path:/a.md", TXN)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });
});
