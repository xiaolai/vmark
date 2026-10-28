// @vitest-environment node
// WI-AL2.2i — every journal command with no request key is sent with a fresh callId (32 lowercase hex, minted per call) and its reply is read only when it echoes that callId as {bind: {callId}, reply}: a reply bound to another call, unbound, or with a bind field too many is a transport failure (JOURNAL_UNAVAILABLE), checked before any reply parser runs; a callId that cannot be minted makes the journal unavailable and invokes nothing
// WI-AL2.4 — the concurrent pair read (`agent_journal_concurrent_pair`) is call-bound the same way
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.unmock("@/services/agentJournal/journalTransport");
vi.unmock("@/services/agentJournal/epochClient");

import { invoke } from "@tauri-apps/api/core";
import { captureSaveToJournal, type CaptureInput } from "../journalClient";
import { armEpoch, bindDocument, closeEpoch, findDocument, readJournalHead, releaseWindow } from "../epochClient";
import { discardUncommitted, listUncommitted } from "../historyClient";
import { forgetJournalCheckpoints, listJournalCheckpoints, resetJournalCheckpointClient } from "../checkpointClient";
import { listDocumentHistory } from "../docHistoryClient";
import { readConcurrentPair } from "../concurrentPairClient";
import { readJournalHealth } from "../journalStatusClient";
import { exportDocumentToGit } from "../gitExportClient";
import { decideReview } from "../reviewClient";
import { JournalRefusal } from "../journalRefusal";

const invokeMock = vi.mocked(invoke);
const DOC = "0190d3c4-0000-7000-8000-000000000003";
const REV = "0190d3c4-0000-7000-8000-000000000002";
const CALL_ID = /^[0-9a-f]{32}$/;

const capture: CaptureInput = {
  docKey: "path:/读书.md",
  window: "main/t1",
  observedParent: null,
  postimage: "稿",
  initiator: { type: "human" },
  author: null,
  claimsRevision: null,
  provenance: null,
};

const STATUS = { phase: "ready", generation: "9", readOnly: false, degraded: false, liveUpdates: "ready", identity: "durable", uncertifiedFallbacks: 0, registrationCapRefusals: 0, cleanupWorkerFailures: 0 };

/** Each call-bound command: a client call and a reply its parser accepts. */
const CASES: Array<[string, () => Promise<unknown>, unknown]> = [
  ["agent_journal_capture", () => captureSaveToJournal(capture), { doc: DOC, journaled: "yes", observation: null, revision: REV }],
  ["agent_journal_arm_epoch", () => armEpoch("path:/a.md"), { doc: DOC, epoch: "1", head: null, headHash: null }],
  ["agent_journal_close_epoch", () => closeEpoch("path:/a.md", "1"), null],
  ["agent_journal_bind_document", () => bindDocument("path:/a.md", "path:/b.md"), DOC],
  ["agent_journal_find_document", () => findDocument("path:/a.md"), DOC],
  ["agent_journal_head", () => readJournalHead("path:/a.md"), REV],
  ["agent_journal_release_window", () => releaseWindow("main/t1"), null],
  ["agent_journal_discard", () => discardUncommitted("path:/a.md", REV), { durable: true }],
  ["agent_journal_uncommitted", () => listUncommitted("path:/a.md"), []],
  ["agent_journal_checkpoints_forget", () => forgetJournalCheckpoints([]), { forgotten: 0, blobError: null }],
  ["agent_journal_checkpoints", () => listJournalCheckpoints(), []],
  [
    "agent_journal_history",
    () => listDocumentHistory("path:/a.md"),
    { generation: "0", head: null, rows: [], truncated: false, hunks: [], blocked: [], degraded: false },
  ],
  [
    "agent_journal_concurrent_pair",
    () => readConcurrentPair("path:/a.md", REV),
    { observedBefore: "稿", linearBefore: "稿!", result: "稿🎉" },
  ],
  ["agent_journal_status", () => readJournalHealth(), STATUS],
  [
    "agent_journal_git_export",
    () => exportDocumentToGit("path:/a.md", "/repo"),
    { branch: `vmark-journal/${DOC}`, head: null, commitsCreated: 0, syntheticCreated: 0 },
  ],
  [
    "agent_journal_review_decide",
    () => decideReview({ docKey: "path:/a.md", expectedHead: REV, action: "keep", items: [{ hunkId: "h:1", expectedReviewGen: "0" }] }),
    { generation: "1" },
  ],
];

const callIdOf = (args: unknown): unknown => (typeof args === "object" && args !== null && "callId" in args ? args.callId : undefined);

/** Answer every command bound to its own callId; `target` gets `wrong(callId)` instead. */
function answer(target: string, reply: unknown, wrong?: (callId: unknown) => unknown): void {
  invokeMock.mockImplementation(async (cmd, args) => {
    const callId = callIdOf(args);
    const body = cmd === target ? reply : cmd === "agent_journal_status" ? STATUS : null;
    if (cmd === target && wrong) return wrong(callId);
    return { bind: { callId }, reply: body };
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  resetJournalCheckpointClient();
});

afterEach(() => vi.unstubAllGlobals());

describe("a call-bound journal command", () => {
  it.each(CASES)("%s sends a fresh callId and reads the reply it echoes", async (command, run, reply) => {
    answer(command, reply);
    await run();
    await run();
    const ids = invokeMock.mock.calls.filter(([cmd]) => cmd === command).map(([, args]) => callIdOf(args));
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(id).toMatch(CALL_ID);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it.each(CASES)("%s refuses a reply bound to another call before reading it", async (command, run, reply) => {
    answer(command, reply, () => ({ bind: { callId: "f".repeat(32) }, reply }));
    await expect(run()).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });

  it.each(CASES)("%s refuses an unbound reply", async (command, run, reply) => {
    answer(command, reply, () => reply);
    await expect(run()).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });

  it.each(CASES)("%s refuses a bind with a field too many", async (command, run, reply) => {
    answer(command, reply, (callId) => ({ bind: { callId, extra: "x" }, reply }));
    await expect(run()).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });

  it.each(CASES)("%s invokes nothing when no callId can be minted", async (command, run, reply) => {
    answer(command, reply);
    // The status poll ahead of a checkpoint call is the first to mint, so every mint fails.
    vi.stubGlobal("crypto", { ...globalThis.crypto, getRandomValues: () => { throw new Error("no entropy"); } });
    const error: unknown = await run().then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(JournalRefusal);
    expect(error).toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
