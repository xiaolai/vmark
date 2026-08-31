/**
 * WI-TS2.4 — end-to-end store-chain regression test for the investigated bug
 * class (plan 20260831): a rail switch must swap the VISIBLE terminal set and
 * must NOT type `cd` into instance-scoped sessions — busy or idle — while the
 * legacy window-scoped population keeps today's cd-follow behavior verbatim.
 *
 * Real stores end to end: settingsStore (rail), workspaceInstancesStore,
 * workspaceStore, uiStore, the REAL switchWorkspaceInstance coordinator and
 * the REAL getActiveWorkspaceScope. Mocked: Tauri invoke and the window
 * label. This chain had zero non-mocked coverage before this file — the
 * root.test mocks the scope resolver, and the coordinator tests never touch
 * xterm entries.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() =>
    Promise.resolve(null),
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));
vi.mock("@/theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/theme")>()),
  buildXtermThemeForId: () => ({}),
}));
vi.mock("@/utils/fontStacks", () => ({ resolveMonoFontStack: () => "mono" }));

import {
  useUIStoreSync,
  type SyncableSessionEntry,
} from "./terminalSessionStoreSync";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { resetTerminalSessionStore, useUIStore } from "@/stores/uiStore";
import { selectVisibleTerminalSessions } from "@/stores/uiStore/terminalScopeSelectors";
import {
  createWorkspaceInstance,
  createWorkspaceRootIdentity,
} from "@/utils/workspaceIdentity";
import { resetContextGenerations } from "@/services/workspaces/workspaceContextGeneration";
import { switchWorkspaceInstance } from "@/services/workspaces/switchWorkspaceInstance";

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

interface FakeInstance {
  busy: boolean;
  cwd: string | null;
  idleCb: (() => void) | null;
  term: { options: Record<string, unknown> };
  fitAddon: { fit: () => void };
  isShellBusy: () => boolean;
  getCwd: () => string | null;
  setOnShellIdle: (cb: (() => void) | null) => void;
}

function makeEntry(opts?: Partial<{ busy: boolean; cwd: string }>): {
  entry: SyncableSessionEntry;
  writes: string[];
  instance: FakeInstance;
} {
  const writes: string[] = [];
  const instance: FakeInstance = {
    busy: opts?.busy ?? false,
    cwd: opts?.cwd ?? "/repo-a",
    idleCb: null,
    term: { options: {} },
    fitAddon: { fit: vi.fn() },
    isShellBusy() {
      return this.busy;
    },
    getCwd() {
      return this.cwd;
    },
    setOnShellIdle(cb) {
      this.idleCb = cb;
    },
  };
  const entry: SyncableSessionEntry = {
    instance: instance as unknown as SyncableSessionEntry["instance"],
    pty: { write: (s: string) => writes.push(s) } as unknown as SyncableSessionEntry["pty"],
    shellExited: false,
    spawnedCwd: opts?.cwd ?? "/repo-a",
  };
  return { entry, writes, instance };
}

const visibleIds = () => {
  const activeId =
    useWorkspaceInstancesStore.getState().windows[W]?.activeWorkspaceInstanceId ?? null;
  return selectVisibleTerminalSessions(
    useUIStore.getState().terminal,
    activeId,
    useSettingsStore.getState().general?.workspaceRailMode ?? false,
  ).map((s) => s.id);
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(null);
  resetContextGenerations();
  resetTerminalSessionStore();
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useWorkspaceStore.getState().closeWorkspace();
  setRail(true);
  addWorkspace("wsi-a", "/repo-a");
  addWorkspace("wsi-b", "/repo-b");
  useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
});

afterEach(() => {
  setRail(false);
});

describe("rail switch × live terminal chain (WI-TS2.4)", () => {
  it("swaps the visible set and types NOTHING into scoped sessions (idle)", () => {
    const sa = useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-a" })!;
    const sb = useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-b" })!;
    useUIStore.getState().terminalSetActiveSession(sa.id);
    const a = makeEntry({ cwd: "/repo-a" });
    const b = makeEntry({ cwd: "/repo-b" });
    const sessionsRef: RefObject<Map<string, SyncableSessionEntry>> = {
      current: new Map([
        [sa.id, a.entry],
        [sb.id, b.entry],
      ]),
    };
    renderHook(() => useUIStoreSync(sessionsRef));
    expect(visibleIds()).toEqual([sa.id]);

    switchWorkspaceInstance(W, "wsi-b");

    // Visible set swapped; membership untouched (invariant 1).
    expect(visibleIds()).toEqual([sb.id]);
    expect(useUIStore.getState().terminal.activeSessionId).toBe(sb.id);
    expect(useUIStore.getState().terminal.sessions).toHaveLength(2);
    // NO cd typed into either shell; cwds untouched.
    expect(a.writes).toHaveLength(0);
    expect(b.writes).toHaveLength(0);
    expect(a.entry.spawnedCwd).toBe("/repo-a");
  });

  it("the reported bug class: a BUSY shell gets neither a cd nor a pendingRoot from a rail switch", () => {
    // The live repro: `sleep 300` in A's shell, then a rail click. The old
    // code queued a pendingRoot and cd'd the shell (or typed into the
    // foreground program) when it went idle. Now the session is adopted by A
    // and left alone.
    const su = useUIStore.getState().terminalCreateSession()!; // unscoped
    const busy = makeEntry({ busy: true, cwd: "/repo-a" });
    const sessionsRef: RefObject<Map<string, SyncableSessionEntry>> = {
      current: new Map([[su.id, busy.entry]]),
    };
    renderHook(() => useUIStoreSync(sessionsRef));

    switchWorkspaceInstance(W, "wsi-b");

    // Adopted by the outgoing instance, hidden, untouched.
    const adopted = useUIStore
      .getState()
      .terminal.sessions.find((s) => s.id === su.id);
    expect(adopted?.workspaceInstanceId).toBe("wsi-a");
    expect(visibleIds()).toEqual([]);
    expect(busy.entry.pendingRoot).toBeFalsy();

    // The foreground command finishing must not deliver a deferred cd either.
    busy.instance.busy = false;
    busy.instance.idleCb?.();
    expect(busy.writes).toHaveLength(0);

    // Switching back reveals the same session, same cwd, no writes ever.
    switchWorkspaceInstance(W, "wsi-a");
    expect(visibleIds()).toEqual([su.id]);
    expect(useUIStore.getState().terminal.activeSessionId).toBe(su.id);
    expect(busy.writes).toHaveLength(0);
    expect(busy.entry.spawnedCwd).toBe("/repo-a");
  });

  it("rail OFF: the legacy window-scoped population still cd-follows root changes verbatim", () => {
    setRail(false);
    const su = useUIStore.getState().terminalCreateSession()!;
    const u = makeEntry({ cwd: "/repo-a" });
    const sessionsRef: RefObject<Map<string, SyncableSessionEntry>> = {
      current: new Map([[su.id, u.entry]]),
    };
    useWorkspaceStore.setState({ rootPath: "/repo-a", isWorkspaceMode: true });
    renderHook(() => useUIStoreSync(sessionsRef));

    useWorkspaceStore.setState({ rootPath: "/repo-b", isWorkspaceMode: true });

    expect(u.writes).toEqual(["\x15cd '/repo-b'\n"]);
    expect(u.entry.spawnedCwd).toBe("/repo-b");
  });
});
