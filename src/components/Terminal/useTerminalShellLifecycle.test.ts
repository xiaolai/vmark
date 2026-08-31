/**
 * Tests for useTerminalShellLifecycle exit handling (#1103).
 *
 * Clean shell exit (code 0, e.g. Ctrl+D) closes the terminal tab — and hides
 * the panel when it was the last session. Non-zero exits keep the buffer open
 * with the "[Process exited …] Press any key to restart…" prompt so the user
 * can read what went wrong.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTerminalShellLifecycle } from "./useTerminalShellLifecycle";
import { useUIStore, resetTerminalSessionStore } from "@/stores/uiStore";
import { spawnPty } from "./spawnPty";
import type { SessionEntry } from "./terminalSessionTypes";
import type { TerminalInstance } from "./createTerminalInstance";
import type { IPty } from "@/lib/pty";

vi.mock("./spawnPty", () => ({
  spawnPty: vi.fn(),
  resolveTerminalCwd: vi.fn(() => "/tmp"),
  resolveActiveFileCwd: vi.fn(() => undefined),
  resolveTerminalWorkspaceRoot: vi.fn(() => null),
}));

function makeEntry(): { entry: SessionEntry; writeMock: ReturnType<typeof vi.fn> } {
  const writeMock = vi.fn();
  const instance = {
    term: { write: writeMock, clear: vi.fn() },
    composing: false,
    onCompositionCommit: null,
    fitAddon: {},
    searchAddon: {},
    container: {},
    resetDisplay: () => {},
    getCwd: () => null,
    getCommands: () => [],
    isShellBusy: () => false,
    dispose: () => {},
  } as unknown as TerminalInstance;
  const entry: SessionEntry = {
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
  return { entry, writeMock };
}

function makeFakePty(): IPty {
  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  } as unknown as IPty;
}

/** Spawn the shell for a session and capture the onExit callback spawnPty received. */
async function startAndCaptureExit(
  sessionsRef: { current: Map<string, SessionEntry> },
  sessionId: string,
): Promise<(code: number) => void> {
  let onExit: ((code: number) => void) | undefined;
  vi.mocked(spawnPty).mockImplementation(async (opts) => {
    onExit = opts.onExit;
    return makeFakePty();
  });
  const { result } = renderHook(() => useTerminalShellLifecycle(sessionsRef));
  await act(async () => {
    await result.current.startShell(sessionId);
  });
  if (!onExit) throw new Error("spawnPty was not called");
  return onExit;
}

function seedStore(sessionIds: string[], terminalVisible: boolean): void {
  useUIStore.setState({
    terminalVisible,
    terminal: {
      sessions: sessionIds.map((id, i) => ({ id, label: id, ordinal: i + 1, isAlive: true })),
      activeSessionId: sessionIds[sessionIds.length - 1] ?? null,
      lastActiveByScope: {},
    },
  });
}

// A clean exit hides the panel with no trace anywhere. Reported as "the
// terminal closes after several seconds" — and the Tauri log had nothing to
// say about it, because nothing logged it.
describe("useTerminalShellLifecycle — a vanishing panel leaves evidence", () => {
  beforeEach(() => {
    vi.mocked(spawnPty).mockReset();
  });

  it("logs the clean exit that hides the panel", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedStore(["term-1"], true);
    const { entry } = makeEntry();
    const sessionsRef = { current: new Map([["term-1", entry]]) };
    const onExit = await startAndCaptureExit(sessionsRef, "term-1");

    act(() => onExit(0));

    expect(warn).toHaveBeenCalledWith(
      "[Terminal]",
      expect.stringContaining("exited"),
      expect.objectContaining({ sessionId: "term-1", exitCode: 0 }),
    );
    warn.mockRestore();
  });

  it("logs a non-zero exit too", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedStore(["term-1"], true);
    const { entry } = makeEntry();
    const sessionsRef = { current: new Map([["term-1", entry]]) };
    const onExit = await startAndCaptureExit(sessionsRef, "term-1");

    act(() => onExit(3));

    expect(warn).toHaveBeenCalledWith(
      "[Terminal]",
      expect.stringContaining("exited"),
      expect.objectContaining({ sessionId: "term-1", exitCode: 3 }),
    );
    warn.mockRestore();
  });
});

describe("useTerminalShellLifecycle — shell exit (#1103)", () => {
  beforeEach(() => {
    vi.mocked(spawnPty).mockReset();
  });

  it("closes the session on clean exit (code 0)", async () => {
    seedStore(["term-1", "term-2"], true);
    const { entry } = makeEntry();
    const sessionsRef = { current: new Map([["term-1", entry]]) };

    const onExit = await startAndCaptureExit(sessionsRef, "term-1");
    act(() => onExit(0));

    const { terminal } = useUIStore.getState();
    expect(terminal.sessions.map((s) => s.id)).toEqual(["term-2"]);
  });

  it("hides the panel when the last session exits cleanly", async () => {
    seedStore(["term-1"], true);
    const { entry } = makeEntry();
    const sessionsRef = { current: new Map([["term-1", entry]]) };

    const onExit = await startAndCaptureExit(sessionsRef, "term-1");
    act(() => onExit(0));

    const state = useUIStore.getState();
    expect(state.terminal.sessions).toHaveLength(0);
    expect(state.terminalVisible).toBe(false);
  });

  it("does not re-show a hidden panel when the last session exits cleanly", async () => {
    seedStore(["term-1"], false);
    const { entry } = makeEntry();
    const sessionsRef = { current: new Map([["term-1", entry]]) };

    const onExit = await startAndCaptureExit(sessionsRef, "term-1");
    act(() => onExit(0));

    expect(useUIStore.getState().terminalVisible).toBe(false);
  });

  it("keeps the panel visible when a non-last session exits cleanly", async () => {
    seedStore(["term-1", "term-2"], true);
    const { entry } = makeEntry();
    const sessionsRef = { current: new Map([["term-1", entry]]) };

    const onExit = await startAndCaptureExit(sessionsRef, "term-1");
    act(() => onExit(0));

    expect(useUIStore.getState().terminalVisible).toBe(true);
  });

  it("keeps the session open with the restart prompt on non-zero exit", async () => {
    seedStore(["term-1"], true);
    const { entry, writeMock } = makeEntry();
    const sessionsRef = { current: new Map([["term-1", entry]]) };

    const onExit = await startAndCaptureExit(sessionsRef, "term-1");
    writeMock.mockClear();
    act(() => onExit(1));

    const state = useUIStore.getState();
    expect(state.terminal.sessions.map((s) => s.id)).toEqual(["term-1"]);
    expect(state.terminal.sessions[0].isAlive).toBe(false);
    expect(state.terminalVisible).toBe(true);
    // Exit notice + press-any-key prompt written to the buffer.
    expect(writeMock).toHaveBeenCalledTimes(2);
    expect(entry.shellExited).toBe(true);
    expect(entry.pty).toBeNull();
  });

  it("ignores a clean exit from a superseded spawn generation", async () => {
    seedStore(["term-1"], true);
    const { entry } = makeEntry();
    const sessionsRef = { current: new Map([["term-1", entry]]) };

    const onExit = await startAndCaptureExit(sessionsRef, "term-1");
    entry.spawnGen++; // simulate a restart superseding this PTY
    act(() => onExit(0));

    expect(useUIStore.getState().terminal.sessions).toHaveLength(1);
    expect(useUIStore.getState().terminalVisible).toBe(true);
  });

  it("ignores a clean exit after the session entry was disposed", async () => {
    seedStore(["term-1"], true);
    const { entry } = makeEntry();
    const sessionsRef = { current: new Map([["term-1", entry]]) };

    const onExit = await startAndCaptureExit(sessionsRef, "term-1");
    entry.disposed = true;
    act(() => onExit(0));

    expect(useUIStore.getState().terminal.sessions).toHaveLength(1);
  });
});

describe("restart during an in-flight spawn (audit fix)", () => {
  // The bug: restarting while the first shell was still starting did NOTHING.
  // There was no PTY to kill yet, and startShell returned immediately on the
  // `shellSpawning` re-entrance guard — so the user's restart was swallowed
  // and the original spawn carried on.
  beforeEach(() => {
    resetTerminalSessionStore();
    vi.clearAllMocks();
  });

  /** A spawnPty that never settles until the returned resolver is called. */
  function deferredSpawn() {
    let settle!: (pty: IPty) => void;
    const promise = new Promise<IPty>((res) => {
      settle = res;
    });
    return { promise, settle };
  }

  function makePty() {
    return {
      kill: vi.fn(),
      write: vi.fn(),
      onExit: vi.fn(),
      onData: vi.fn(),
      resize: vi.fn(),
    } as unknown as IPty;
  }

  it("supersedes the in-flight spawn instead of silently doing nothing", async () => {
    const { entry } = makeEntry();
    const sessions = new Map([["term-1", entry]]);
    const sessionsRef = { current: sessions };
    useUIStore.setState({
      terminal: { sessions: [{ id: "term-1", label: "Terminal 1", ordinal: 1, isAlive: true }], activeSessionId: "term-1", lastActiveByScope: {} },
    });

    const first = deferredSpawn();
    const secondPty = makePty();
    vi.mocked(spawnPty)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(secondPty);

    const { result } = renderHook(() => useTerminalShellLifecycle(sessionsRef));

    // Start a spawn that has not settled yet.
    act(() => {
      void result.current.startShell("term-1");
    });
    expect(entry.shellSpawning).toBe(true);
    const genBefore = entry.spawnGen;

    // Restart while it is still in flight.
    await act(async () => {
      result.current.restartActiveSession();
    });

    // A NEW spawn was actually issued — this is the whole fix.
    expect(vi.mocked(spawnPty)).toHaveBeenCalledTimes(2);
    expect(entry.spawnGen).toBeGreaterThan(genBefore);
  });

  it("kills the superseded PTY when it finally arrives, rather than installing it", async () => {
    const { entry } = makeEntry();
    const sessionsRef = { current: new Map([["term-1", entry]]) };
    useUIStore.setState({
      terminal: { sessions: [{ id: "term-1", label: "Terminal 1", ordinal: 1, isAlive: true }], activeSessionId: "term-1", lastActiveByScope: {} },
    });

    const first = deferredSpawn();
    const orphan = makePty();
    const keeper = makePty();
    vi.mocked(spawnPty)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(keeper);

    const { result } = renderHook(() => useTerminalShellLifecycle(sessionsRef));
    act(() => {
      void result.current.startShell("term-1");
    });
    await act(async () => {
      result.current.restartActiveSession();
    });

    // The first spawn now settles, long after being superseded.
    await act(async () => {
      first.settle(orphan);
      await first.promise;
    });

    // It must dispose of itself rather than overwrite the restart's PTY.
    expect(orphan.kill).toHaveBeenCalled();
    expect(entry.pty).toBe(keeper);
  });
});
