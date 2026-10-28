// @vitest-environment node
// vmark.document.write against a Save As that lands while the write is in flight. During the prepare: the tab now holds another journal document, so the write aborts as closed and nothing is applied or committed under the old key. After the commit: the save goes to the path the tab holds now, never back to the old one; a tab closed (and perhaps reopened under the same id) is not saved at all.
// And vmark.workspace.save_as against a file created at its destination after the overwrite probe: the real pipeline publishes without replacing, so the save is refused as APPROVAL_REQUIRED and the tab keeps its path.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/services/agentJournal/journalTransport", () =>
  import("@/test/agentJournalWireFake").then((m) => m.journalTransportModule()),
);
// The two boundaries under the real bridgeSave: the path guard and the save
// pipeline both reach Tauri. The pipeline's path argument is where the save went.
vi.mock("@/services/mcpBridge/bridgePathGuard", () => ({
  checkBridgePath: vi.fn(async () => ({ allowed: true })),
}));
// The Tauri surface, for the one test that runs the real pipeline: the
// stateful disk, with atomic writes held at a gate.
vi.mock("@tauri-apps/plugin-fs", async () => (await import("./bridgeWriteGate")).gatedFsModule());
vi.mock("@tauri-apps/api/core", async () => (await import("./bridgeWriteGate")).gatedCoreModule());
vi.mock("@/services/persistence/saveToPath", () => ({
  saveToPathForMcp: vi.fn(async (_tab: string, path: string) => ({ ok: true, written: path, journaled: "yes" })),
}));

import { useTabStore } from "@/stores/tabStore";
import type { DocumentTab } from "@/stores/tabStoreTypes";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { respond } from "@/services/mcpBridge/utils";
import { saveToPathForMcp } from "@/services/persistence/saveToPath";
import { handleDocumentWrite } from "@/services/mcpBridge/v2/document";
import { releaseTabJournal, resetJournalBases } from "@/services/agentJournal/documentIdentity";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";
import { handleWorkspaceSaveAs } from "@/services/mcpBridge/v2/workspaceSaveAs";
import { statefulFs } from "@/test/statefulFsFake";
import { __resetSerializer } from "@/services/persistence/serializeByPath";
import { resetSaveTargetClaims } from "@/services/persistence/saveTargetClaim";
import { useSettingsStore } from "@/stores/settingsStore";
import { writeGate } from "./bridgeWriteGate";

const OLD = "/notes/draft.md";
const NEW = "/notes/最终 版.md";

function seed(): void {
  const tab: DocumentTab = { kind: "document", id: "t1", filePath: OLD, title: "t1", isPinned: false, formatId: "markdown" };
  useTabStore.setState({ tabs: { main: [tab] }, activeTabId: { main: "t1" }, untitledCounter: 0 });
  useDocumentStore.getState().initDocument("t1", "old document\n", OLD);
}

function reply(requestId: string) {
  const call = vi.mocked(respond).mock.calls.find(([r]) => r.id === requestId);
  if (!call) throw new Error(`no reply for ${requestId}`);
  return call[0];
}

const saveAs = () => useDocumentStore.getState().setFilePath("t1", NEW);

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  resetJournalBases();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  writeGate.reset();
  statefulFs.reset();
  __resetSerializer();
  resetSaveTargetClaims();
});

describe("document.write — Save As while the write is in flight", () => {
  it("a Save As during the prepare aborts the write as closed, nothing applied or committed", async () => {
    seed();
    const before = useRevisionStore.getState().getRevision("t1");
    fake.holdNextPrepare();
    const pending = handleDocumentWrite("s1", { content: "AI text\n" }, TEST_WRITE_CONTEXT);
    await vi.waitFor(() => expect(fake.prepareControlledWrite).toHaveBeenCalledTimes(1));
    saveAs();
    fake.release();
    await pending;

    expect(JSON.parse(reply("s1").error ?? "null")).toMatchObject({ error: "ABORTED", reason: "closed" });
    expect(useDocumentStore.getState().documents.t1?.content).toBe("old document\n");
    expect(useRevisionStore.getState().getRevision("t1")).toBe(before);
    expect(fake.log.filter((e) => e.op === "commit")).toEqual([]);
    expect(saveToPathForMcp).not.toHaveBeenCalled();
  });

  it("a Save As during the commit sends the save to the tab's new path, not the old one", async () => {
    seed();
    const commit = fake.commitControlledWrite.getMockImplementation();
    if (!commit) throw new Error("fake commit missing");
    fake.commitControlledWrite.mockImplementationOnce(async (...args) => {
      saveAs();
      return commit(...args);
    });
    await handleDocumentWrite("s2", { content: "AI text\n" }, TEST_WRITE_CONTEXT);

    expect(reply("s2")).toMatchObject({ success: true, data: { applied: true, saved: true } });
    expect(saveToPathForMcp).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveToPathForMcp).mock.calls[0]?.[1]).toBe(NEW);
  });

  it("a tab closed during the commit is not saved to the path it used to hold", async () => {
    seed();
    const commit = fake.commitControlledWrite.getMockImplementation();
    if (!commit) throw new Error("fake commit missing");
    fake.commitControlledWrite.mockImplementationOnce(async (...args) => {
      useDocumentStore.getState().removeDocument("t1");
      return commit(...args);
    });
    await handleDocumentWrite("s-closed", { content: "AI text\n" }, TEST_WRITE_CONTEXT);

    expect(saveToPathForMcp).not.toHaveBeenCalled();
    expect(reply("s-closed")).toMatchObject({ success: true, data: { saved: false } });
    expect((reply("s-closed").data as { save_error?: string }).save_error).toMatch(/closed/);
  });

  it("a tab closed and reopened under the same id during the commit is not saved over the newcomer's file", async () => {
    seed();
    const commit = fake.commitControlledWrite.getMockImplementation();
    if (!commit) throw new Error("fake commit missing");
    fake.commitControlledWrite.mockImplementationOnce(async (...args) => {
      useDocumentStore.getState().removeDocument("t1");
      releaseTabJournal("t1");
      useDocumentStore.getState().initDocument("t1", "another file\n", "/notes/other.md");
      return commit(...args);
    });
    await handleDocumentWrite("s-reopened", { content: "AI text\n" }, TEST_WRITE_CONTEXT);

    expect(saveToPathForMcp).not.toHaveBeenCalled();
    expect(reply("s-reopened")).toMatchObject({ success: true, data: { applied: true, saved: false } });
    expect((reply("s-reopened").data as { save_error?: string }).save_error).toMatch(/closed/);
    expect(useDocumentStore.getState().documents.t1?.content).toBe("another file\n");
  });

  it("without a Save As the save goes to the path the write started on", async () => {
    seed();
    await handleDocumentWrite("s3", { content: "AI text\n" }, TEST_WRITE_CONTEXT);
    expect(vi.mocked(saveToPathForMcp).mock.calls[0]?.[1]).toBe(OLD);
  });
});

describe("workspace.save_as — the destination appears while the save is in flight", () => {
  function autoApprove(): void {
    const s = useSettingsStore.getState();
    useSettingsStore.setState({
      advanced: { ...s.advanced, mcpServer: { ...s.advanced.mcpServer, autoApproveEdits: true } },
    });
  }

  it("is refused as APPROVAL_REQUIRED, keeps the newcomer's bytes and the tab's path", async () => {
    seed();
    autoApprove();
    statefulFs.seed(OLD, "old document\n");
    const real = await vi.importActual<typeof import("@/services/persistence/saveToPath")>(
      "@/services/persistence/saveToPath",
    );
    vi.mocked(saveToPathForMcp).mockImplementationOnce(real.saveToPathForMcp);
    writeGate.hold(NEW);

    const pending = handleWorkspaceSaveAs("sa", { tabId: "t1", filePath: NEW }, TEST_WRITE_CONTEXT);
    await vi.waitFor(() => expect(writeGate.waitingAt(NEW)).toBe(1));
    statefulFs.externalWrite(NEW, "someone else's file\n");
    writeGate.open(NEW);
    await pending;

    const refusal = JSON.parse(reply("sa").error ?? "null") as { error?: string; message?: string } | null;
    expect(refusal).toMatchObject({ error: "APPROVAL_REQUIRED" });
    expect(refusal?.message).toContain("Refusing to overwrite the existing file 最终 版.md");
    expect(statefulFs.read(NEW)).toBe("someone else's file\n");
    expect(useDocumentStore.getState().documents.t1?.filePath).toBe(OLD);
    const tab = useTabStore.getState().tabs.main?.[0];
    expect(tab?.kind === "document" ? tab.filePath : null).toBe(OLD);
  });
});
