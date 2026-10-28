// WI-AL1.4 — every successful save is captured in the agent edit journal and the outcome reports journaled yes/pending/no: editor-domain text (not the file's CRLF/BOM bytes), author human vs the initiator that asked, a save during a held prepare reported pending, a capture failure never failing the save, the journal revision handed to the "mcp" history snapshot, and nothing captured for a save that wrote nothing | AL2.2g: the agent writes a save races are driven on the journal fake directly; the window's request protocol is not under test here
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.fsModule();
});
vi.mock("@tauri-apps/api/core", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.coreModule();
});
// Version History is observed at its storage seam: the real save pipeline and
// `saveHistorySnapshot` run, and the snapshot it asks for is recorded here.
const createSnapshot = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined));
vi.mock("@/services/history/historyOperations", () => ({ createSnapshot }));

import { statefulFs } from "@/test/statefulFsFake";
import { ROOT, editDoc, openDocInTab, resetTier0 } from "@/test/tier0/harness";
import { agentJournalFake } from "@/test/agentJournalFake";
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";
import { journalActorFor } from "@/services/agentJournal/journalActor";
import { rememberJournalBasis } from "@/services/agentJournal/documentIdentity";
import { imeToast } from "@/services/ime/imeToast";
import { saveToPath, saveToPathForMcp } from "./saveToPath";
import { __resetSerializer } from "./serializeByPath";
import { resetSaveTargetClaims } from "./saveTargetClaim";

const DOC = `${ROOT}/日记.md`;
const KEY = `path:${DOC}`;
const BOM = "\u{FEFF}";

function captures() {
  return agentJournalFake.captureSaveToJournal.mock.calls.map(([input]) => input);
}

beforeEach(() => {
  resetTier0();
  __resetSerializer();
  resetSaveTargetClaims();
  createSnapshot.mockClear();
  statefulFs.stubCommand("coherence_capture", () => null);
  statefulFs.stubCommand("coherence_head", () => null);
});

afterEach(() => vi.restoreAllMocks());

describe("save capture in the agent edit journal", () => {
  it("records the editor text of a manual save, initiated by the human", async () => {
    const tabId = await openDocInTab(DOC, `${BOM}一\r\n`);
    editDoc(tabId, "一\n二\n");
    expect(await saveToPath(tabId, DOC, "一\n二\n")).toBe(true);
    expect(captures()).toHaveLength(1);
    expect(captures()[0]).toMatchObject({ docKey: KEY, postimage: "一\n二\n", initiator: { type: "human" } });
    expect(agentJournalFake.doc(KEY).text).toBe("一\n二\n");
  });

  it("names autosave as the initiator of an autosave", async () => {
    const tabId = await openDocInTab(DOC, "a\n");
    await saveToPath(tabId, DOC, "ab\n", "auto");
    expect(captures()[0].initiator).toEqual({ type: "system", reason: "autosave" });
  });

  it("reports journaled yes with the revision, and hands it to the mcp history snapshot", async () => {
    const tabId = await openDocInTab(DOC, `${BOM}x\r\n`);
    const outcome = await saveToPathForMcp(tabId, DOC, "x\ny\n", "workspace.save", TEST_ATTRIBUTION);
    expect(outcome).toMatchObject({ ok: true, written: `${BOM}x\r\ny\r\n`, journaled: "yes" });
    expect("journalRevision" in outcome).toBe(false);
    const revision = agentJournalFake.doc(KEY).head;
    expect(revision).not.toBeNull();
    expect(captures()[0].initiator).toEqual(journalActorFor(TEST_ATTRIBUTION));
    expect(createSnapshot).toHaveBeenCalledWith(DOC, `${BOM}x\r\ny\r\n`, "mcp", expect.anything(), revision);
  });

  it("reports pending for a save while another write holds the document", async () => {
    const tabId = await openDocInTab(DOC, "base\n");
    agentJournalFake.holdNextPrepare();
    void agentJournalFake.prepareControlledWrite({
      docKey: KEY, parent: null, preimage: "base\n", actor: journalActorFor(TEST_ATTRIBUTION), tool: "document.write", baselineProvenance: null, baselineTouched: false,
    });
    const outcome = await saveToPathForMcp(tabId, DOC, "base 2\n", "workspace.save", TEST_ATTRIBUTION);
    expect(outcome).toMatchObject({ ok: true, journaled: "pending" });
    expect(createSnapshot).toHaveBeenCalledWith(DOC, "base 2\n", "mcp", expect.anything(), null);
    agentJournalFake.release();
  });

  it("never fails the save when the journal cannot record it, and stays quiet", async () => {
    const tabId = await openDocInTab(DOC, "a\n");
    const toast = vi.spyOn(imeToast, "errorDetail").mockImplementation(() => "id");
    agentJournalFake.setUnavailable(true);
    const outcome = await saveToPathForMcp(tabId, DOC, "b\n", "workspace.save", TEST_ATTRIBUTION);
    expect(outcome).toMatchObject({ ok: true, written: "b\n", journaled: "no" });
    expect(statefulFs.read(DOC)).toBe("b\n");
    expect(toast).not.toHaveBeenCalled();
  });

  it("captures nothing for a save that wrote nothing", async () => {
    const tabId = await openDocInTab(DOC, "a\n");
    statefulFs.failWrites({ code: "io", message: "disk full" });
    vi.spyOn(imeToast, "errorDetail").mockImplementation(() => "id");
    const outcome = await saveToPathForMcp(tabId, DOC, "b\n", "workspace.save", TEST_ATTRIBUTION);
    expect(outcome.ok).toBe(false);
    expect(captures()).toEqual([]);
  });

  it("names the base the saved text was built on, not an agent commit that landed during the disk write", async () => {
    const tabId = await openDocInTab(DOC, "a\n");
    await saveToPathForMcp(tabId, DOC, "ab\n", "workspace.save", TEST_ATTRIBUTION);
    const base = agentJournalFake.doc(KEY).head;
    let finishWrite: (() => void) | null = null;
    statefulFs.stubCommand("atomic_write_file", () => new Promise<void>((resolve) => (finishWrite = resolve)));
    const saving = saveToPath(tabId, DOC, "abc\n");
    await vi.waitFor(() => expect(finishWrite).not.toBeNull());
    const p = await agentJournalFake.prepareControlledWrite({
      docKey: KEY, parent: base, preimage: "ab\n", actor: journalActorFor(TEST_ATTRIBUTION), tool: "document.write", baselineProvenance: null, baselineTouched: false,
    });
    rememberJournalBasis(tabId, KEY, (await agentJournalFake.commitControlledWrite(p.txn, "AGENT\n")).revision);
    finishWrite!();
    expect(await saving).toBe(true);
    expect(captures().at(-1)).toMatchObject({ postimage: "abc\n", observedParent: { ref: "revision", revision: base } });
  });

  it("passes the base on past a save that wrote nothing, so the next save neither waits nor skips it", async () => {
    const tabId = await openDocInTab(DOC, "a\n");
    await saveToPathForMcp(tabId, DOC, "ab\n", "workspace.save", TEST_ATTRIBUTION);
    const base = agentJournalFake.doc(KEY).head;
    vi.spyOn(imeToast, "errorDetail").mockImplementation(() => "id");
    statefulFs.failWrites({ code: "io", message: "disk full" });
    expect(await saveToPath(tabId, DOC, "abc\n")).toBe(false);
    statefulFs.failWrites(null);
    expect(await saveToPath(tabId, DOC, "abcd\n")).toBe(true);
    expect(captures().at(-1)).toMatchObject({ postimage: "abcd\n", observedParent: { ref: "revision", revision: base } });
  });

  it("records document.write's save with the agent as author and its written revision claimed", async () => {
    const tabId = await openDocInTab(DOC, "a\n");
    const p = await agentJournalFake.prepareControlledWrite({
      docKey: KEY, parent: null, preimage: "a\n", actor: journalActorFor(TEST_ATTRIBUTION), tool: "document.write", baselineProvenance: null, baselineTouched: false,
    });
    const written = (await agentJournalFake.commitControlledWrite(p.txn, "写入\n")).revision;
    rememberJournalBasis(tabId, KEY, written);
    const outcome = await saveToPathForMcp(tabId, DOC, "写入\n", "document.write", TEST_ATTRIBUTION);
    expect(outcome).toMatchObject({ ok: true, journaled: "yes" });
    expect(createSnapshot).toHaveBeenLastCalledWith(DOC, "写入\n", "mcp", expect.anything(), written);
    expect(captures().at(-1)).toMatchObject({ author: journalActorFor(TEST_ATTRIBUTION), claimsRevision: written });
  });
});
