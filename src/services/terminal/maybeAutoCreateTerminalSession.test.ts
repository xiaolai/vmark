// @vitest-environment node
// WI-TS3.2 — the ONE auto-create gate (D-T8): scope-aware, checked against
// the SYNCHRONOUS instance-backed scope, never the legacy store the async
// refresh owns. Real stores throughout.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { resetTerminalSessionStore, useUIStore } from "@/stores/uiStore";
import {
  createWorkspaceInstance,
  createWorkspaceRootIdentity,
} from "@/utils/workspaceIdentity";
import { canOpenTerminal } from "./terminalGate";
import {
  canAutoCreateInScope,
  maybeAutoCreateTerminalSession,
} from "./maybeAutoCreateTerminalSession";

const W = "main";

function setRail(enabled: boolean): void {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: enabled },
  });
}

function addWorkspace(id: string, rootPath: string): void {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("bad test root");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({
      workspaceInstanceId: id,
      root: root.root,
      ownerWindowLabel: W,
      createdFrom: "open",
    }),
  );
}

const sessions = () => useUIStore.getState().terminal.sessions;

beforeEach(() => {
  resetTerminalSessionStore();
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useWorkspaceStore.getState().closeWorkspace();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  setRail(true);
});

afterEach(() => {
  setRail(false);
});

describe("canAutoCreateInScope (pure gate)", () => {
  it("workspace mode OR a saved active file; neither refuses", () => {
    expect(canAutoCreateInScope({ isWorkspaceMode: true }, false)).toBe(true);
    expect(canAutoCreateInScope({ isWorkspaceMode: false }, true)).toBe(true);
    expect(canAutoCreateInScope({ isWorkspaceMode: false }, false)).toBe(false);
  });
});

describe("maybeAutoCreateTerminalSession (WI-TS3.2)", () => {
  it("empty workspace scope → exactly one session, stamped with the scope", () => {
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");

    expect(maybeAutoCreateTerminalSession(W)).toBe(true);

    expect(sessions()).toHaveLength(1);
    expect(sessions()[0]?.workspaceInstanceId).toBe("wsi-a");
  });

  it("refusing scope with the legacy refresh UNRESOLVED → no create (the case canOpenTerminal cannot gate)", () => {
    // Instance-backed truth: a loose instance — not a workspace, no file.
    useWorkspaceInstancesStore.getState().ensureLooseInstance(W);
    // Legacy store still says workspace-mode: the async refresh has not
    // landed (and never runs after a close). The old gate reads THIS.
    useWorkspaceStore.setState({ isWorkspaceMode: true, rootPath: "/stale-root" });
    expect(canOpenTerminal()).toBe(true); // the legacy gate would say yes…

    expect(maybeAutoCreateTerminalSession(W)).toBe(false); // …and we refuse
    expect(sessions()).toHaveLength(0);
  });

  it("no re-create when the visible scope is non-empty", () => {
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    expect(maybeAutoCreateTerminalSession(W)).toBe(true);

    expect(maybeAutoCreateTerminalSession(W)).toBe(false);
    expect(sessions()).toHaveLength(1);
  });

  it("a HIDDEN scope's sessions do not block creation in an empty scope", () => {
    addWorkspace("wsi-a", "/repo-a");
    addWorkspace("wsi-b", "/repo-b");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-b" });

    expect(maybeAutoCreateTerminalSession(W)).toBe(true);

    expect(sessions()).toHaveLength(2);
    expect(sessions()[1]?.workspaceInstanceId).toBe("wsi-a");
  });

  it("rail off + legacy workspace mode → creates an UNSCOPED session (today's behavior)", () => {
    setRail(false);
    useWorkspaceStore.setState({ isWorkspaceMode: true, rootPath: "/repo-legacy" });

    expect(maybeAutoCreateTerminalSession(W)).toBe(true);

    expect(sessions()).toHaveLength(1);
    expect(Object.keys(sessions()[0] ?? {})).not.toContain("workspaceInstanceId");
  });

  it("no workspace but a saved active file → creates (file-anchored cwd case)", () => {
    setRail(false);
    const tabId = useTabStore.getState().createTab(W, "/notes/saved.md");
    useDocumentStore
      .getState()
      .initDocument(tabId, "x", "/notes/saved.md", { savedContent: "x" });
    useTabStore.getState().setActiveTab(W, tabId);

    expect(maybeAutoCreateTerminalSession(W)).toBe(true);
    expect(sessions()).toHaveLength(1);
  });

  it("no workspace, no saved file → refuses and creates nothing", () => {
    setRail(false);
    expect(maybeAutoCreateTerminalSession(W)).toBe(false);
    expect(sessions()).toHaveLength(0);
  });
});
