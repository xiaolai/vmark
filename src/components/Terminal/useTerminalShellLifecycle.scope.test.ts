/**
 * WI-TS2.1 — the post-spawn catch-up cd is owner-guarded (plan 20260831,
 * D-T4 third… fourth cd site: a workspace switch that lands while a scoped
 * session's shell is still spawning must not cd it to the new scope's root).
 * WI-TS3.3 — clean exit computes "last session" on the VISIBLE population
 * (D-T7): a hidden scope's live sessions neither hold the panel open nor get
 * activated by the close fallback.
 * WI-TS4.1 — the spawn env root reaches spawnPty as a parameter, resolved
 * once pre-await from the OWNER scope (D-T9's mid-spawn race, L5 seam).
 * Harness mirrors useTerminalShellLifecycle.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTerminalShellLifecycle } from "./useTerminalShellLifecycle";
import { useUIStore, resetTerminalSessionStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { spawnPty, resolveTerminalWorkspaceRoot } from "./spawnPty";
import type { SessionEntry } from "./terminalSessionTypes";
import type { TerminalInstance } from "./createTerminalInstance";
import type { IPty } from "@/lib/pty";

vi.mock("./spawnPty", () => ({
  spawnPty: vi.fn(),
  resolveTerminalCwd: vi.fn(() => "/tmp"),
  resolveActiveFileCwd: vi.fn(() => undefined),
  resolveTerminalWorkspaceRoot: vi.fn(() => null),
}));

function makeEntry(): SessionEntry {
  const instance = {
    term: { write: vi.fn(), clear: vi.fn() },
    resetDisplay: () => {},
    getCwd: () => null,
    getCommands: () => [],
    isShellBusy: () => false,
    dispose: () => {},
  } as unknown as TerminalInstance;
  return {
    instance,
    pty: null,
    ptyRefForKeys: { current: null },
    spawnedCwd: undefined,
    shellStarted: false,
    shellExited: false,
    shellSpawning: false,
    disposed: false,
    spawnGen: 0,
    pendingRafId: null,
  };
}

function setRail(enabled: boolean): void {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: enabled },
  });
}

/** Spawn with the workspace root CHANGING mid-spawn: a → b. The flip happens
 *  INSIDE the mocked spawn, exactly where a real rail switch would land —
 *  every pre-await read sees /root/a, every post-await read sees /root/b. */
async function spawnAcrossRootChange(sessionId: string): Promise<IPty> {
  const pty = { write: vi.fn(), resize: vi.fn(), kill: vi.fn() } as unknown as IPty;
  vi.mocked(resolveTerminalWorkspaceRoot).mockReturnValue("/root/a");
  vi.mocked(spawnPty).mockImplementation(async () => {
    vi.mocked(resolveTerminalWorkspaceRoot).mockReturnValue("/root/b");
    return pty;
  });

  const entry = makeEntry();
  const sessionsRef = { current: new Map([[sessionId, entry]]) };
  const { result } = renderHook(() => useTerminalShellLifecycle(sessionsRef));
  await act(async () => {
    await result.current.startShell(sessionId);
  });
  return pty;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTerminalSessionStore();
  setRail(true);
});

afterEach(() => {
  setRail(false);
});

describe("WI-TS2.1 — post-spawn catch-up cd is owner-guarded", () => {
  it("does NOT cd a scoped session when the workspace changed mid-spawn", async () => {
    const id = useUIStore
      .getState()
      .terminalCreateSession({ ownerInstanceId: "wsi-a" })!.id;

    const pty = await spawnAcrossRootChange(id);

    expect(pty.write).not.toHaveBeenCalled();
  });

  it("still cd's a window-scoped session (behavior unchanged)", async () => {
    const id = useUIStore.getState().terminalCreateSession()!.id;

    const pty = await spawnAcrossRootChange(id);

    expect(pty.write).toHaveBeenCalledWith("\x15cd '/root/b'\n");
  });

  it("rail OFF: a stamped session is followable again (D-T15 inert stamps)", async () => {
    const id = useUIStore
      .getState()
      .terminalCreateSession({ ownerInstanceId: "wsi-a" })!.id;
    setRail(false);

    const pty = await spawnAcrossRootChange(id);

    expect(pty.write).toHaveBeenCalledWith("\x15cd '/root/b'\n");
  });
});

describe("WI-TS3.3 — clean exit computes last-ness on the VISIBLE population", () => {
  async function startAndExitCleanly(sessionId: string): Promise<void> {
    let onExit: ((code: number) => void) | undefined;
    vi.mocked(spawnPty).mockImplementation(async (opts) => {
      onExit = opts.onExit;
      return { write: vi.fn(), resize: vi.fn(), kill: vi.fn() } as unknown as IPty;
    });
    vi.mocked(resolveTerminalWorkspaceRoot).mockReturnValue(undefined);
    const entry = makeEntry();
    const sessionsRef = { current: new Map([[sessionId, entry]]) };
    const { result } = renderHook(() => useTerminalShellLifecycle(sessionsRef));
    await act(async () => {
      await result.current.startShell(sessionId);
    });
    if (!onExit) throw new Error("spawnPty was not called");
    act(() => onExit?.(0));
  }

  it("last VISIBLE session exits cleanly → panel hides while a hidden scope keeps its sessions", async () => {
    const sa = useUIStore
      .getState()
      .terminalCreateSession({ ownerInstanceId: "wsi-a" })!;
    const sb = useUIStore
      .getState()
      .terminalCreateSession({ ownerInstanceId: "wsi-b" })!;
    useUIStore.setState({ terminalVisible: true });
    useUIStore.getState().terminalSetActiveSession(sa.id);
    // Active scope is wsi-a (no instances store in this harness — the
    // resolver sees no active instance, so visible = window-scoped ∪ null).
    // Force determinism: activate wsi-a's scope via the instances store.
    const { useWorkspaceInstancesStore } = await import(
      "@/stores/workspaceInstancesStore"
    );
    const { createWorkspaceInstance, createWorkspaceRootIdentity } = await import(
      "@/utils/workspaceIdentity"
    );
    const root = createWorkspaceRootIdentity("/repo-a", { platform: "macos" });
    if (!root.ok) throw new Error("bad test root");
    useWorkspaceInstancesStore.getState().addWorkspaceInstance(
      createWorkspaceInstance({
        workspaceInstanceId: "wsi-a",
        root: root.root,
        ownerWindowLabel: "main",
        createdFrom: "open",
      }),
    );
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-a");

    await startAndExitCleanly(sa.id);

    // sa closed; panel hidden (it was the last VISIBLE session)…
    expect(useUIStore.getState().terminalVisible).toBe(false);
    // …while the hidden scope's session survives untouched.
    expect(useUIStore.getState().terminal.sessions.map((s) => s.id)).toEqual([
      sb.id,
    ]);
    expect(useUIStore.getState().terminal.activeSessionId).toBeNull();
  });

  it("non-last visible session exits → panel stays; fallback stays visible", async () => {
    const { useWorkspaceInstancesStore } = await import(
      "@/stores/workspaceInstancesStore"
    );
    const { createWorkspaceInstance, createWorkspaceRootIdentity } = await import(
      "@/utils/workspaceIdentity"
    );
    const root = createWorkspaceRootIdentity("/repo-a", { platform: "macos" });
    if (!root.ok) throw new Error("bad test root");
    useWorkspaceInstancesStore.getState().addWorkspaceInstance(
      createWorkspaceInstance({
        workspaceInstanceId: "wsi-a",
        root: root.root,
        ownerWindowLabel: "main",
        createdFrom: "open",
      }),
    );
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-a");
    const sa1 = useUIStore
      .getState()
      .terminalCreateSession({ ownerInstanceId: "wsi-a" })!;
    const sa2 = useUIStore
      .getState()
      .terminalCreateSession({ ownerInstanceId: "wsi-a" })!;
    useUIStore
      .getState()
      .terminalCreateSession({ ownerInstanceId: "wsi-b" });
    useUIStore.setState({ terminalVisible: true });
    useUIStore.getState().terminalSetActiveSession(sa1.id);

    await startAndExitCleanly(sa1.id);

    expect(useUIStore.getState().terminalVisible).toBe(true);
    // Fallback active is the remaining VISIBLE session, not wsi-b's.
    expect(useUIStore.getState().terminal.activeSessionId).toBe(sa2.id);
  });
});

describe("WI-TS4.1 — spawn env root is resolved ONCE, from the owner, pre-await", () => {
  it("hands spawnPty the OWNER's workspaceRoot even when the active scope switches mid-spawn", async () => {
    const { useWorkspaceInstancesStore } = await import(
      "@/stores/workspaceInstancesStore"
    );
    const { createWorkspaceInstance, createWorkspaceRootIdentity } = await import(
      "@/utils/workspaceIdentity"
    );
    const add = (id: string, rootPath: string) => {
      const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
      if (!root.ok) throw new Error("bad test root");
      useWorkspaceInstancesStore.getState().addWorkspaceInstance(
        createWorkspaceInstance({
          workspaceInstanceId: id,
          root: root.root,
          ownerWindowLabel: "main",
          createdFrom: "open",
        }),
      );
    };
    add("wsi-a", "/repo-a");
    add("wsi-b", "/repo-b");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-a");
    const s = useUIStore
      .getState()
      .terminalCreateSession({ ownerInstanceId: "wsi-a" })!;

    let receivedRoot: string | undefined = "unset";
    vi.mocked(spawnPty).mockImplementation(async (opts) => {
      receivedRoot = (opts as { workspaceRoot?: string }).workspaceRoot;
      // Simulate the rail switch landing WHILE the spawn is in flight.
      useWorkspaceInstancesStore
        .getState()
        .activateWorkspaceInstance("main", "wsi-b");
      return { write: vi.fn(), resize: vi.fn(), kill: vi.fn() } as unknown as IPty;
    });
    vi.mocked(resolveTerminalWorkspaceRoot).mockReturnValue(undefined);

    const entry = makeEntry();
    const sessionsRef = { current: new Map([[s.id, entry]]) };
    const { result } = renderHook(() => useTerminalShellLifecycle(sessionsRef));
    await act(async () => {
      await result.current.startShell(s.id);
    });

    // The env root is the OWNER's, captured before the await — not the scope
    // that happens to be active when the spawn completes.
    expect(receivedRoot).toBe("/repo-a");
  });
});
