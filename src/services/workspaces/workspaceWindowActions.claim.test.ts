import { beforeEach, describe, expect, it } from "vitest";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import {
  selectWindowWorkspaceState,
  useWorkspaceInstancesStore,
} from "@/stores/workspaceInstancesStore";
import type { WorkspaceTransferPayload } from "@/types/workspaceTransfer";
import {
  mockInvoke,
  mockOpenWorkspaceWithConfig,
  resetWorkspaceActionTestState,
  setLocationSearch,
  setRailMode,
} from "./workspaceWindowActions.testUtils";
import {
  applyClaimedWorkspaceTransfer,
  claimWorkspaceTransferForWindow,
} from "./workspaceWindowActions";

beforeEach(() => {
  resetWorkspaceActionTestState();
});

describe("workspace transfer claim handling", () => {
  it("applies a claimed workspace transfer in the target window and emits ack", async () => {
    setRailMode(true);
    const payload: WorkspaceTransferPayload = {
      requestId: "wst-1",
      operation: "move",
      sourceWindowLabel: "main",
      workspaceInstanceId: "wsi-repo",
      kind: "workspace",
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

  it("applies a claimed loose transfer as a loose target context", async () => {
    setRailMode(true);
    const payload: WorkspaceTransferPayload = {
      requestId: "wst-loose",
      operation: "move",
      sourceWindowLabel: "main",
      workspaceInstanceId: "wsi-loose",
      kind: "loose",
      rootId: null,
      rootPath: null,
      displayName: "Loose Files",
      activeTabId: "tab-loose",
      tabs: [{
        tabId: "tab-loose",
        title: "outside",
        filePath: "/outside/a.md",
        content: "edited",
        savedContent: "saved",
        isDirty: true,
        readOnly: false,
        isPinned: false,
        formatId: "markdown",
      }],
    };

    await applyClaimedWorkspaceTransfer("doc-2", payload, mockOpenWorkspaceWithConfig);

    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "doc-2"))
      .toMatchObject({ workspaceInstanceIds: ["wsi-loose"] });
    expect(useWorkspaceInstancesStore.getState().instances["wsi-loose"]).toMatchObject({
      kind: "loose",
      rootPath: null,
    });
    expect(useTabStore.getState().activeTabId["doc-2"]).toBe("tab-loose");
    expect(mockInvoke).toHaveBeenCalledWith("ack_workspace_transfer", {
      data: {
        requestId: "wst-loose",
        targetWindowLabel: "doc-2",
        workspaceInstanceId: "wsi-loose",
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
      kind: "workspace",
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

  it("retries the ack when the first ack invoke fails (no stranded move)", async () => {
    setRailMode(true);
    const payload: WorkspaceTransferPayload = {
      requestId: "wst-retry",
      operation: "move",
      sourceWindowLabel: "main",
      workspaceInstanceId: "wsi-retry",
      kind: "workspace",
      rootId: "path:macos:/repo",
      rootPath: "/repo",
      displayName: "repo",
      activeTabId: null,
      tabs: [],
    };
    // First ack invoke rejects (transient), second succeeds.
    mockInvoke
      .mockRejectedValueOnce(new Error("emit failed"))
      .mockResolvedValueOnce(undefined);

    await applyClaimedWorkspaceTransfer("doc-2", payload, mockOpenWorkspaceWithConfig);

    const ackCalls = mockInvoke.mock.calls.filter(
      (call) => call[0] === "ack_workspace_transfer",
    );
    expect(ackCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("applies a rootless claimed transfer as a placeholder instance", async () => {
    setRailMode(true);
    const payload: WorkspaceTransferPayload = {
      requestId: "wst-rootless",
      operation: "move",
      sourceWindowLabel: "main",
      workspaceInstanceId: "wsi-rootless",
      kind: "placeholder",
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
});
