// @vitest-environment node
// WI-AL1.4 — the IPC client for save capture: the request crosses as one JSON string (a lone surrogate reaches Rust escaped), the journaled flag is the closed set yes/pending/no, a malformed reply or a capture failure refusal becomes a JournalRefusal
import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubProvenancePayload } from "@/test/provenancePayloadFixture";

vi.mock("@/services/agentJournal/journalTransport", () => import("@/test/agentJournalWireFake").then((m) => m.callBindingTransportModule()));
import { invoke } from "@tauri-apps/api/core";
import { JournalRefusal } from "../journalRefusal";
import { captureSaveToJournal, type CaptureInput } from "../journalClient";
import { journalActorFor } from "../journalActor";
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";

const invokeMock = vi.mocked(invoke);
const DOC = "0190d3c4-0000-7000-8000-000000000003";
const OBS = "0190d3c4-0000-7000-8000-000000000004";
const REV = "0190d3c4-0000-7000-8000-000000000002";

const input: CaptureInput = {
  docKey: "path:/notes/读书.md",
  window: "main/tab-1",
  observedParent: { ref: "revision", revision: REV },
  postimage: "中文 ✓",
  initiator: { type: "human" },
  author: null,
  claimsRevision: null,
  provenance: null,
};

beforeEach(() => invokeMock.mockReset());

describe("captureSaveToJournal", () => {
  it("sends the request as one JSON string and returns the reply", async () => {
    invokeMock.mockResolvedValueOnce({ doc: DOC, journaled: "yes", observation: OBS, revision: REV });
    const out = await captureSaveToJournal(input);
    expect(out).toEqual({ doc: DOC, journaled: "yes", observation: OBS, revision: REV });
    expect(invokeMock).toHaveBeenCalledWith("agent_journal_capture", { payload: JSON.stringify(input) });
  });

  it("sends the window's provenance payload verbatim", async () => {
    invokeMock.mockResolvedValueOnce({ doc: DOC, journaled: "yes", observation: OBS, revision: REV });
    const provenance = stubProvenancePayload({ epoch: "7", basis: REV });
    await captureSaveToJournal({ ...input, provenance });
    const { payload } = invokeMock.mock.calls[0][1] as { payload: string };
    expect(JSON.parse(payload)).toMatchObject({ provenance });
  });

  it("sends an agent author and a claimed revision as written", async () => {
    invokeMock.mockResolvedValueOnce({ doc: DOC, journaled: "yes", observation: null, revision: REV });
    const author = journalActorFor(TEST_ATTRIBUTION);
    await captureSaveToJournal({ ...input, author, claimsRevision: REV });
    const { payload } = invokeMock.mock.calls[0][1] as { payload: string };
    expect(JSON.parse(payload)).toMatchObject({ author, claimsRevision: REV });
  });

  it("accepts pending and no without a revision, and yes without an observation", async () => {
    invokeMock.mockResolvedValueOnce({ doc: DOC, journaled: "pending", observation: OBS, revision: null });
    expect((await captureSaveToJournal(input)).journaled).toBe("pending");
    invokeMock.mockResolvedValueOnce({ doc: DOC, journaled: "no", observation: OBS, revision: null });
    expect((await captureSaveToJournal(input)).journaled).toBe("no");
    invokeMock.mockResolvedValueOnce({ doc: DOC, journaled: "yes", observation: null, revision: REV });
    expect((await captureSaveToJournal(input)).observation).toBeNull();
  });

  it("escapes a lone surrogate instead of replacing it, so Rust can refuse it", async () => {
    invokeMock.mockResolvedValueOnce({ doc: DOC, journaled: "yes", observation: OBS, revision: REV });
    await captureSaveToJournal({ ...input, postimage: "a\uD800" });
    const { payload } = invokeMock.mock.calls[0][1] as { payload: string };
    expect(payload).toContain("a\\ud800");
  });

  it.each([
    ["an unknown flag", { doc: DOC, journaled: "maybe", observation: OBS, revision: null }],
    ["yes without a revision", { doc: DOC, journaled: "yes", observation: OBS, revision: null }],
    ["pending with a revision", { doc: DOC, journaled: "pending", observation: OBS, revision: REV }],
    ["pending without an observation", { doc: DOC, journaled: "pending", observation: null, revision: null }],
    ["no reply at all", undefined],
  ])("refuses %s as JOURNAL_UNAVAILABLE", async (_, reply) => {
    invokeMock.mockResolvedValueOnce(reply);
    const err = await captureSaveToJournal(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JournalRefusal);
    expect((err as JournalRefusal).journalCode).toBe("JOURNAL_UNAVAILABLE");
  });

  it("reads a rejection as a JournalRefusal with its code", async () => {
    invokeMock.mockRejectedValueOnce({
      code: "invalid-input",
      message: "INVALID_TEXT: lone surrogate",
      detail: { journalCode: "INVALID_TEXT" },
    });
    const err = await captureSaveToJournal(input).catch((e: unknown) => e);
    expect((err as JournalRefusal).journalCode).toBe("INVALID_TEXT");
  });
});
