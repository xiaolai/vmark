// @vitest-environment node
// Audit 20260831 R2-2 — the ONE remove-session + panel-hide policy:
// onlyIfVisible refuses hidden targets, last-VISIBLE closes hide the panel,
// and a hidden panel is never toggled back on (the journey-35 resurrect).
// Real stores; nothing terminal-side mocked.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { resetTerminalSessionStore, useUIStore } from "@/stores/uiStore";
import {
  createWorkspaceInstance,
  createWorkspaceRootIdentity,
} from "@/utils/workspaceIdentity";
import { removeTerminalSessionWithPanelPolicy } from "./closeTerminalSession";

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

function createOwned(owner?: string): string {
  const created = useUIStore
    .getState()
    .terminalCreateSession(owner ? { ownerInstanceId: owner } : undefined);
  if (!created) throw new Error("cap hit in test setup");
  return created.id;
}

function showPanel(): void {
  if (!useUIStore.getState().terminalVisible) useUIStore.getState().toggleTerminal();
}

const term = () => useUIStore.getState().terminal;

beforeEach(() => {
  resetTerminalSessionStore();
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useWorkspaceStore.getState().closeWorkspace();
  if (useUIStore.getState().terminalVisible) useUIStore.getState().toggleTerminal();
  setRail(true);
  addWorkspace("wsi-a", "/repo-a");
  addWorkspace("wsi-b", "/repo-b");
  useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
});

afterEach(() => {
  setRail(false);
});

describe("removeTerminalSessionWithPanelPolicy", () => {
  it("onlyIfVisible refuses a HIDDEN session — nothing removed, panel untouched", () => {
    const hidden = createOwned("wsi-b"); // active scope is wsi-a
    createOwned("wsi-a");
    showPanel();

    removeTerminalSessionWithPanelPolicy(hidden, { onlyIfVisible: true });

    expect(term().sessions.map((s) => s.id)).toContain(hidden);
    expect(useUIStore.getState().terminalVisible).toBe(true);
  });

  it("without the flag a hidden session IS removed (clean exit) — panel stays", () => {
    const hidden = createOwned("wsi-b");
    createOwned("wsi-a");
    showPanel();

    removeTerminalSessionWithPanelPolicy(hidden);

    expect(term().sessions.map((s) => s.id)).not.toContain(hidden);
    expect(useUIStore.getState().terminalVisible).toBe(true);
  });

  it("closing the last VISIBLE session hides the panel", () => {
    createOwned("wsi-b"); // hidden survivor — must not keep the panel open
    const visible = createOwned("wsi-a");
    showPanel();

    removeTerminalSessionWithPanelPolicy(visible, { onlyIfVisible: true });

    expect(term().sessions.map((s) => s.id)).not.toContain(visible);
    expect(useUIStore.getState().terminalVisible).toBe(false);
  });

  it("never TOGGLES a hidden panel back on (the journey-35 resurrect)", () => {
    const visible = createOwned("wsi-a");
    expect(useUIStore.getState().terminalVisible).toBe(false);

    removeTerminalSessionWithPanelPolicy(visible);

    expect(term().sessions).toHaveLength(0);
    expect(useUIStore.getState().terminalVisible).toBe(false);
  });

  it("fallback-active is picked from the VISIBLE population, never a hidden scope", () => {
    const hidden = createOwned("wsi-b");
    const a1 = createOwned("wsi-a");
    const a2 = createOwned("wsi-a");
    useUIStore.getState().terminalSetActiveSession(a2);
    showPanel();

    removeTerminalSessionWithPanelPolicy(a2, { onlyIfVisible: true });

    expect(term().activeSessionId).toBe(a1);
    expect(term().activeSessionId).not.toBe(hidden);
  });

  it("an unknown session id is a no-op under onlyIfVisible", () => {
    createOwned("wsi-a");
    showPanel();
    const before = term().sessions;

    removeTerminalSessionWithPanelPolicy("term-nope", { onlyIfVisible: true });

    expect(term().sessions).toBe(before);
    expect(useUIStore.getState().terminalVisible).toBe(true);
  });
});
