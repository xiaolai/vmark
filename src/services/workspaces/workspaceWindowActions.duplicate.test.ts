import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/stores/documentStore";
import {
  selectWindowWorkspaceState,
  useWorkspaceInstancesStore,
} from "@/stores/workspaceInstancesStore";
import type { WorkspaceTransferPayload } from "@/types/workspaceTransfer";
import {
  ackTransfer,
  addInstance,
  addLooseInstance,
  addTab,
  mockInvoke,
  resetWorkspaceActionTestState,
  setRailMode,
} from "./workspaceWindowActions.testUtils";
import {
  duplicateWorkspaceInstanceToNewWindow,
  moveWorkspaceInstanceToNewWindow,
} from "./workspaceWindowActions";

beforeEach(() => {
  resetWorkspaceActionTestState();
});

describe("workspace window duplicate and loose transfer actions", () => {
  it("moves loose files with independent and untitled tabs after ack", async () => {
    setRailMode(true);
    addLooseInstance("main", "wsi-loose");
    addInstance("main", "wsi-repo", "/repo");
    const looseFileId = addTab("main", "/outside/a.md", "A");
    const looseUntitledId = addTab("main", null, "Untitled");
    const workspaceTabId = addTab("main", "/repo/in.md", "Repo");
    mockInvoke.mockResolvedValueOnce("doc-2");

    const move = moveWorkspaceInstanceToNewWindow("main", "wsi-loose");
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const payload = mockInvoke.mock.calls[0][1].data as WorkspaceTransferPayload;

    expect(payload).toMatchObject({
      operation: "move",
      kind: "loose",
      rootPath: null,
      activeTabId: looseFileId,
    });
    expect(payload.tabs.map((tab) => tab.tabId)).toEqual([looseFileId, looseUntitledId]);

    ackTransfer(payload);
    await expect(move).resolves.toMatchObject({ ok: true });
    expect(useDocumentStore.getState().getDocument(looseFileId)).toBeUndefined();
    expect(useDocumentStore.getState().getDocument(looseUntitledId)).toBeUndefined();
    expect(useDocumentStore.getState().getDocument(workspaceTabId)).toBeDefined();
    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main"))
      .toMatchObject({ workspaceInstanceIds: ["wsi-repo"] });
  });

  it("duplicates loose files while skipping dirty, missing, and untitled tabs", async () => {
    setRailMode(true);
    addLooseInstance("main", "wsi-loose");
    const cleanTabId = addTab("main", "/outside/a.md", "A");
    addTab("main", "/outside/dirty.md", "D", { dirty: true });
    addTab("main", "/outside/missing.md", "M", { missing: true });
    addTab("main", null, "Untitled");
    mockInvoke.mockResolvedValueOnce("doc-3");

    const duplicate = duplicateWorkspaceInstanceToNewWindow("main", "wsi-loose");
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const payload = mockInvoke.mock.calls[0][1].data as WorkspaceTransferPayload;

    expect(payload).toMatchObject({
      operation: "duplicate",
      kind: "loose",
      rootPath: null,
      activeTabId: cleanTabId,
    });
    expect(payload.workspaceInstanceId).not.toBe("wsi-loose");
    expect(payload.tabs.map((tab) => tab.tabId)).toEqual([cleanTabId]);

    ackTransfer(payload, "doc-3");
    await expect(duplicate).resolves.toMatchObject({
      ok: true,
      targetWindowLabel: "doc-3",
      skippedDirtyCount: 1,
      skippedUntitledCount: 1,
      skippedMissingCount: 1,
    });
  });

  it("duplicates only clean file-backed tabs into a new workspace instance", async () => {
    setRailMode(true);
    addInstance("main", "wsi-repo", "/repo");
    const cleanTabId = addTab("main", "/repo/a.md", "A");
    addTab("main", "/repo/dirty.md", "D", { dirty: true });
    addTab("main", null, "Untitled");
    addTab("main", "/repo/missing.md", "M", { missing: true });
    mockInvoke.mockResolvedValueOnce("doc-3");

    const duplicate = duplicateWorkspaceInstanceToNewWindow("main", "wsi-repo");
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const payload = mockInvoke.mock.calls[0][1].data as WorkspaceTransferPayload;

    expect(payload).toMatchObject({
      operation: "duplicate",
      sourceWindowLabel: "main",
      rootPath: "/repo",
      activeTabId: cleanTabId,
    });
    expect(payload.workspaceInstanceId).not.toBe("wsi-repo");
    expect(payload.tabs.map((tab) => tab.filePath)).toEqual(["/repo/a.md"]);

    ackTransfer(payload, "doc-3");
    await expect(duplicate).resolves.toMatchObject({
      ok: true,
      targetWindowLabel: "doc-3",
      skippedDirtyCount: 1,
      skippedUntitledCount: 0,
      skippedMissingCount: 1,
    });
    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main"))
      .toMatchObject({ workspaceInstanceIds: ["wsi-repo"] });
  });

  it("returns a failed duplicate result without skip counts when target ack times out", async () => {
    vi.useFakeTimers();
    setRailMode(true);
    addInstance("main", "wsi-repo", "/repo");
    addTab("main", "/repo/a.md", "A");
    mockInvoke.mockResolvedValueOnce("doc-2");

    const duplicate = duplicateWorkspaceInstanceToNewWindow("main", "wsi-repo", { timeoutMs: 1 });
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(1);

    await expect(duplicate).resolves.toEqual({
      ok: false,
      reason: "timeout",
      targetWindowLabel: "doc-2",
    });
  });
});
