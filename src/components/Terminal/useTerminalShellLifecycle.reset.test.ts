/**
 * #1471 — every PTY session attaches to a pristine terminal.
 *
 * One xterm instance outlives many PTYs: the tab bar's restart button, the
 * press-any-key respawn after a non-zero exit or a failed spawn, and the
 * first spawn all hand the SAME instance a new shell. Restart used to
 * `term.clear()` the buffer, which leaves every mode the killed program set.
 * A Codex TUI's any-event mouse tracking (1003 + SGR 1006) then kept encoding
 * pointer motion as `ESC[<35;col;rowM`, and the new shell's line editor
 * echoed it as `35;79;40M35;76;39M…`.
 *
 * These tests run the REAL xterm parser and read its state back through the
 * terminal's own DECRQM/DECRQSS reports — the state that decides which bytes
 * reach the PTY — instead of asserting which reset method was called.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Terminal } from "@xterm/xterm";
import { useTerminalShellLifecycle } from "./useTerminalShellLifecycle";
import { wireSessionInput } from "./terminalSessionInputWiring";
import { useUIStore } from "@/stores/uiStore";
import { resetTerminalSessionStore, useTerminalStore } from "@/stores/terminalStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { spawnPty } from "./spawnPty";
import {
  createRealTerminal,
  flushWrites,
  writeParsed,
  queryState,
  pristineState,
  bufferText,
  TUI_LEFTOVERS,
} from "./realXterm.testUtils";
import type { SessionEntry } from "./terminalSessionTypes";
import type { TerminalInstance } from "./createTerminalInstance";
import type { IPty } from "@/lib/pty";

vi.mock("./spawnPty", () => ({
  spawnPty: vi.fn(),
  resolveActiveFileCwd: vi.fn(() => undefined),
  resolveTerminalWorkspaceRoot: vi.fn(() => null),
}));

const SESSION = "term-1";

function makePty(): IPty {
  return { write: vi.fn(), resize: vi.fn(), kill: vi.fn() } as unknown as IPty;
}

/** A session entry whose terminal is a REAL xterm (options as production). */
function makeEntry(term: Terminal): SessionEntry {
  const instance = {
    term,
    composing: false,
    onCompositionCommit: null,
    noteExternalWrite: () => {},
    getCwd: () => null,
  } as unknown as TerminalInstance;
  return {
    instance,
    pty: null,
    ptyRefForKeys: { current: null },
    spawnedCwd: undefined,
    shellStarted: true,
    shellExited: false,
    shellSpawning: false,
    disposed: false,
    spawnGen: 0,
    pendingRafId: null,
  };
}

/** Each spawnPty call hands back a fresh fake PTY and records its onExit. */
function trackSpawns() {
  const ptys: IPty[] = [];
  const exits: Array<(code: number) => void> = [];
  vi.mocked(spawnPty).mockImplementation(async (opts) => {
    exits.push(opts.onExit);
    const pty = makePty();
    ptys.push(pty);
    return pty;
  });
  return { ptys, exits };
}

function setCursorBlinkSetting(cursorBlink: boolean): void {
  useSettingsStore.setState((s) => ({ terminal: { ...s.terminal, cursorBlink } }));
}

/** Let xterm parse everything written so far — the reset included — and let
 *  startShell finish what it does once the reset is parsed (spawn, attach). */
function settle(term: Terminal): Promise<void> {
  return act(async () => {
    await flushWrites(term);
  });
}

async function setup(cursorBlink = true) {
  setCursorBlinkSetting(cursorBlink);
  const term = createRealTerminal({ cursorBlink });
  const entry = makeEntry(term);
  const sessionsRef = { current: new Map([[SESSION, entry]]) };
  const spawns = trackSpawns();
  const { result } = renderHook(() => useTerminalShellLifecycle(sessionsRef));
  await act(async () => {
    await result.current.startShell(SESSION);
  });
  return { term, entry, sessionsRef, lifecycle: result, ...spawns };
}

beforeEach(() => {
  resetTerminalSessionStore();
  vi.mocked(spawnPty).mockReset();
  useUIStore.setState({ terminalVisible: true });
  useTerminalStore.setState({
    sessions: [{ id: SESSION, label: "Terminal 1", ordinal: 1, isAlive: true }],
    activeSessionId: SESSION,
    lastActiveByScope: {},
  });
});

describe("#1471 — a restarted session does not inherit the killed program's terminal", () => {
  it("restart button: mouse tracking, bracketed paste, alt screen, hidden cursor … all reset", async () => {
    const { term, entry, lifecycle, ptys } = await setup();
    await writeParsed(term, TUI_LEFTOVERS);
    expect(term.modes.mouseTrackingMode).toBe("any"); // the Codex TUI state

    await act(async () => {
      lifecycle.current.restartActiveSession();
    });
    await settle(term);

    // The exact bug: xterm must no longer turn pointer motion into input.
    expect(term.modes.mouseTrackingMode).toBe("none");
    expect(term.buffer.active.type).toBe("normal");
    expect(await queryState(term)).toEqual(await pristineState({ cursorBlink: true }));
    // The old PTY is gone and the new one is the only writer.
    expect(ptys[0].kill).toHaveBeenCalled();
    expect(entry.pty).toBe(ptys[1]);
  });

  it("restart still shows the localized notice, intact, after the reset", async () => {
    const { term, lifecycle } = await setup();
    // Killed INSIDE an escape sequence, with the DEC line-drawing charset on:
    // a reset that left the parser mid-CSI would eat the "R", and one that
    // left the charset would draw "shell" as box corners.
    await writeParsed(term, TUI_LEFTOVERS + "\x1b[?100");

    await act(async () => {
      lifecycle.current.restartActiveSession();
    });
    await settle(term);

    const rows = bufferText(term).split("\n");
    const row = rows.findIndex((text) => text.includes("Restarting shell…"));
    expect(row).toBeGreaterThanOrEqual(0);
    // Plain text, not in the dead program's bold red.
    const cell = term.buffer.active.getLine(row)?.getCell(rows[row].indexOf("R"));
    expect(cell?.isBold()).toBe(0);
    expect(cell?.isFgDefault()).toBe(true);
  });

  it("output the old PTY already queued in xterm cannot re-arm tracking after the reset", async () => {
    const { term, lifecycle } = await setup();
    // Parsed after the click, not before it: xterm drains big writes in slices.
    term.write("x".repeat(200_000) + "\x1b[?1003h\x1b[?1006h");

    await act(async () => {
      lifecycle.current.restartActiveSession();
    });
    await settle(term);

    expect(term.modes.mouseTrackingMode).toBe("none");
  });

  it("press-any-key respawn after a non-zero exit starts pristine too", async () => {
    const { term, entry, sessionsRef, lifecycle, exits } = await setup();
    wireSessionInput({
      sessionId: SESSION,
      getEntry: (id) => sessionsRef.current.get(id),
      startShell: (id) => void lifecycle.current.startShell(id),
    });
    await writeParsed(term, TUI_LEFTOVERS);
    act(() => exits[0](1));
    await settle(term); // "any key" is armed once the exit lines are parsed

    await act(async () => {
      term.input("x"); // the "any key"
    });
    await settle(term);

    expect(vi.mocked(spawnPty)).toHaveBeenCalledTimes(2);
    expect(entry.shellExited).toBe(false);
    expect(await queryState(term)).toEqual(await pristineState({ cursorBlink: true }));
  });

  it("the first spawn on an instance starts pristine without its caller resetting", async () => {
    setCursorBlinkSetting(true);
    const term = createRealTerminal({ cursorBlink: true });
    await writeParsed(term, TUI_LEFTOVERS);
    const sessionsRef = { current: new Map([[SESSION, makeEntry(term)]]) };
    trackSpawns();
    const { result } = renderHook(() => useTerminalShellLifecycle(sessionsRef));

    await act(async () => {
      await result.current.startShell(SESSION);
    });
    await settle(term);

    expect(await queryState(term)).toEqual(await pristineState({ cursorBlink: true }));
  });

  it.each([true, false])(
    "cursor blink returns to the user's setting (%s), not the dead program's",
    async (cursorBlink) => {
      const { term, lifecycle } = await setup(cursorBlink);
      // ncurses' cnorm is `ESC[?12l ESC[?25h`: xterm writes ?12 into the
      // cursorBlink OPTION, which a plain RIS never restores.
      await writeParsed(term, cursorBlink ? "\x1b[?12l" : "\x1b[?12h");

      await act(async () => {
        lifecycle.current.restartActiveSession();
      });
      await settle(term);

      expect(term.options.cursorBlink).toBe(cursorBlink);
    },
  );

  it("a blink setting changed while the reset is still queued is the one that sticks", async () => {
    const { term, lifecycle } = await setup(true);
    term.write("x".repeat(200_000)); // the reset queues behind this

    await act(async () => {
      lifecycle.current.restartActiveSession();
    });
    // The user turns blink off before xterm reaches the reset; settings sync
    // applies it to the live terminal immediately.
    setCursorBlinkSetting(false);
    term.options.cursorBlink = false;
    await settle(term);

    expect(term.options.cursorBlink).toBe(false);
  });

  it("rapid repeated restarts spawn one shell, not one per click", async () => {
    const { term, entry, lifecycle, ptys } = await setup();

    await act(async () => {
      lifecycle.current.restartActiveSession();
      lifecycle.current.restartActiveSession();
      lifecycle.current.restartActiveSession();
    });
    await settle(term);

    // The initial shell plus ONE restart: the overtaken attempts stood down
    // while their reset was still being parsed, before spawning anything.
    expect(vi.mocked(spawnPty)).toHaveBeenCalledTimes(2);
    expect(entry.pty).toBe(ptys[1]);
    expect(entry.shellSpawning).toBe(false);
  });

  it("drops the dead program's tab title", async () => {
    const { term, lifecycle } = await setup();
    useTerminalStore.getState().terminalSetProgramTitle(SESSION, "Codex");

    await act(async () => {
      lifecycle.current.restartActiveSession();
    });
    await settle(term);

    const session = useTerminalStore.getState().sessions.find((s) => s.id === SESSION);
    expect(session?.programTitle ?? "").toBe("");
  });

  it("drops a title the old program had queued but xterm had not yet parsed", async () => {
    const { term, lifecycle } = await setup();
    // As in createSession: OSC 0/2 → the tab title.
    term.onTitleChange((title) => useTerminalStore.getState().terminalSetProgramTitle(SESSION, title));
    term.write("x".repeat(200_000) + "\x1b]2;Codex\x07");

    await act(async () => {
      lifecycle.current.restartActiveSession();
    });
    await settle(term);

    const session = useTerminalStore.getState().sessions.find((s) => s.id === SESSION);
    expect(session?.programTitle ?? "").toBe("");
  });

  it("nothing the old program queued reaches the NEW pty — not even xterm's replies to it", async () => {
    const { term, sessionsRef, lifecycle, ptys } = await setup();
    wireSessionInput({
      sessionId: SESSION,
      getEntry: (id) => sessionsRef.current.get(id),
      startShell: (id) => void lifecycle.current.startShell(id),
    });
    // Still queued when restart is clicked: a cursor-position query (xterm
    // answers it through onData, exactly like a mouse report) and tracking.
    term.write("x".repeat(200_000) + "\x1b[6n\x1b[?1003h\x1b[?1006h");

    await act(async () => {
      lifecycle.current.restartActiveSession();
    });
    await settle(term);

    expect(ptys).toHaveLength(2);
    expect(ptys[1].write).not.toHaveBeenCalled();
    expect(term.modes.mouseTrackingMode).toBe("none");
  });
});

describe("#1471 — a dead session stops reporting input for the program that died", () => {
  it("mouse and focus reporting stop, but the failure stays readable", async () => {
    const { term, exits } = await setup();
    await writeParsed(term, "codex output\r\n\x1b[?1003h\x1b[?1006h\x1b[?1004h");
    const sent: string[] = [];
    term.onData((d) => sent.push(d));

    act(() => exits[0](1));
    await settle(term);

    // "Press any key" listens to onData, so a pointer move or a focus change
    // must not produce any — or it restarts and wipes the message. Turning the
    // reports off must not emit anything either, for the same reason.
    expect(term.modes.mouseTrackingMode).toBe("none");
    expect(term.modes.sendFocusMode).toBe(false);
    expect(sent).toEqual([]);
    const text = bufferText(term);
    expect(text).toContain("codex output");
    expect(text).toContain("[Process exited with code 1]");
    expect(text).toContain("Press any key to restart…");
  });

  it("output the program queued before it died cannot count as the key", async () => {
    const { term, sessionsRef, lifecycle, exits, entry } = await setup();
    wireSessionInput({
      sessionId: SESSION,
      getEntry: (id) => sessionsRef.current.get(id),
      startShell: (id) => void lifecycle.current.startShell(id),
    });
    // Still unparsed when the exit arrives: a cursor-position query, which
    // xterm answers through onData — the channel "press any key" listens on.
    term.write("x".repeat(200_000) + "\x1b[6n");

    act(() => exits[0](1));
    await settle(term);

    expect(vi.mocked(spawnPty)).toHaveBeenCalledTimes(1);
    expect(entry.shellExited).toBe(true); // armed — once everything was parsed
    expect(bufferText(term)).toContain("Press any key to restart…");
  });

  it("a query the program died in the middle of is abandoned, not answered — no respawn without a key", async () => {
    const { term, sessionsRef, lifecycle, exits, entry } = await setup();
    wireSessionInput({
      sessionId: SESSION,
      getEntry: (id) => sessionsRef.current.get(id),
      startShell: (id) => void lifecycle.current.startShell(id),
    });
    // An unterminated DECRQSS: an ESC would complete it and xterm would reply
    // through onData, which the dead session takes for "any key".
    await writeParsed(term, "\x1bP$q");

    act(() => exits[0](1));
    await settle(term);

    expect(vi.mocked(spawnPty)).toHaveBeenCalledTimes(1);
    expect(entry.shellExited).toBe(true);
    expect(bufferText(term)).toContain("[Process exited with code 1]");
  });
});
