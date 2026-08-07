// @vitest-environment node
// WI-14 — vmark.workspace.open error branches + background-activation
// restore edge cases (split-enabled restore, no-previous-active).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { usePaneStore } from "@/stores/paneStore";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));
const readMock = vi.fn<(path: string) => Promise<string>>(async () => "# doc\n");
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (path: string) => readMock(path),
  writeTextFile: vi.fn(async () => undefined),
  exists: vi.fn(async () => false),
}));
const guardMock = vi.fn(async () => ({ allowed: true as const }));
vi.mock("@/services/mcpBridge/bridgePathGuard", () => ({
  checkBridgePath: (path: string) => guardMock(path),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import { respond } from "@/services/mcpBridge/utils";
import { handleWorkspaceOpen } from "@/services/mcpBridge/v2/workspaceOpen";

function lastRespond() {
  const calls = (respond as unknown as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1][0] as {
    success: boolean;
    error?: string;
    data?: Record<string, unknown>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readMock.mockResolvedValue("# doc\n");
  guardMock.mockResolvedValue({ allowed: true });
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  useRevisionStore.setState({ revisions: {} });
  usePaneStore.setState({ byWindow: {} });
});

describe("vmark.workspace.open — error branches (WI-14)", () => {
  it("rejects a non-string filePath", async () => {
    await handleWorkspaceOpen("req-e1", { filePath: 42 });
    expect(lastRespond().success).toBe(false);
    expect(lastRespond().error).toContain("INVALID_PATH");
  });

  it("rejects an empty filePath", async () => {
    await handleWorkspaceOpen("req-e2", { filePath: "" });
    expect(lastRespond().success).toBe(false);
  });

  it("rejects a path the bridge guard denies", async () => {
    guardMock.mockResolvedValue({ allowed: false, reason: "outside workspace" } as never);
    await handleWorkspaceOpen("req-e3", { filePath: "/etc/passwd" });
    expect(lastRespond().success).toBe(false);
    expect(lastRespond().error).toContain("INVALID_PATH");
  });

  it("reports a read failure as INVALID_PATH", async () => {
    readMock.mockRejectedValue(new Error("EACCES"));
    await handleWorkspaceOpen("req-e4", { filePath: "/repo/locked.md" });
    expect(lastRespond().success).toBe(false);
    expect(lastRespond().error).toContain("INVALID_PATH");
  });

  it("first open in an empty window keeps the new tab active (no prev to restore)", async () => {
    await handleWorkspaceOpen("req-e5", { filePath: "/repo/first.md" });
    const data = lastRespond().data as { tabId: string; activationChanged: boolean };
    expect(useTabStore.getState().activeTabId.main).toBe(data.tabId);
    expect(data.activationChanged).toBe(true);
  });

  it("restores the previous active via the FOCUSED PANE when a split is enabled", async () => {
    await handleWorkspaceOpen("req-e6", { filePath: "/repo/one.md" });
    const oneId = (lastRespond().data as { tabId: string }).tabId;
    await handleWorkspaceOpen("req-e7", { filePath: "/repo/two.md" });
    const twoId = (lastRespond().data as { tabId: string }).tabId;
    useTabStore.getState().setActiveTab("main", oneId);
    usePaneStore.getState().openSplit("main", twoId);
    usePaneStore.getState().setFocusedPane("main", "primary");
    expect(useTabStore.getState().activeTabId.main).toBe(oneId);

    await handleWorkspaceOpen("req-e8", { filePath: "/repo/three.md" });

    // Background open under a split: focused pane (and alias) unchanged.
    expect(useTabStore.getState().activeTabId.main).toBe(oneId);
    expect(usePaneStore.getState().getSplit("main").primaryTabId).toBe(oneId);
    expect((lastRespond().data as { activationChanged: boolean }).activationChanged).toBe(false);
  });
});
