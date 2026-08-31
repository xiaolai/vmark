// WI-TS3.2 — the MOUNT-TIME creator goes through the ONE shared auto-create
// gate (D-T8): a hot-exit-restored-visible panel over a refusing scope must
// NOT create (and therefore never spawns a shell into $HOME) — the round-2
// finding. Real stores; only the window label is mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTerminalSessionsInit } from "./useTerminalSessionsInit";
import { resetTerminalSessionStore, useUIStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  createWorkspaceInstance,
  createWorkspaceRootIdentity,
} from "@/utils/workspaceIdentity";
import type { SessionEntry } from "./terminalSessionTypes";

vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

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

function mount() {
  const containerRef = { current: document.createElement("div") };
  const sessionsRef = { current: new Map<string, SessionEntry>() };
  const callbacks = {
    createSession: vi.fn<(id: string) => void>(),
    removeSession: vi.fn<(id: string) => void>(),
    switchToVisible: vi.fn<(id: string | null) => void>(),
  };
  renderHook(() => useTerminalSessionsInit(containerRef, sessionsRef, callbacks));
  return callbacks;
}

beforeEach(() => {
  resetTerminalSessionStore();
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useWorkspaceStore.getState().closeWorkspace();
  setRail(true);
});

afterEach(() => {
  setRail(false);
});

describe("useTerminalSessionsInit — gated mount-time creator (WI-TS3.2)", () => {
  it("refusing scope: creates NOTHING — no session, no xterm instance ($HOME spawn case)", () => {
    // Loose instance + stale legacy workspace-mode: the legacy gate would
    // say yes; the instance-backed gate refuses.
    useWorkspaceInstancesStore.getState().ensureLooseInstance(W);
    useWorkspaceStore.setState({ isWorkspaceMode: true, rootPath: "/stale" });

    const callbacks = mount();

    expect(useUIStore.getState().terminal.sessions).toHaveLength(0);
    expect(callbacks.createSession).not.toHaveBeenCalled();
    expect(callbacks.switchToVisible).not.toHaveBeenCalled();
  });

  it("allowing scope: creates ONE stamped session and shows it", () => {
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");

    const callbacks = mount();

    const sessions = useUIStore.getState().terminal.sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.workspaceInstanceId).toBe("wsi-a");
    expect(callbacks.createSession).toHaveBeenCalledWith(sessions[0]?.id);
    expect(callbacks.switchToVisible).toHaveBeenCalledWith(sessions[0]?.id);
  });

  it("existing sessions (hot-exit shape): instances built for each, no extra create", () => {
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    const s1 = useUIStore.getState().terminalCreateSession()!;
    const s2 = useUIStore.getState().terminalCreateSession()!;

    const callbacks = mount();

    expect(useUIStore.getState().terminal.sessions).toHaveLength(2);
    expect(callbacks.createSession).toHaveBeenCalledTimes(2);
    expect(callbacks.createSession).toHaveBeenCalledWith(s1.id);
    expect(callbacks.createSession).toHaveBeenCalledWith(s2.id);
    expect(callbacks.switchToVisible).toHaveBeenCalledWith(s2.id);
  });
});
