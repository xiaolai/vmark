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
import { useUIStore } from "@/stores/uiStore";
import { spawnPty } from "./spawnPty";
import type { SessionEntry } from "./terminalSessionTypes";
import type { TerminalInstance } from "./createTerminalInstance";
import type { IPty } from "@/lib/pty";

vi.mock("./spawnPty", () => ({
  spawnPty: vi.fn(),
  resolveTerminalCwd: vi.fn(() => "/tmp"),
  resolveTerminalWorkspaceRoot: vi.fn(() => null),
}));

function makeEntry(): { entry: SessionEntry; writeMock: ReturnType<typeof vi.fn> } {
  const writeMock = vi.fn();
  const instance = {
    term: { write: writeMock, clear: vi.fn() },
    composing: false,
    inGracePeriod: false,
    onCompositionCommit: null,
    lastCommittedText: null,
    lastCommitTime: 0,
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
    lastSeenCommitTime: 0,
    lastCommittedConsumed: 0,
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
      sessions: sessionIds.map((id) => ({ id, label: id, isAlive: true })),
      activeSessionId: sessionIds[sessionIds.length - 1] ?? null,
    },
  });
}

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
