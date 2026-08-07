// @vitest-environment node
// #1208 — `session.get_state` must describe what is ON SCREEN, not merely what
// exists in the stores.
//
// The reported symptom was "MCP reports success but the UI never follows": an
// AI client opened a tab, switched to it, got `{activated: true}` back, and
// nothing moved. The payload gave it no way to notice, because:
//   - document tabs carried no `active` flag at all (only browser tabs did), so
//     "which tab is showing?" was unanswerable;
//   - every tab of a window was listed flat, with no indication that a tab
//     belongs to a workspace instance that is not the visible one — the exact
//     state the issue hit, where get_state listed 4 tabs and the strip showed 1;
//   - `focused` was computed as "the window label of the webview answering this
//     request", which is whatever window the Rust router picked, NOT the window
//     the user is looking at. In a single-window session those coincide, which
//     is why it went unnoticed; in a restored multi-window session it is a lie.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { buildSessionState, handleSessionGetState } from "@/services/mcpBridge/v2/session";
import type { DocumentSessionTab } from "@/services/mcpBridge/v2/types";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";

const { respond, resolveFocusedWindowLabel } = vi.hoisted(() => ({
  respond: vi.fn(),
  resolveFocusedWindowLabel: vi.fn(),
}));
vi.mock("@/services/mcpBridge/utils", () => ({ respond }));
vi.mock("@/services/mcpBridge/focusedWindow", () => ({ resolveFocusedWindowLabel }));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

function docTabs(label: string, state = buildSessionState("0.0.0")): DocumentSessionTab[] {
  const win = state.windows.find((w) => w.label === label);
  return (win?.tabs ?? []).filter((t): t is DocumentSessionTab => t.kind !== "browser");
}

/** A real workspace instance rooted at `rootPath`, owned by `main`. */
function seedInstance(id: string, rootPath: string): void {
  const root = createWorkspaceRootIdentity(rootPath, { displayName: id, platform: "macos" });
  if (!root.ok) throw new Error(`test root should be valid: ${rootPath}`);
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({
      workspaceInstanceId: id,
      root: root.root,
      ownerWindowLabel: "main",
      createdFrom: "open",
    }),
  );
}

function seedTab(windowLabel: string, id: string, filePath: string | null): void {
  useTabStore.setState((s) => ({
    tabs: {
      ...s.tabs,
      [windowLabel]: [
        ...(s.tabs[windowLabel] ?? []),
        { id, title: id, filePath, kind: "document" as const },
      ],
    },
  }));
  useDocumentStore.setState((s) => ({
    documents: { ...s.documents, [id]: { content: "", isDirty: false } },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  useDocumentStore.setState({ documents: {} });
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useSettingsStore.setState((s) => ({ general: { ...s.general, workspaceRailMode: false } }));
});

describe("document tabs carry an active flag", () => {
  it("marks exactly the window's active tab", () => {
    seedTab("main", "t1", "/a.md");
    seedTab("main", "t2", "/b.md");
    useTabStore.setState({ activeTabId: { main: "t2" } });

    const tabs = docTabs("main");
    expect(tabs.map((t) => [t.id, t.active])).toEqual([
      ["t1", false],
      ["t2", true],
    ]);
  });

  it("marks none active when the window has no active tab", () => {
    seedTab("main", "t1", "/a.md");
    expect(docTabs("main").every((t) => !t.active)).toBe(true);
  });
});

describe("visibility under the workspace rail", () => {
  it("is true for every tab when the rail is off", () => {
    seedTab("main", "t1", "/a.md");
    seedTab("main", "t2", "/b.md");
    expect(docTabs("main").every((t) => t.visible)).toBe(true);
  });

  it("is false for a tab owned by a workspace instance that is not showing", () => {
    // The #1208 shape: two instances, one visible. Both tabs exist and are
    // activatable; only one is on screen.
    useSettingsStore.setState((s) => ({ general: { ...s.general, workspaceRailMode: true } }));
    seedTab("main", "t-a", "/Users/x/root-a/a.md");
    seedTab("main", "t-b", "/Users/x/root-b/b.md");
    seedInstance("wsi-a", "/Users/x/root-a");
    seedInstance("wsi-b", "/Users/x/root-b");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-a");

    const byId = Object.fromEntries(docTabs("main").map((t) => [t.id, t.visible]));
    expect(byId["t-a"]).toBe(true);
    expect(byId["t-b"]).toBe(false);
  });

  it("reports which workspace instance the window is showing", () => {
    useSettingsStore.setState((s) => ({ general: { ...s.general, workspaceRailMode: true } }));
    seedTab("main", "t-a", "/Users/x/root-a/a.md");
    seedInstance("wsi-a", "/Users/x/root-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-a");

    const win = buildSessionState("0.0.0").windows.find((w) => w.label === "main");
    expect(win?.activeWorkspaceInstanceId).toBe("wsi-a");
  });

  it("reports a null instance when the rail is off", () => {
    seedTab("main", "t1", "/a.md");
    const win = buildSessionState("0.0.0").windows.find((w) => w.label === "main");
    expect(win?.activeWorkspaceInstanceId).toBeNull();
  });
});

describe("focused reflects the real focused window, not the responding one", () => {
  it("marks the window the caller says is focused", () => {
    seedTab("main", "t1", "/a.md");
    seedTab("doc-1", "t2", "/b.md");

    const state = buildSessionState("0.0.0", undefined, "doc-1");
    expect(state.windows.find((w) => w.label === "doc-1")?.focused).toBe(true);
    expect(state.windows.find((w) => w.label === "main")?.focused).toBe(false);
  });

  it("marks NO window focused when the real focused window is not one of ours", () => {
    // A settings window, a browser panel, or another app holds focus. Claiming
    // a document window has it is the lie #1208 was built on.
    seedTab("main", "t1", "/a.md");
    const state = buildSessionState("0.0.0", undefined, "settings");
    expect(state.windows.every((w) => !w.focused)).toBe(true);
  });

  it("falls back to the responding window when the focus is UNKNOWN", () => {
    // Degrades to the historical behaviour rather than reporting nothing —
    // an unresolvable focus must not blind a single-window client.
    seedTab("main", "t1", "/a.md");
    const state = buildSessionState("0.0.0", undefined, undefined);
    expect(state.windows.find((w) => w.label === "main")?.focused).toBe(true);
  });

  it("marks NO window focused when the app itself is in the background", () => {
    // `null` is a RESOLVED answer — no VMark window holds focus — and must not
    // collapse into the unknown-focus fallback, or a backgrounded app would
    // still claim the user is looking at one of its windows.
    seedTab("main", "t1", "/a.md");
    const state = buildSessionState("0.0.0", undefined, null);
    expect(state.windows.every((w) => !w.focused)).toBe(true);
  });
});

describe("the handler asks the platform, not itself", () => {
  it("passes the resolved focused window through to the payload", async () => {
    // The whole fix hinges on this one wiring: if the handler stops consulting
    // the resolver, `focused` silently reverts to "the window that answered".
    resolveFocusedWindowLabel.mockResolvedValue("doc-1");
    seedTab("main", "t1", "/a.md");
    seedTab("doc-1", "t2", "/b.md");

    await handleSessionGetState("req-1", "0.0.0");

    const data = vi.mocked(respond).mock.calls.at(-1)?.[0]?.data as
      | { windows: { label: string; focused: boolean }[] }
      | undefined;
    expect(data?.windows.find((w) => w.label === "doc-1")?.focused).toBe(true);
    expect(data?.windows.find((w) => w.label === "main")?.focused).toBe(false);
  });

  it("degrades to the responding window when the platform cannot answer", async () => {
    resolveFocusedWindowLabel.mockResolvedValue(undefined);
    seedTab("main", "t1", "/a.md");

    await handleSessionGetState("req-2", "0.0.0");

    const data = vi.mocked(respond).mock.calls.at(-1)?.[0]?.data as
      | { windows: { label: string; focused: boolean }[] }
      | undefined;
    expect(data?.windows.find((w) => w.label === "main")?.focused).toBe(true);
  });
});
