// @vitest-environment node
// WI-14 (plan D10) — MCP opens are BACKGROUND: they never change the visible
// tab or workspace; only an explicit switch_tab performs the full context
// switch, and its payload discloses what changed. Split from workspace.test.ts
// (file-size ratchet).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";

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
vi.mock("@/services/mcpBridge/bridgePathGuard", () => ({
  checkBridgePath: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import { respond } from "@/services/mcpBridge/utils";
import { handleWorkspaceOpen, handleWorkspaceSwitchTab } from "@/services/mcpBridge/v2/workspace";

function lastRespond() {
  const calls = (respond as unknown as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1][0] as {
    success: boolean;
    data?: Record<string, unknown>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readMock.mockResolvedValue("# doc\n");
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  useRevisionStore.setState({ revisions: {} });
});

describe("vmark.workspace.open — background semantics (WI-14/D10)", () => {
  it("opening a NEW file does not steal the active tab", async () => {
    await handleWorkspaceOpen("req-bg0", { filePath: "/repo/current.md" });
    const currentId = (lastRespond().data as { tabId: string }).tabId;
    useTabStore.getState().setActiveTab("main", currentId);

    await handleWorkspaceOpen("req-bg1", { filePath: "/repo/background.md" });

    const data = lastRespond().data as Record<string, unknown>;
    expect(data.tabId).toBeTruthy();
    expect(data.workspaceSwitched).toBe(false);
    expect(data.activationChanged).toBe(false);
    expect(useTabStore.getState().activeTabId.main).toBe(currentId);
  });

  it("re-opening an already-open clean file does not steal the active tab either", async () => {
    await handleWorkspaceOpen("req-bg2", { filePath: "/repo/one.md" });
    await handleWorkspaceOpen("req-bg3", { filePath: "/repo/two.md" });
    const twoId = (lastRespond().data as { tabId: string }).tabId;
    useTabStore.getState().setActiveTab("main", twoId);

    await handleWorkspaceOpen("req-bg4", { filePath: "/repo/one.md" });

    expect(useTabStore.getState().activeTabId.main).toBe(twoId);
    expect((lastRespond().data as Record<string, unknown>).activationChanged).toBe(false);
  });
});

describe("vmark.workspace.switch_tab — disclosure payload (WI-14/D10)", () => {
  it("returns activated/workspaceSwitched/activeTabId", async () => {
    useTabStore.setState({
      tabs: {
        main: [
          { id: "a", kind: "document", filePath: null, title: "A", isPinned: false },
          { id: "b", kind: "document", filePath: null, title: "B", isPinned: false },
        ],
      },
      activeTabId: { main: "a" },
      untitledCounter: 0,
    } as never);

    await handleWorkspaceSwitchTab("req-d10", { tabId: "b" });

    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      activated: true,
      workspaceSwitched: false,
      activeTabId: "b",
    });
  });
});
