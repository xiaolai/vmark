import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/stores/documentStore";
import {
  selectWindowWorkspaceState,
  useWorkspaceInstancesStore,
} from "@/stores/workspaceInstancesStore";
import type { WorkspaceTransferAckPayload, WorkspaceTransferPayload } from "@/types/workspaceTransfer";
import {
  ackTransfer,
  addInstance,
  addTab,
  mockInvoke,
  mockListen,
  resetWorkspaceActionTestState,
  setRailMode,
} from "./workspaceWindowActions.testUtils";
import {
  moveWorkspaceInstanceToNewWindow,
} from "./workspaceWindowActions";

beforeEach(() => {
  resetWorkspaceActionTestState();
});

describe("workspace window actions", () => {
  it("does nothing while workspace rail mode is disabled", async () => {
    addInstance("main", "wsi-repo", "/repo");

    const result = await moveWorkspaceInstanceToNewWindow("main", "wsi-repo");

    expect(result).toEqual({ ok: false, reason: "disabled" });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main"))
      .toMatchObject({ workspaceInstanceIds: ["wsi-repo"] });
  });

  it("moves a workspace only after the target acknowledges receipt", async () => {
    setRailMode(true);
    addInstance("main", "wsi-repo", "/repo");
    const movedTabId = addTab("main", "/repo/a.md", "A", { dirty: true });
    const otherTabId = addTab("main", "/other/b.md", "B");
    mockInvoke.mockResolvedValueOnce("doc-2");

    const move = moveWorkspaceInstanceToNewWindow("main", "wsi-repo");
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());

    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main"))
      .toMatchObject({ workspaceInstanceIds: ["wsi-repo"] });

    const payload = mockInvoke.mock.calls[0][1].data as WorkspaceTransferPayload;
    expect(payload).toMatchObject({
      operation: "move",
      sourceWindowLabel: "main",
      workspaceInstanceId: "wsi-repo",
      rootPath: "/repo",
      activeTabId: movedTabId,
    });
    expect(payload.tabs.map((tab) => tab.tabId)).toEqual([movedTabId]);
    expect(payload.tabs[0]).toMatchObject({ isDirty: true, readOnly: false });

    ackTransfer(payload);
    await expect(move).resolves.toMatchObject({ ok: true, targetWindowLabel: "doc-2" });
    expect(useDocumentStore.getState().getDocument(movedTabId)).toBeUndefined();
    expect(useDocumentStore.getState().getDocument(otherTabId)).toBeDefined();
    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main"))
      .toMatchObject({ activeWorkspaceInstanceId: expect.stringMatching(/^wsi-placeholder-/) });
  });

  it("uses a caller-provided cleanup callback after acknowledged move", async () => {
    const cleanupTab = vi.fn();
    setRailMode(true);
    addInstance("main", "wsi-repo", "/repo");
    const tabId = addTab("main", "/repo/a.md", "A");
    mockInvoke.mockResolvedValueOnce("doc-2");

    const move = moveWorkspaceInstanceToNewWindow("main", "wsi-repo", { cleanupTab });
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    ackTransfer(mockInvoke.mock.calls[0][1].data as WorkspaceTransferPayload);
    await expect(move).resolves.toMatchObject({ ok: true });

    expect(cleanupTab).toHaveBeenCalledWith(tabId);
    expect(useDocumentStore.getState().getDocument(tabId)).toBeDefined();
  });

  it("keeps the source intact when a move times out before ack", async () => {
    vi.useFakeTimers();
    setRailMode(true);
    addInstance("main", "wsi-repo", "/repo");
    const tabId = addTab("main", "/repo/a.md", "A");
    mockInvoke.mockResolvedValueOnce("doc-2");

    const move = moveWorkspaceInstanceToNewWindow("main", "wsi-repo", { timeoutMs: 25 });
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(25);

    await expect(move).resolves.toEqual({ ok: false, reason: "timeout", targetWindowLabel: "doc-2" });
    expect(useDocumentStore.getState().getDocument(tabId)).toBeDefined();
    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main"))
      .toMatchObject({ workspaceInstanceIds: ["wsi-repo"] });
  });

  it("returns missingInstance while enabled when the instance is unknown", async () => {
    setRailMode(true);

    await expect(moveWorkspaceInstanceToNewWindow("main", "wsi-missing"))
      .resolves.toEqual({ ok: false, reason: "missingInstance" });
  });

  it("returns disabled for an empty instance id even while enabled", async () => {
    setRailMode(true);

    await expect(moveWorkspaceInstanceToNewWindow("main", ""))
      .resolves.toEqual({ ok: false, reason: "disabled" });
  });

  it("keeps source state when creating the target window fails", async () => {
    vi.useFakeTimers();
    setRailMode(true);
    addInstance("main", "wsi-repo", "/repo");
    const tabId = addTab("main", "/repo/a.md", "A");
    mockInvoke.mockRejectedValueOnce(new Error("window failed"));

    const move = moveWorkspaceInstanceToNewWindow("main", "wsi-repo", { timeoutMs: 1 });

    await expect(move).resolves.toEqual({ ok: false, reason: "invokeFailed" });
    await vi.advanceTimersByTimeAsync(1);
    expect(useDocumentStore.getState().getDocument(tabId)).toBeDefined();
    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main"))
      .toMatchObject({ workspaceInstanceIds: ["wsi-repo"] });
  });

  it("closes a non-main source window after its last instance moves", async () => {
    setRailMode(true);
    addInstance("doc-1", "wsi-repo", "/repo");
    addTab("doc-1", "/repo/a.md", "A");
    mockInvoke.mockResolvedValueOnce("doc-2");

    const move = moveWorkspaceInstanceToNewWindow("doc-1", "wsi-repo");
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    ackTransfer(mockInvoke.mock.calls[0][1].data as WorkspaceTransferPayload);
    await expect(move).resolves.toMatchObject({ ok: true });

    expect(mockInvoke).toHaveBeenLastCalledWith("close_window", { label: "doc-1" });
  });

  it("does not attribute file tabs to a rootless placeholder instance", async () => {
    setRailMode(true);
    useWorkspaceInstancesStore.getState().ensurePlaceholderInstance("main", "wsi-rootless");
    addTab("main", "/repo/a.md", "A");
    mockInvoke.mockResolvedValueOnce("doc-2");

    const move = moveWorkspaceInstanceToNewWindow("main", "wsi-rootless");
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const payload = mockInvoke.mock.calls[0][1].data as WorkspaceTransferPayload;

    expect(payload.tabs).toEqual([]);
    ackTransfer(payload);
    await expect(move).resolves.toMatchObject({ ok: true });
  });

  it("ignores mismatched transfer acks before accepting the matching ack", async () => {
    setRailMode(true);
    addInstance("main", "wsi-repo", "/repo");
    addTab("main", "/repo/a.md", "A");
    mockInvoke.mockResolvedValueOnce("doc-2");

    const move = moveWorkspaceInstanceToNewWindow("main", "wsi-repo");
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const payload = mockInvoke.mock.calls[0][1].data as WorkspaceTransferPayload;
    const listener = mockListen.mock.calls[0][1] as (
      event: { payload: WorkspaceTransferAckPayload },
    ) => void;

    listener({
      payload: {
        requestId: "wrong",
        targetWindowLabel: "doc-wrong",
        workspaceInstanceId: "wsi-repo",
      },
    });
    ackTransfer(payload);

    await expect(move).resolves.toMatchObject({ ok: true, targetWindowLabel: "doc-2" });
  });

  it("times out without moving source state when ack listener setup fails", async () => {
    setRailMode(true);
    addInstance("main", "wsi-repo", "/repo");
    addTab("main", "/repo/a.md", "A");
    mockListen.mockRejectedValueOnce(new Error("listen failed"));
    mockInvoke.mockResolvedValueOnce("doc-2");

    await expect(moveWorkspaceInstanceToNewWindow("main", "wsi-repo"))
      .resolves.toEqual({ ok: false, reason: "timeout", targetWindowLabel: "doc-2" });
    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main"))
      .toMatchObject({ workspaceInstanceIds: ["wsi-repo"] });
  });
});
