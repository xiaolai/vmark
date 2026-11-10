/**
 * terminalShellExit
 *
 * Purpose: What happens when a session's shell exits. Split out of
 * useTerminalShellLifecycle (file-size gate); the lifecycle still decides
 * WHETHER an exit counts (its spawn-generation guard), this decides what the
 * exit does.
 *
 * Key decisions:
 *   - Clean exit (code 0) closes the tab — and hides the panel when it was
 *     the last session (#1103). Non-zero exits keep the buffer open with a
 *     "press any key to restart" prompt so the failure stays readable.
 *   - EVERY exit is logged at warn level, which reaches the Tauri log in
 *     production. A clean exit tears the whole panel down with nothing left on
 *     screen to explain it, so without this line "the terminal closed by
 *     itself" is indistinguishable from a crash — and the log had nothing to
 *     say about it when that was reported.
 *   - A non-zero exit stops the dead program's pointer/focus reporting, and
 *     arms "press any key" only once that and the exit lines are PARSED
 *     (#1471). "Any key" is whatever reaches onData, and until then output the
 *     program had queued can still make xterm answer a query or report the
 *     mouse there — which would restart the shell and wipe the message.
 *
 * @coordinates-with useTerminalShellLifecycle.ts — sole caller (spawnPty onExit)
 * @coordinates-with terminalSessionReset.ts — stopUnsolicitedInput
 * @coordinates-with terminalMessages.ts — localized exit lines
 * @module components/Terminal/terminalShellExit
 */
import { useTerminalStore } from "@/stores/terminalStore";
import { terminalWarn } from "@/utils/debug";
import { removeTerminalSessionWithPanelPolicy } from "@/services/terminal/closeTerminalSession";
import { processExitedLine, pressAnyKeyToRestartLine } from "./terminalMessages";
import { stopUnsolicitedInput } from "./terminalSessionReset";
import type { SessionEntry } from "./terminalSessionTypes";

/** Detach a dead PTY from its session entry so keystrokes can't reach it. */
function detachExitedPty(entry: SessionEntry): void {
  entry.pty = null;
  entry.ptyRefForKeys.current = null;
}

/**
 * Clean exit (Ctrl+D / `exit`, code 0): close the tab (#1103) via the ONE
 * remove+hide policy (TerminalPanel's close button and
 * this path had drifted). The panel hides only when this was the last
 * VISIBLE session (WI-TS3.3/D-T7); a hidden scope's exiting shell still
 * closes its tab. Instance/registry teardown follows from the store removal
 * via useTerminalSessions' subscription (removeSessionEntry).
 */
function closeSessionOnCleanExit(sessionId: string): void {
  removeTerminalSessionWithPanelPolicy(sessionId);
}

/** Non-zero exit: keep the buffer readable and offer respawn on any key, armed
 *  once everything written so far is parsed — unless a restart came first. */
function promptRestartOnErrorExit(
  entry: SessionEntry,
  sessionId: string,
  exitCode: number,
): void {
  const { term } = entry.instance;
  const gen = entry.spawnGen;
  stopUnsolicitedInput(term);
  term.write(processExitedLine(exitCode) + pressAnyKeyToRestartLine(), () => {
    if (!entry.disposed && entry.spawnGen === gen && !entry.pty) entry.shellExited = true;
  });
  useTerminalStore.getState().terminalMarkSessionDead(sessionId);
}

/** Handle the exit of the session's CURRENT shell (the caller filters stale ones). */
export function handleShellExit(entry: SessionEntry, sessionId: string, exitCode: number): void {
  detachExitedPty(entry);
  // A clean exit tears the panel down with nothing on screen to explain it, so
  // this line is the only evidence that the terminal "closed by itself" was a
  // shell exit and not a crash. Warn level because createWarnLogger forwards to
  // the Tauri log in production, where the user is actually looking.
  terminalWarn(`session ${sessionId} exited`, { sessionId, exitCode });
  if (exitCode === 0) {
    closeSessionOnCleanExit(sessionId);
  } else {
    promptRestartOnErrorExit(entry, sessionId, exitCode);
  }
}
