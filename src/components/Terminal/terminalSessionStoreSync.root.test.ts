/**
 * Workspace-root sync tests for terminalSessionStoreSync.
 *
 * Covers the critical store→PTY mutation path that the audit (#918) flagged
 * as untested:
 *   - root change cd's an idle session whose cwd differs from the new root
 *   - a session already at the new root is NOT redundantly cd'd
 *   - a busy shell is skipped and the root is queued as pendingRoot
 *   - a queued root flushes when the shell returns to idle (OSC 133)
 *   - exited / PTY-less sessions are skipped
 *   - no cd when the root is unchanged
 *
 * Drives the real useWorkspaceStore via getActiveWorkspaceScope (mocked) so
 * the subscribe effects fire with controllable roots.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
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
// `resolveTerminalThemeId` stays real — see the note in the .live test.
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

function makeEntry(opts?: Partial<{ busy: boolean; cwd: string | null; spawnedCwd: string }>): {
  entry: SyncableSessionEntry;
  writes: string[];
  instance: FakeInstance;
} {
  const writes: string[] = [];
  const instance: FakeInstance = {
    busy: opts?.busy ?? false,
    cwd: opts?.cwd ?? null,
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
    spawnedCwd: opts?.spawnedCwd ?? "/root/a",
  };
  return { entry, writes, instance };
}

function setRoot(root: string) {
  mockScope.mockReturnValue({ isWorkspaceMode: true, rootPath: root });
  // Trigger the subscription by mutating the workspace store.
  useWorkspaceStore.setState((s) => ({ ...s }));
}

describe("terminalSessionStoreSync — workspace root sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScope.mockReturnValue({ isWorkspaceMode: true, rootPath: "/root/a" });
  });

  it("cd's an idle session whose cwd differs from the new root", () => {
    const { entry, writes } = makeEntry({ cwd: "/root/a", spawnedCwd: "/root/a" });
    const sessionsRef: RefObject<Map<string, SyncableSessionEntry>> = {
      current: new Map([["s1", entry]]),
    };
    renderHook(() => useUIStoreSync(sessionsRef));

    setRoot("/root/b");

    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe("\x15cd '/root/b'\n");
    expect(entry.spawnedCwd).toBe("/root/b");
  });

  it("does not cd a session already at the new root", () => {
    const { entry, writes } = makeEntry({ cwd: "/root/b" });
    const sessionsRef: RefObject<Map<string, SyncableSessionEntry>> = {
      current: new Map([["s1", entry]]),
    };
    renderHook(() => useUIStoreSync(sessionsRef));

    setRoot("/root/b");

    expect(writes).toHaveLength(0);
  });

  it("skips a busy shell and queues the root, then flushes on idle", () => {
    const { entry, writes, instance } = makeEntry({ busy: true, cwd: "/root/a" });
    const sessionsRef: RefObject<Map<string, SyncableSessionEntry>> = {
      current: new Map([["s1", entry]]),
    };
    renderHook(() => useUIStoreSync(sessionsRef));

    setRoot("/root/b");

    // Busy → no immediate cd, root queued, idle callback registered.
    expect(writes).toHaveLength(0);
    expect(entry.pendingRoot).toBe("/root/b");
    expect(instance.idleCb).not.toBeNull();

    // Command finishes: shell idle, idle callback fires the flush.
    instance.busy = false;
    instance.idleCb?.();

    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe("\x15cd '/root/b'\n");
    expect(entry.pendingRoot).toBeNull();
    expect(entry.spawnedCwd).toBe("/root/b");
  });

  it("skips a session with an exited shell", () => {
    const { entry, writes } = makeEntry({ cwd: "/root/a" });
    entry.shellExited = true;
    const sessionsRef: RefObject<Map<string, SyncableSessionEntry>> = {
      current: new Map([["s1", entry]]),
    };
    renderHook(() => useUIStoreSync(sessionsRef));

    setRoot("/root/b");

    expect(writes).toHaveLength(0);
  });

  it("skips a session with no PTY", () => {
    const { entry, writes } = makeEntry({ cwd: "/root/a" });
    entry.pty = null;
    const sessionsRef: RefObject<Map<string, SyncableSessionEntry>> = {
      current: new Map([["s1", entry]]),
    };
    renderHook(() => useUIStoreSync(sessionsRef));

    setRoot("/root/b");

    expect(writes).toHaveLength(0);
  });

  it("does nothing when the root is unchanged", () => {
    const { entry, writes } = makeEntry({ cwd: "/root/a" });
    const sessionsRef: RefObject<Map<string, SyncableSessionEntry>> = {
      current: new Map([["s1", entry]]),
    };
    renderHook(() => useUIStoreSync(sessionsRef));

    setRoot("/root/a");

    expect(writes).toHaveLength(0);
  });

  it("clears stale pendingRoot when an idle sync supersedes it", () => {
    const { entry, writes, instance } = makeEntry({ busy: true, cwd: "/root/a" });
    const sessionsRef: RefObject<Map<string, SyncableSessionEntry>> = {
      current: new Map([["s1", entry]]),
    };
    renderHook(() => useUIStoreSync(sessionsRef));

    setRoot("/root/b");
    expect(entry.pendingRoot).toBe("/root/b");

    // Shell becomes idle before the next root change; a new root arrives while idle.
    instance.busy = false;
    setRoot("/root/c");

    // Immediate cd to /root/c; pending cleared.
    expect(writes).toEqual(["\x15cd '/root/c'\n"]);
    expect(entry.pendingRoot).toBeNull();
  });
});

describe("flushPendingRoot", () => {
  it("returns false with no pending root", () => {
    const { entry } = makeEntry({ cwd: "/root/a" });
    expect(flushPendingRoot(entry)).toBe(false);
  });

  it("returns false and clears pending when the PTY is gone", () => {
    const { entry } = makeEntry({ cwd: "/root/a" });
    entry.pendingRoot = "/root/b";
    entry.pty = null;
    expect(flushPendingRoot(entry)).toBe(false);
    expect(entry.pendingRoot).toBeNull();
  });

  it("does not flush while the shell is busy", () => {
    const { entry, writes } = makeEntry({ busy: true, cwd: "/root/a" });
    entry.pendingRoot = "/root/b";
    expect(flushPendingRoot(entry)).toBe(false);
    expect(writes).toHaveLength(0);
    // Still pending — will retry on a later idle.
    expect(entry.pendingRoot).toBe("/root/b");
  });

  it("does not cd when the pending root equals current cwd", () => {
    const { entry, writes } = makeEntry({ cwd: "/root/b" });
    entry.pendingRoot = "/root/b";
    expect(flushPendingRoot(entry)).toBe(false);
    expect(writes).toHaveLength(0);
    expect(entry.pendingRoot).toBeNull();
  });
});

/** Leave workspace mode entirely (no root). */
function leaveWorkspace() {
  mockScope.mockReturnValue({ isWorkspaceMode: false, rootPath: null });
  useWorkspaceStore.setState((s) => ({ ...s }));
}

describe("terminalSessionStoreSync — lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScope.mockReturnValue({ isWorkspaceMode: true, rootPath: "/root/a" });
  });

  // Audit 20260815-163607 #14. `if (!newRoot) return` skipped the loop that
  // clears pendingRoot, so a root queued while the shell was busy survived the
  // workspace being closed — and the next idle event cd'd into it.
  it("clears a queued root when the workspace is closed", () => {
    const { entry, writes, instance } = makeEntry({ busy: true, cwd: "/root/a" });
    const sessionsRef: RefObject<Map<string, SyncableSessionEntry>> = {
      current: new Map([["s1", entry]]),
    };
    renderHook(() => useUIStoreSync(sessionsRef));

    setRoot("/root/b");
    expect(entry.pendingRoot).toBe("/root/b");

    leaveWorkspace();
    expect(entry.pendingRoot).toBeFalsy();

    // The shell going idle afterwards must NOT cd into the closed workspace.
    instance.busy = false;
    instance.idleCb?.();
    expect(writes).toHaveLength(0);
  });

  // Audit 20260815-163607 #15. `wired` only ever grew, so a removed session's
  // entry (and its installed idle callback) was retained until the whole hook
  // unmounted.
  it("unwires a session that has been removed from the live map", () => {
    const a = makeEntry({ cwd: "/root/a" });
    const b = makeEntry({ cwd: "/root/a" });
    const sessionsRef: RefObject<Map<string, SyncableSessionEntry>> = {
      current: new Map([
        ["s1", a.entry],
        ["s2", b.entry],
      ]),
    };
    renderHook(() => useUIStoreSync(sessionsRef));
    expect(a.instance.idleCb).not.toBeNull();
    expect(b.instance.idleCb).not.toBeNull();

    // s2 goes away, then something triggers a sync.
    sessionsRef.current.delete("s2");
    setRoot("/root/b");

    expect(b.instance.idleCb, "removed session must be unwired").toBeNull();
    expect(a.instance.idleCb, "surviving session stays wired").not.toBeNull();
  });
});
