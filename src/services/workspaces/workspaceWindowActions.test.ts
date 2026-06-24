import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import {
  selectWindowWorkspaceState,
  useWorkspaceInstancesStore,
} from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import type { WorkspaceTransferAckPayload, WorkspaceTransferPayload } from "@/types/workspaceTransfer";
import {
  applyClaimedWorkspaceTransfer,
  claimWorkspaceTransferForWindow,
  duplicateWorkspaceInstanceToNewWindow,
  moveWorkspaceInstanceToNewWindow,
} from "./workspaceWindowActions";

const { mockInvoke, mockListen, mockOpenWorkspaceWithConfig } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockListen: vi.fn(),
  mockOpenWorkspaceWithConfig: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main", listen: mockListen }),
}));

function setRailMode(enabled: boolean): void {
  useSettingsStore.setState({
    advanced: { ...useSettingsStore.getState().advanced, workspaceRailMode: enabled },
  });
}

function addInstance(
  windowLabel: string,
  workspaceInstanceId: string,
  rootPath: string,
): void {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("test root should be valid");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({
      workspaceInstanceId,
      root: root.root,
      ownerWindowLabel: windowLabel,
      createdFrom: "open",
    }),
  );
}

function addTab(
  windowLabel: string,
  filePath: string | null,
  content: string,
  options: { dirty?: boolean; readOnly?: boolean; missing?: boolean } = {},
): string {
  const tabId = useTabStore.getState().createTab(windowLabel, filePath);
  useDocumentStore.getState().initDocument(tabId, content, filePath, content);
  if (options.dirty) useDocumentStore.getState().setContent(tabId, `${content}\nchanged`);
  if (options.readOnly) useDocumentStore.getState().setReadOnly(tabId, true);
  if (options.missing) useDocumentStore.getState().markMissing(tabId);
  return tabId;
}

function ackTransfer(payload: WorkspaceTransferPayload, targetWindowLabel = "doc-2"): void {
  const listener = mockListen.mock.calls[0]?.[1] as
    | ((event: { payload: WorkspaceTransferAckPayload }) => void)
    | undefined;
  listener?.({
    payload: {
      requestId: payload.requestId,
      targetWindowLabel,
      workspaceInstanceId: payload.workspaceInstanceId,
    },
  });
}

beforeEach(() => {
  vi.useRealTimers();
  setLocationSearch("");
  setRailMode(false);
  mockInvoke.mockReset();
  mockListen.mockReset();
  mockOpenWorkspaceWithConfig.mockReset();
  mockListen.mockResolvedValue(vi.fn());
  mockOpenWorkspaceWithConfig.mockResolvedValue(null);
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useTabStore.setState({ tabs: {}, activeTabId: {}, closedTabs: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
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
      skippedUntitledCount: 1,
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

    await expect(duplicate).resolves.toEqual({ ok: false, reason: "timeout", targetWindowLabel: "doc-2" });
  });

  it("applies a claimed transfer in the target window and emits ack", async () => {
    setRailMode(true);
    const payload: WorkspaceTransferPayload = {
      requestId: "wst-1",
      operation: "move",
      sourceWindowLabel: "main",
      workspaceInstanceId: "wsi-repo",
      rootId: "path:macos:/repo",
      rootPath: "/repo",
      displayName: "repo",
      activeTabId: "tab-a",
      tabs: [{
        tabId: "tab-a",
        title: "a",
        filePath: "/repo/a.md",
        content: "edited",
        savedContent: "saved",
        isDirty: true,
        readOnly: true,
        isPinned: false,
        formatId: "markdown",
      }],
    };

    await applyClaimedWorkspaceTransfer("doc-2", payload, mockOpenWorkspaceWithConfig);

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/repo", {
      windowLabel: "doc-2",
      workspaceInstanceId: "wsi-repo",
      createdFrom: "dragOut",
    });
    expect(useTabStore.getState().getTabsByWindow("doc-2")).toHaveLength(1);
    expect(useDocumentStore.getState().getDocument("tab-a")).toMatchObject({
      content: "edited",
      savedContent: "saved",
      isDirty: true,
      readOnly: true,
    });
    expect(mockInvoke).toHaveBeenCalledWith("ack_workspace_transfer", {
      data: {
        requestId: "wst-1",
        targetWindowLabel: "doc-2",
        workspaceInstanceId: "wsi-repo",
      },
    });
  });

  it("returns false when a transfer window has no claimable payload", async () => {
    setLocationSearch("?workspaceTransfer=true");
    mockInvoke.mockResolvedValueOnce(null);

    await expect(claimWorkspaceTransferForWindow("doc-2", mockOpenWorkspaceWithConfig))
      .resolves.toBe(false);
  });

  it("claims and applies a workspace transfer payload from a transfer window", async () => {
    setRailMode(true);
    setLocationSearch("?workspaceTransfer=true");
    const payload: WorkspaceTransferPayload = {
      requestId: "wst-claim",
      operation: "duplicate",
      sourceWindowLabel: "main",
      workspaceInstanceId: "wsi-claim",
      rootId: "path:macos:/repo",
      rootPath: "/repo",
      displayName: "repo",
      activeTabId: null,
      tabs: [],
    };
    mockInvoke.mockResolvedValueOnce(payload).mockResolvedValueOnce(undefined);

    await expect(claimWorkspaceTransferForWindow("doc-2", mockOpenWorkspaceWithConfig))
      .resolves.toBe(true);

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/repo", {
      windowLabel: "doc-2",
      workspaceInstanceId: "wsi-claim",
      createdFrom: "duplicate",
    });
  });

  it("ignores claim handling outside workspace transfer windows", async () => {
    await expect(claimWorkspaceTransferForWindow("doc-2", mockOpenWorkspaceWithConfig))
      .resolves.toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("applies a rootless claimed transfer as a placeholder instance", async () => {
    setRailMode(true);
    const payload: WorkspaceTransferPayload = {
      requestId: "wst-rootless",
      operation: "move",
      sourceWindowLabel: "main",
      workspaceInstanceId: "wsi-rootless",
      rootId: null,
      rootPath: null,
      displayName: "Untitled",
      activeTabId: null,
      tabs: [],
    };

    await applyClaimedWorkspaceTransfer("doc-2", payload, mockOpenWorkspaceWithConfig);

    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "doc-2"))
      .toMatchObject({ workspaceInstanceIds: ["wsi-rootless"] });
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

function setLocationSearch(search: string): void {
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { search },
  });
}
