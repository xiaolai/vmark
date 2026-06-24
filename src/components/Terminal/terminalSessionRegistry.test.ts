import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  removeSessionEntry,
  switchVisibility,
  disposeAllSessions,
} from "./terminalSessionRegistry";
import type { SessionEntry, SessionsRef } from "./terminalSessionTypes";

/**
 * Build a minimal fake SessionEntry exercising only the imperative members the
 * registry helpers touch (instance container/addons, pty, raf bookkeeping).
 * The real TerminalInstance/IPty are heavy DOM/PTY objects; we stub the surface.
 */
function makeEntry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  const container = document.createElement("div");
  return {
    instance: {
      container,
      dispose: vi.fn(),
      term: { focus: vi.fn(), reset: vi.fn() },
      fitAddon: { fit: vi.fn() },
      searchAddon: { clearDecorations: vi.fn() },
    },
    pty: { kill: vi.fn() },
    ptyRefForKeys: { current: null },
    spawnedCwd: undefined,
    shellStarted: false,
    shellExited: false,
    shellSpawning: false,
    disposed: false,
    spawnGen: 0,
    pendingRafId: null,
    lastSeenCommitTime: 0,
    lastCommittedConsumed: 0,
    ...overrides,
  } as unknown as SessionEntry;
}

function makeRef(entries: Record<string, SessionEntry>): SessionsRef {
  return { current: new Map(Object.entries(entries)) } as SessionsRef;
}

describe("removeSessionEntry", () => {
  it("is a no-op for an unknown session id", () => {
    const ref = makeRef({});
    expect(() => removeSessionEntry(ref, "missing")).not.toThrow();
  });

  it("disposes the instance, kills the pty, and deletes the entry", () => {
    const entry = makeEntry();
    const ref = makeRef({ a: entry });

    removeSessionEntry(ref, "a");

    expect(entry.disposed).toBe(true);
    expect(entry.pty?.kill).toHaveBeenCalledOnce();
    expect(entry.instance.dispose).toHaveBeenCalledOnce();
    expect(ref.current.has("a")).toBe(false);
  });

  it("cancels a pending rAF before disposing", () => {
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
    const entry = makeEntry({ pendingRafId: 42 });
    const ref = makeRef({ a: entry });

    removeSessionEntry(ref, "a");

    expect(cancelSpy).toHaveBeenCalledWith(42);
    expect(entry.pendingRafId).toBeNull();
    cancelSpy.mockRestore();
  });

  it("swallows a pty.kill() failure and still disposes", () => {
    const entry = makeEntry();
    (entry.pty!.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("already dead");
    });
    const ref = makeRef({ a: entry });

    expect(() => removeSessionEntry(ref, "a")).not.toThrow();
    expect(entry.instance.dispose).toHaveBeenCalledOnce();
    expect(ref.current.has("a")).toBe(false);
  });
});

describe("switchVisibility", () => {
  let rafCallbacks: Array<() => void>;

  beforeEach(() => {
    rafCallbacks = [];
    let id = 1;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (cb: FrameRequestCallback) => {
        rafCallbacks.push(() => cb(0));
        return id++;
      },
    );
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function flushRaf() {
    rafCallbacks.forEach((cb) => cb());
    rafCallbacks = [];
  }

  it("shows the active container and hides the others", () => {
    const active = makeEntry();
    const other = makeEntry();
    const ref = makeRef({ a: active, b: other });

    switchVisibility(ref, "a", vi.fn());

    expect(active.instance.container.style.display).toBe("block");
    expect(other.instance.container.style.display).toBe("none");
    expect(other.instance.searchAddon.clearDecorations).toHaveBeenCalledOnce();
  });

  it("fits, focuses, and starts the shell exactly once on first activation", () => {
    const active = makeEntry();
    const ref = makeRef({ a: active });
    const startShell = vi.fn();

    switchVisibility(ref, "a", startShell);
    flushRaf();

    expect(active.instance.fitAddon.fit).toHaveBeenCalledOnce();
    expect(active.instance.term.focus).toHaveBeenCalledOnce();
    expect(active.instance.term.reset).toHaveBeenCalledOnce();
    expect(active.shellStarted).toBe(true);
    expect(startShell).toHaveBeenCalledWith("a");
  });

  it("does not restart the shell when it already started", () => {
    const active = makeEntry({ shellStarted: true });
    const ref = makeRef({ a: active });
    const startShell = vi.fn();

    switchVisibility(ref, "a", startShell);
    flushRaf();

    expect(active.instance.term.reset).not.toHaveBeenCalled();
    expect(startShell).not.toHaveBeenCalled();
  });

  it("cancels a hidden session's pending rAF and the active session's stale rAF", () => {
    const active = makeEntry({ pendingRafId: 11 });
    const hidden = makeEntry({ pendingRafId: 22 });
    const ref = makeRef({ a: active, b: hidden });
    const cancelSpy = globalThis.cancelAnimationFrame as ReturnType<
      typeof vi.fn
    >;

    switchVisibility(ref, "a", vi.fn());

    // Hidden session's pending rAF is cancelled and cleared.
    expect(cancelSpy).toHaveBeenCalledWith(22);
    expect(hidden.pendingRafId).toBeNull();
    // Active session's stale rAF (11) is cancelled before scheduling a new one.
    expect(cancelSpy).toHaveBeenCalledWith(11);
  });

  it("returns early without scheduling work when there is no active id", () => {
    const entry = makeEntry();
    const ref = makeRef({ a: entry });

    switchVisibility(ref, null, vi.fn());

    expect(entry.instance.container.style.display).toBe("none");
    expect(rafCallbacks).toHaveLength(0);
  });
});

describe("disposeAllSessions", () => {
  it("disposes every entry, kills ptys, and clears the map", () => {
    const a = makeEntry({ pendingRafId: 7 });
    const b = makeEntry();
    const sessions = new Map<string, SessionEntry>([
      ["a", a],
      ["b", b],
    ]);
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");

    disposeAllSessions(sessions);

    expect(a.disposed).toBe(true);
    expect(b.disposed).toBe(true);
    expect(cancelSpy).toHaveBeenCalledWith(7);
    expect(a.instance.dispose).toHaveBeenCalledOnce();
    expect(b.instance.dispose).toHaveBeenCalledOnce();
    expect(sessions.size).toBe(0);
    cancelSpy.mockRestore();
  });

  it("tolerates a pty.kill() failure during teardown", () => {
    const a = makeEntry();
    (a.pty!.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("kill failed");
    });
    const sessions = new Map<string, SessionEntry>([["a", a]]);

    expect(() => disposeAllSessions(sessions)).not.toThrow();
    expect(a.instance.dispose).toHaveBeenCalledOnce();
    expect(sessions.size).toBe(0);
  });
});
