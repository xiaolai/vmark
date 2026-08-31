/**
 * WI-TS2.1 — cd-follow is gated on session ownership at every site
 * (plan 20260831, D-T4/D-T15): the syncRoot loop, the pendingRoot queue, and
 * flushPendingRoot (the OSC-133 idle path). Real uiStore + settingsStore;
 * only the active-scope resolver and window label are mocked, exactly like
 * the sibling root.test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";

const { mockScope } = vi.hoisted(() => ({
  mockScope: vi.fn(() => ({ isWorkspaceMode: true, rootPath: "/root/a" })),
}));

vi.mock("@/services/workspaces/activeWorkspaceScope", () => ({
  getActiveWorkspaceScope: () => mockScope(),
}));
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
  flushPendingRoot,
  type SyncableSessionEntry,
} from "./terminalSessionStoreSync";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { resetTerminalSessionStore, useUIStore } from "@/stores/uiStore";

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

function makeEntry(opts?: Partial<{ busy: boolean; cwd: string | null }>): {
  entry: SyncableSessionEntry;
  writes: string[];
  instance: FakeInstance;
} {
  const writes: string[] = [];
  const instance: FakeInstance = {
    busy: opts?.busy ?? false,
    cwd: opts?.cwd ?? "/root/a",
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
    spawnedCwd: "/root/a",
  };
  return { entry, writes, instance };
}

function setRail(enabled: boolean): void {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: enabled },
  });
}

function setRoot(root: string) {
  mockScope.mockReturnValue({ isWorkspaceMode: true, rootPath: root });
  useWorkspaceStore.setState((s) => ({ ...s }));
}

/** Create a store session (stamped or not) and return its id. */
function createStoreSession(ownerInstanceId?: string): string {
  return useUIStore
    .getState()
    .terminalCreateSession(ownerInstanceId ? { ownerInstanceId } : undefined)!.id;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTerminalSessionStore();
  mockScope.mockReturnValue({ isWorkspaceMode: true, rootPath: "/root/a" });
  setRail(true);
});

afterEach(() => {
  setRail(false);
});

describe("WI-TS2.1 — scoped sessions never follow the workspace root", () => {
  it("idle scoped session: no cd written on a root change", () => {
    const id = createStoreSession("wsi-b");
    const { entry, writes } = makeEntry({ cwd: "/root/a" });
    const sessionsRef: RefObject<Map<string, SyncableSessionEntry>> = {
      current: new Map([[id, entry]]),
    };
    renderHook(() => useUIStoreSync(sessionsRef));

    setRoot("/root/b");

    expect(writes).toHaveLength(0);
    expect(entry.spawnedCwd).toBe("/root/a");
  });

  it("busy scoped session: no pendingRoot is even recorded", () => {
    const id = createStoreSession("wsi-b");
    const { entry, writes, instance } = makeEntry({ busy: true, cwd: "/root/a" });
    const sessionsRef: RefObject<Map<string, SyncableSessionEntry>> = {
      current: new Map([[id, entry]]),
    };
    renderHook(() => useUIStoreSync(sessionsRef));

    setRoot("/root/b");
    expect(entry.pendingRoot).toBeFalsy();

    // Even if the shell later goes idle, nothing flushes.
    instance.busy = false;
    instance.idleCb?.();
    expect(writes).toHaveLength(0);
  });

  it("a pre-adoption pendingRoot does NOT cd after the session is adopted (D-T4)", () => {
    const id = createStoreSession(); // window-scoped at record time
    const { entry, writes, instance } = makeEntry({ busy: true, cwd: "/root/a" });
    const sessionsRef: RefObject<Map<string, SyncableSessionEntry>> = {
      current: new Map([[id, entry]]),
    };
    renderHook(() => useUIStoreSync(sessionsRef));

    setRoot("/root/b");
    expect(entry.pendingRoot).toBe("/root/b"); // recorded while unscoped

    // The rail switch adopts the session into the outgoing instance.
    useUIStore.getState().terminalAdoptUnscopedSessions("wsi-a");

    instance.busy = false;
    instance.idleCb?.();

    expect(writes).toHaveLength(0);
    expect(entry.pendingRoot).toBeNull(); // dropped, not retried forever
  });

  it("window-scoped behavior is unchanged with the rail on", () => {
    const id = createStoreSession();
    const { entry, writes } = makeEntry({ cwd: "/root/a" });
    const sessionsRef: RefObject<Map<string, SyncableSessionEntry>> = {
      current: new Map([[id, entry]]),
    };
    renderHook(() => useUIStoreSync(sessionsRef));

    setRoot("/root/b");

    expect(writes).toEqual(["\x15cd '/root/b'\n"]);
    expect(entry.spawnedCwd).toBe("/root/b");
  });

  it("rail OFF follows ALL sessions, stamped included (D-T15 inert stamps)", () => {
    const id = createStoreSession("wsi-b");
    setRail(false);
    const { entry, writes } = makeEntry({ cwd: "/root/a" });
    const sessionsRef: RefObject<Map<string, SyncableSessionEntry>> = {
      current: new Map([[id, entry]]),
    };
    renderHook(() => useUIStoreSync(sessionsRef));

    setRoot("/root/b");

    expect(writes).toEqual(["\x15cd '/root/b'\n"]);
  });
});

describe("WI-TS2.1 — flushPendingRoot owner guard (covers every caller)", () => {
  it("refuses and clears a scoped session's pending root", () => {
    const id = createStoreSession("wsi-b");
    const { entry, writes } = makeEntry({ cwd: "/root/a" });
    entry.pendingRoot = "/root/b";

    expect(flushPendingRoot(id, entry)).toBe(false);
    expect(entry.pendingRoot).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it("still flushes a window-scoped session's pending root", () => {
    const id = createStoreSession();
    const { entry, writes } = makeEntry({ cwd: "/root/a" });
    entry.pendingRoot = "/root/b";

    expect(flushPendingRoot(id, entry)).toBe(true);
    expect(writes).toEqual(["\x15cd '/root/b'\n"]);
  });

  it("rail OFF flushes a stamped session's pending root (D-T15)", () => {
    const id = createStoreSession("wsi-b");
    setRail(false);
    const { entry, writes } = makeEntry({ cwd: "/root/a" });
    entry.pendingRoot = "/root/b";

    expect(flushPendingRoot(id, entry)).toBe(true);
    expect(writes).toEqual(["\x15cd '/root/b'\n"]);
  });
});
