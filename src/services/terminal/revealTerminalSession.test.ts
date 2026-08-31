// @vitest-environment node
// WI-TS4.2 / audit 20260831 R2-4 — reuse-or-create over the VISIBLE
// population. The membership check is the point (#18): a rail toggle
// sequence can leave activeSessionId pointing at a HIDDEN session, and
// reusing it would paste into a shell the user cannot see. Real stores.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  MAX_TERMINAL_SESSIONS,
  resetTerminalSessionStore,
  useUIStore,
} from "@/stores/uiStore";
import {
  createWorkspaceInstance,
  createWorkspaceRootIdentity,
} from "@/utils/workspaceIdentity";
import {
  createTerminalSessionAt,
  reuseOrCreateTerminalSession,
} from "./revealTerminalSession";

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

describe("reuseOrCreateTerminalSession", () => {
  it("reuses a VISIBLE active session and reveals the panel", () => {
    const a1 = createOwned("wsi-a");
    expect(reuseOrCreateTerminalSession()).toBe(a1);
    expect(term().activeSessionId).toBe(a1);
    expect(useUIStore.getState().terminalVisible).toBe(true);
  });

  it("falls back past a STALE HIDDEN active to the first visible session (R2-4)", () => {
    const a1 = createOwned("wsi-a");
    const b1 = createOwned("wsi-b"); // hidden — wsi-a is active
    useUIStore.getState().terminalSetActiveSession(b1); // the stale state

    const chosen = reuseOrCreateTerminalSession();

    expect(chosen).toBe(a1);
    // The fallback is ACTIVATED, so the command lands in the session on screen.
    expect(term().activeSessionId).toBe(a1);
  });

  it("creates an owner-stamped session over an empty visible scope", () => {
    createOwned("wsi-b"); // hidden; the visible scope is empty
    const chosen = reuseOrCreateTerminalSession();
    const created = term().sessions.find((s) => s.id === chosen);
    expect(created?.workspaceInstanceId).toBe("wsi-a");
    expect(term().activeSessionId).toBe(chosen);
    expect(useUIStore.getState().terminalVisible).toBe(true);
  });
});

describe("createTerminalSessionAt", () => {
  it("creates a new pinned session even when one is active, stamped to the scope", () => {
    const a1 = createOwned("wsi-a");
    const id = createTerminalSessionAt("/w/pkg");
    expect(id).not.toBeNull();
    expect(id).not.toBe(a1);
    const created = term().sessions.find((s) => s.id === id);
    expect(created?.requestedCwd).toBe("/w/pkg");
    expect(created?.workspaceInstanceId).toBe("wsi-a");
    expect(useUIStore.getState().terminalVisible).toBe(true);
  });

  it("returns null at the creation-union cap and does not reveal the panel", () => {
    for (let i = 0; i < MAX_TERMINAL_SESSIONS; i++) createOwned("wsi-a");
    expect(createTerminalSessionAt("/w/pkg")).toBeNull();
    expect(useUIStore.getState().terminalVisible).toBe(false);
  });
});
