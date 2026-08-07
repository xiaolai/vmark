// @vitest-environment node
// #1208 — `workspace.switch_tab` must report the state it can OBSERVE, not the
// state it intended.
//
// The handler used to pass `activated` / `workspaceSwitched` /
// `workspaceInstanceId` straight through from the coordinator's return value
// and only read `activeTabId` back from the store. So a switch that was written
// and a switch that silently no-opped produced byte-identical `{activated:
// true, workspaceSwitched: true}` payloads, which is what the issue reported
// seeing while the window never moved.
import { describe, it, expect, beforeEach, vi } from "vitest";

const { activateTabWithWorkspaceContext } = vi.hoisted(() => ({
  activateTabWithWorkspaceContext: vi.fn(),
}));
vi.mock("@/services/workspaces/activateTabWithWorkspaceContext", () => ({
  activateTabWithWorkspaceContext,
}));
vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));

import { handleWorkspaceSwitchTab } from "@/services/mcpBridge/v2/workspace";
import { respond } from "@/services/mcpBridge/utils";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";

const TAB = "t-b";

function payload(): Record<string, unknown> {
  const call = vi.mocked(respond).mock.calls.at(-1)?.[0] as
    | { data?: Record<string, unknown> }
    | undefined;
  return call?.data ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  useTabStore.setState({
    tabs: { main: [{ id: TAB, title: "b", filePath: "/b.md", kind: "document" }] },
    activeTabId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
});

describe("workspace.switch_tab reports observed state", () => {
  it("reports the instance the window is ACTUALLY showing, not the requested one", async () => {
    // The coordinator claims it switched to wsi-b; the store says otherwise.
    // The payload must side with the store.
    activateTabWithWorkspaceContext.mockReturnValue({
      activated: true,
      workspaceSwitched: true,
      workspaceInstanceId: "wsi-b",
    });

    await handleWorkspaceSwitchTab("1", { tabId: TAB });

    expect(payload().workspaceInstanceId).toBeNull();
    expect(payload().workspaceSwitched).toBe(false);
  });

  it("confirms a switch that really landed", async () => {
    useWorkspaceInstancesStore.setState({
      windows: {
        main: {
          windowLabel: "main",
          workspaceInstanceIds: ["wsi-b"],
          activeWorkspaceInstanceId: "wsi-b",
        },
      },
    });
    activateTabWithWorkspaceContext.mockReturnValue({
      activated: true,
      workspaceSwitched: true,
      workspaceInstanceId: "wsi-b",
    });

    await handleWorkspaceSwitchTab("1", { tabId: TAB });

    expect(payload().workspaceInstanceId).toBe("wsi-b");
    expect(payload().workspaceSwitched).toBe(true);
  });

  it("reports activated only when the tab is the window's active tab afterwards", async () => {
    activateTabWithWorkspaceContext.mockReturnValue({
      activated: true,
      workspaceSwitched: false,
      workspaceInstanceId: null,
    });

    await handleWorkspaceSwitchTab("1", { tabId: TAB });

    // The coordinator said yes; the store never took the activation.
    expect(payload().activated).toBe(false);
    expect(payload().activeTabId).toBeNull();
  });

  it("agrees with the coordinator when the activation did land", async () => {
    activateTabWithWorkspaceContext.mockImplementation(() => {
      useTabStore.setState({ activeTabId: { main: TAB } });
      return { activated: true, workspaceSwitched: false, workspaceInstanceId: null };
    });

    await handleWorkspaceSwitchTab("1", { tabId: TAB });

    expect(payload().activated).toBe(true);
    expect(payload().activeTabId).toBe(TAB);
  });

  it("stays false when the coordinator itself refused", async () => {
    activateTabWithWorkspaceContext.mockReturnValue({
      activated: false,
      workspaceSwitched: false,
      workspaceInstanceId: null,
    });

    await handleWorkspaceSwitchTab("1", { tabId: TAB });

    expect(payload().activated).toBe(false);
  });
});
