// An identity index this build cannot read disables the journal's document
// identity: every identity-dependent journal command (capture, bind, find,
// arm) refuses with JOURNAL_CORRUPT and the index's reason. Saving must not
// depend on it — a save, a Save As of a titled tab and a Save As of an
// untitled tab all reach the disk and report ok, the journal outcome is
// "no", and the recording store shows the refusal for the document instead
// of anything throwing.
//
// The capture runs through the real journal client over `invoke`, answered
// with the exact `CommandError` shape `agent_journal/refusal.rs` produces;
// the epoch client's bind, lookup and arm (the shared fake every module here
// is wired to) reject with that same wire error read by the real parser.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("@/services/agentJournal/journalTransport");
vi.mock("@tauri-apps/plugin-fs", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.fsModule();
});
vi.mock("@tauri-apps/api/core", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.coreModule();
});
const createSnapshot = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined));
vi.mock("@/services/history/historyOperations", () => ({ createSnapshot }));

import { statefulFs } from "@/test/statefulFsFake";
import { ROOT, editDoc, newUntitledTab, openDocInTab, resetTier0 } from "@/test/tier0/harness";
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";
import { imeToast } from "@/services/ime/imeToast";
import { useJournalRecordingStore } from "@/stores/journalRecordingStore";
import { agentJournalEpochFake } from "@/test/agentJournalEpochFake";
import { toJournalRefusal } from "@/services/agentJournal/journalRefusal";
import { noteJournalDocument } from "@/services/agentJournal/documentBinding";
import { resetJournalBases } from "@/services/agentJournal/documentIdentity";
import { provenanceSessionFor, startProvenanceSessions } from "@/services/agentJournal/provenanceSessions";
import { saveToPath, saveToPathForMcp } from "./saveToPath";
import { __resetSerializer } from "./serializeByPath";
import { resetSaveTargetClaims } from "./saveTargetClaim";

const REASON =
  "Document identity index normalization version 99/later is incompatible with this build’s version 2/stored-spelling. " +
  "Journal recording is disabled; the index has not been modified.";
/** `refusal(&TxnError::Corrupt(..))` on the wire. */
const IDENTITY_REFUSAL = { code: "internal", message: REASON, detail: { journalCode: "JOURNAL_CORRUPT" } };

const DOC = `${ROOT}/日记.md`;
const problemFor = (key: string) => useJournalRecordingStore.getState().docs[key]?.problem ?? null;
const calls: string[] = [];
let stopSessions: () => void = () => {};
const fake = agentJournalEpochFake;
let restoreFake: () => void = () => {};

beforeEach(() => {
  resetTier0();
  __resetSerializer();
  resetSaveTargetClaims();
  useJournalRecordingStore.getState().reset();
  calls.length = 0;
  statefulFs.stubCommand("coherence_capture", () => null);
  statefulFs.stubCommand("coherence_head", () => null);
  statefulFs.stubCommand("agent_journal_capture", () => {
    calls.push("capture");
    return Promise.reject(IDENTITY_REFUSAL);
  });
  const refuse = (name: string) => async () => {
    calls.push(name);
    throw toJournalRefusal(IDENTITY_REFUSAL);
  };
  const [bind, find, arm] = [fake.bindDocument.getMockImplementation(), fake.findDocument.getMockImplementation(), fake.armEpoch.getMockImplementation()];
  restoreFake = () => {
    if (bind) fake.bindDocument.mockImplementation(bind);
    if (find) fake.findDocument.mockImplementation(find);
    if (arm) fake.armEpoch.mockImplementation(arm);
  };
  fake.bindDocument.mockImplementation(refuse("bind"));
  fake.findDocument.mockImplementation(refuse("find"));
  fake.armEpoch.mockImplementation(refuse("arm"));
  vi.spyOn(imeToast, "errorDetail").mockImplementation(() => "id");
  stopSessions = startProvenanceSessions();
});

afterEach(() => {
  stopSessions();
  restoreFake();
  resetJournalBases();
  vi.restoreAllMocks();
});

describe("saving while the journal's document identity is disabled", () => {
  it("a save reaches the disk and reports the refusal, not an error", async () => {
    const tabId = await openDocInTab(DOC, "一\n");
    editDoc(tabId, "一\n二\n");
    expect(await saveToPath(tabId, DOC, "一\n二\n")).toBe(true);
    expect(statefulFs.read(DOC)).toBe("一\n二\n");
    expect(calls).toContain("capture");
    expect(problemFor(`path:${DOC}`)).toEqual({ kind: "refused", code: "JOURNAL_CORRUPT" });
  });

  it("an MCP save reaches the disk with journaled no", async () => {
    const tabId = await openDocInTab(DOC, "a\n");
    const outcome = await saveToPathForMcp(tabId, DOC, "b\n", "workspace.save", TEST_ATTRIBUTION);
    expect(outcome).toMatchObject({ ok: true, written: "b\n", journaled: "no" });
    expect(statefulFs.read(DOC)).toBe("b\n");
  });

  it("a Save As of a titled tab reaches the disk; the refused bind is reported on the destination", async () => {
    const tabId = await openDocInTab(DOC, "a\n");
    // The source's document is known, so the bind itself is sent (no lookup first).
    noteJournalDocument(`path:${DOC}`, "0190d3c4-0000-7000-8000-000000000001");
    const target = `${ROOT}/副本.md`;
    expect(await saveToPath(tabId, target, "a\nb\n")).toBe(true);
    expect(statefulFs.read(target)).toBe("a\nb\n");
    expect(statefulFs.read(DOC)).toBe("a\n");
    expect(calls).toContain("bind");
    expect(problemFor(`path:${target}`)).toEqual({ kind: "refused", code: "JOURNAL_CORRUPT" });
    expect(useJournalRecordingStore.getState().unbound[`path:${target}`]).toBe(true);
  });

  it("a Save As of an untitled tab reaches the disk; the refused bind is reported on the destination", async () => {
    const tabId = newUntitledTab();
    editDoc(tabId, "草稿\n");
    const target = `${ROOT}/草稿.md`;
    expect(await saveToPath(tabId, target, "草稿\n")).toBe(true);
    expect(statefulFs.read(target)).toBe("草稿\n");
    expect(calls).toContain("find");
    expect(problemFor(`path:${target}`)).toEqual({ kind: "refused", code: "JOURNAL_CORRUPT" });
    expect(useJournalRecordingStore.getState().unbound[`path:${target}`]).toBe(true);
  });

  it("a refused epoch arm leaves the window uncertified and the save still lands", async () => {
    const tabId = await openDocInTab(DOC, "a\n");
    expect(provenanceSessionFor(tabId)).not.toBeNull();
    editDoc(tabId, "a\nb\n");
    expect(await saveToPath(tabId, DOC, "a\nb\n")).toBe(true);
    expect(statefulFs.read(DOC)).toBe("a\nb\n");
    expect(calls).toContain("arm");
  });
});
