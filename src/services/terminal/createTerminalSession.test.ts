// @vitest-environment node
// WI-TS1.1 / audit 20260831 R2-1 — the ONE owner-aware creation service:
// canCreateTerminalSessionHere must agree with createTerminalSessionInScope
// in EVERY resolvable state (a UI gate that says yes while creation says no
// renders a live "+" that does nothing). Real stores; nothing mocked.
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
  beginWindowContextRestore,
  endWindowContextRestore,
} from "@/services/workspaces/switchWorkspaceInstance";
import {
  canCreateTerminalSessionHere,
  createTerminalSessionInScope,
} from "./createTerminalSession";

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
  setRail(true);
});

afterEach(() => {
  endWindowContextRestore(W);
  setRail(false);
});

describe("createTerminalSessionInScope — owner stamping (D-T1)", () => {
  it("stamps the active workspace instance's id", () => {
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    const created = createTerminalSessionInScope(W);
    expect(created?.workspaceInstanceId).toBe("wsi-a");
  });

  it("leaves the session window-scoped with the rail off (carve-out 3)", () => {
    setRail(false);
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    const created = createTerminalSessionInScope(W);
    expect(created?.workspaceInstanceId).toBeUndefined();
  });

  it("leaves the session window-scoped on a placeholder (carve-out 1)", () => {
    useWorkspaceInstancesStore
      .getState()
      .ensurePlaceholderInstance(W, "wsi-placeholder-1");
    const created = createTerminalSessionInScope(W);
    expect(created?.workspaceInstanceId).toBeUndefined();
  });

  it("leaves the session window-scoped mid-restore (carve-out 2)", () => {
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    beginWindowContextRestore(W);
    const created = createTerminalSessionInScope(W);
    expect(created?.workspaceInstanceId).toBeUndefined();
  });

  it("threads requestedCwd through to the created session", () => {
    const created = createTerminalSessionInScope(W, { requestedCwd: "/w/pkg" });
    expect(created?.requestedCwd).toBe("/w/pkg");
  });
});

describe("predicate/action parity (R2-1)", () => {
  /** Assert canCreate ⇔ (create succeeds), rolling the trial session back. */
  function expectParity(expected: boolean): void {
    expect(canCreateTerminalSessionHere(W)).toBe(expected);
    const created = createTerminalSessionInScope(W);
    expect(created !== null).toBe(expected);
    if (created) useUIStore.getState().terminalRemoveSession(created.id);
  }

  it("agrees below and at the cap in a plain workspace scope", () => {
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    for (let i = 0; i < MAX_TERMINAL_SESSIONS - 1; i++) {
      expect(createTerminalSessionInScope(W)).not.toBeNull();
    }
    expectParity(true);
    // Fill the last slot for real, then both must refuse.
    expect(createTerminalSessionInScope(W)).not.toBeNull();
    expectParity(false);
  });

  it("a hidden scope's sessions do not consume this scope's headroom", () => {
    addWorkspace("wsi-a", "/repo-a");
    addWorkspace("wsi-b", "/repo-b");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-b");
    for (let i = 0; i < MAX_TERMINAL_SESSIONS; i++) {
      expect(createTerminalSessionInScope(W)).not.toBeNull();
    }
    expectParity(false); // wsi-b itself is full…
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    expectParity(true); // …but wsi-a has full headroom.
  });

  it("window-scoped sessions count against every scope (the visible union)", () => {
    setRail(false);
    for (let i = 0; i < MAX_TERMINAL_SESSIONS; i++) {
      expect(createTerminalSessionInScope(W)).not.toBeNull();
    }
    setRail(true);
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    // All five are window-scoped ⇒ visible in wsi-a's union ⇒ full.
    expectParity(false);
  });

  it("an unscoped creation (rail off) counts ALL sessions", () => {
    // Seed a stamped session while scoped, then turn the rail off: the
    // unscoped union counts it (creationUnion's documented equivalence only
    // claims stamped sessions cannot exist in the REACHABLE unscoped states —
    // this pins the conservative behavior for the unreachable one).
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    for (let i = 0; i < MAX_TERMINAL_SESSIONS; i++) {
      expect(createTerminalSessionInScope(W)).not.toBeNull();
    }
    setRail(false);
    expect(sessions()).toHaveLength(MAX_TERMINAL_SESSIONS);
    expectParity(false);
  });
});
