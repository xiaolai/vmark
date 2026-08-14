/**
 * useTerminalShellLifecycle
 *
 * Purpose: Owns spawning, exit handling, and restart for terminal sessions.
 * Extracted from useTerminalSessions so that hook focuses on registry +
 * visibility orchestration. Behavior preserved verbatim from the inline
 * implementation; user-facing status lines now route through i18n.
 *
 * Key decisions:
 *   - Re-entrance guard (shellSpawning) prevents concurrent spawns.
 *   - spawnGen ignores a stale PTY's onExit after a restart.
 *   - Clean exit (code 0) closes the tab — and hides the panel when it was
 *     the last session (#1103). Non-zero exits keep the buffer open with a
 *     "press any key to restart" prompt so the failure stays readable.
 *   - EVERY exit is logged at warn level, which reaches the Tauri log in
 *     production. A clean exit tears the whole panel down with nothing left on
 *     screen to explain it, so without this line "the terminal closed by
 *     itself" is indistinguishable from a crash — and the log had nothing to
 *     say about it when that was reported.
 *   - A new terminal inherits a live sibling's cwd (OSC 7), else falls back
 *     to workspace-or-file resolution.
 *   - Spawn failures mark the session dead and prompt "press any key".
 *   - A restart during an IN-FLIGHT spawn supersedes it: restartActiveSession
 *     bumps spawnGen and clears shellSpawning, and the older attempt disowns
 *     its PTY on arrival. Without that, restarting before the first shell
 *     appeared did nothing at all.
 *   - An explicit "Open Terminal Here" cwd outranks sibling inheritance and is
 *     released only once a spawn using it succeeds.
 *
 * @coordinates-with useTerminalSessions.ts — sole caller
 * @coordinates-with spawnPty.ts — shell process creation
 * @coordinates-with terminalMessages.ts — localized buffer status lines
 * @module components/Terminal/useTerminalShellLifecycle
 */
import { useCallback } from "react";
import { useUIStore } from "@/stores/uiStore";
import { errorMessage } from "@/utils/errorMessage";
import { terminalWarn } from "@/utils/debug";
import {
  spawnPty,
  resolveTerminalCwd,
  resolveTerminalWorkspaceRoot,
} from "./spawnPty";
import { buildCdCommand } from "./terminalSessionStoreSync";
import {
  processExitedLine,
  pressAnyKeyToRestartLine,
  failedToStartLine,
  pressAnyKeyToRetryLine,
  restartingLine,
} from "./terminalMessages";
import type { SessionEntry, SessionsRef } from "./terminalSessionTypes";

/** Detach a dead PTY from its session entry so keystrokes can't reach it. */
function detachExitedPty(entry: SessionEntry): void {
  entry.pty = null;
  entry.ptyRefForKeys.current = null;
  entry.shellExited = true;
}

/**
 * Clean exit (Ctrl+D / `exit`, code 0): close the tab (#1103), and hide the
 * panel when this was the last session. Instance/registry teardown follows
 * from the store removal via useTerminalSessions' subscription
 * (removeSessionEntry). A hidden panel stays hidden; reopening auto-creates
 * a fresh session (TerminalPanel visibility effect).
 */
function closeSessionOnCleanExit(sessionId: string): void {
  const ui = useUIStore.getState();
  const wasLast =
    ui.terminal.sessions.length === 1 &&
    ui.terminal.sessions[0].id === sessionId;
  ui.terminalRemoveSession(sessionId);
  if (!wasLast) return;
  // Re-read state: removal ran subscribers synchronously — only hide a
  // panel that is still visible.
  const now = useUIStore.getState();
  if (now.terminalVisible) now.toggleTerminal();
}

/** Non-zero exit: keep the buffer readable and offer respawn on any key. */
function promptRestartOnErrorExit(
  entry: SessionEntry,
  sessionId: string,
  exitCode: number,
): void {
  entry.instance.term.write(processExitedLine(exitCode));
  entry.instance.term.write(pressAnyKeyToRestartLine());
  useUIStore.getState().terminalMarkSessionDead(sessionId);
}

export interface TerminalShellLifecycle {
  /** Spawn the shell for a session entry. Guarded against re-entrance. */
  startShell: (sessionId: string) => Promise<void>;
  /** Kill the active session's PTY, clear the buffer, and respawn. */
  restartActiveSession: () => void;
}

export function useTerminalShellLifecycle(
  sessionsRef: SessionsRef,
): TerminalShellLifecycle {
  const startShell = useCallback(
    async (sessionId: string) => {
      const entry = sessionsRef.current.get(sessionId);
      if (!entry || entry.disposed) return;

      // Re-entrance guard: prevent concurrent spawns for the same session
      if (entry.shellSpawning) return;
      entry.shellSpawning = true;

      entry.shellExited = false;
      // Spawn generation: bumped on every (re)spawn. A killed PTY's onExit
      // fires asynchronously and could otherwise mark a freshly-restarted
      // session dead — the guard below ignores exits from a superseded gen.
      const gen = ++entry.spawnGen;
      // WI-4.2: an EXPLICIT request ("Open Terminal Here") outranks
      // everything below. Without this the sibling-cwd inheritance would win
      // and the new terminal would silently open in some other directory —
      // exactly the one thing the user did not ask for. PEEKED, not consumed:
      // it is cleared only once the spawn succeeds, so a failed first spawn
      // can still be retried in the directory the user actually asked for.
      const requestedCwd = useUIStore.getState().terminalPeekRequestedCwd(sessionId);
      // WI-2.2: otherwise a new terminal inherits a live sibling's cwd (OSC 7)
      // so it starts where the user is; first terminal / no sibling →
      // workspace-or-file resolution.
      let inheritedCwd: string | undefined;
      if (!requestedCwd) {
        for (const [id, sib] of sessionsRef.current) {
          if (id === sessionId || sib.disposed || !sib.pty || sib.shellExited) continue;
          const live = sib.instance.getCwd();
          if (live) {
            inheritedCwd = live;
            break;
          }
        }
      }
      const cwd = requestedCwd ?? inheritedCwd ?? resolveTerminalCwd();
      // Captured BEFORE the await so the post-spawn check can tell "the
      // workspace changed while we were spawning" from "this session simply
      // starts somewhere other than the workspace root". Comparing the root
      // against `cwd` conflated the two and immediately cd'd a sibling-
      // inheriting terminal back to the root, undoing WI-2.2 (Codex audit).
      const rootBeforeSpawn = resolveTerminalWorkspaceRoot();

      try {
        const pty = await spawnPty({
          term: entry.instance.term,
          // Omitted when nothing resolved a directory — see spawnPty's cwd note.
          ...(cwd !== undefined ? { cwd } : {}),
          onExit: (exitCode) => {
            const e = sessionsRef.current.get(sessionId);
            // Ignore a stale exit from a PTY superseded by a restart.
            if (!e || e.disposed || e.spawnGen !== gen) return;
            detachExitedPty(e);
            // A clean exit tears the panel down with nothing on screen to
            // explain it, so this line is the only evidence that the terminal
            // "closed by itself" was a shell exit and not a crash. Warn level
            // because createWarnLogger forwards to the Tauri log in production,
            // where the user is actually looking.
            terminalWarn(`session ${sessionId} exited`, { sessionId, exitCode });
            if (exitCode === 0) {
              closeSessionOnCleanExit(sessionId);
            } else {
              promptRestartOnErrorExit(e, sessionId, exitCode);
            }
          },
          disposed: () => {
            const e = sessionsRef.current.get(sessionId);
            return !e || e.disposed;
          },
        });

        const currentEntry = sessionsRef.current.get(sessionId);
        // Superseded by a restart while this spawn was in flight? Then this
        // PTY is an orphan: installing it would overwrite the restart's PTY
        // and leak a live shell. The generation check is what makes a restart
        // during spawn actually restart (audit).
        if (!currentEntry || currentEntry.disposed || currentEntry.spawnGen !== gen) {
          try {
            pty.kill();
          } catch {
            /* ignore */
          }
          // Only the CURRENT generation owns the spawning flag; clearing it
          // from a superseded attempt would unlock a spawn still running.
          if (currentEntry && currentEntry.spawnGen === gen) {
            currentEntry.shellSpawning = false;
          }
          return;
        }
        currentEntry.pty = pty;
        currentEntry.ptyRefForKeys.current = pty;
        currentEntry.spawnedCwd = cwd;
        currentEntry.shellSpawning = false;
        useUIStore.getState().terminalMarkSessionAlive(sessionId);
        // The requested directory has now been honored — release it so a later
        // restart resolves normally instead of re-anchoring to a stale request.
        if (requestedCwd) useUIStore.getState().terminalClearRequestedCwd(sessionId);

        // If the workspace changed WHILE spawning, cd to the new root — but
        // NOT when the user explicitly asked for a directory (WI-4.2). That
        // catch-up `cd` would otherwise walk the shell straight back out of
        // the folder they right-clicked, which looks like the feature is
        // broken rather than like a workspace sync.
        const currentRoot = resolveTerminalWorkspaceRoot();
        if (!requestedCwd && currentRoot && currentRoot !== rootBeforeSpawn) {
          pty.write(buildCdCommand(currentRoot));
          currentEntry.spawnedCwd = currentRoot;
        }
      } catch (err) {
        const e = sessionsRef.current.get(sessionId);
        // Same generation guard: a superseded attempt must not mark the
        // session dead or unlock the spawn that replaced it.
        if (e && !e.disposed && e.spawnGen === gen) {
          e.shellSpawning = false;
          e.instance.term.write(failedToStartLine(errorMessage(err)));
          e.instance.term.write(pressAnyKeyToRetryLine());
          e.shellExited = true;
          useUIStore.getState().terminalMarkSessionDead(sessionId);
        }
      }
    },
    [sessionsRef],
  );

  const restartActiveSession = useCallback(() => {
    const activeId = useUIStore.getState().terminal.activeSessionId;
    if (!activeId) return;
    const entry = sessionsRef.current.get(activeId);
    if (!entry || entry.disposed) return;

    // Kill current PTY
    if (entry.pty) {
      try {
        entry.pty.kill();
      } catch {
        /* ignore */
      }
      entry.pty = null;
      entry.ptyRefForKeys.current = null;
    }

    // Supersede any spawn still in flight (audit). Without this, restarting
    // while the first shell was still starting did NOTHING: there was no PTY
    // to kill, and startShell returned immediately on the `shellSpawning`
    // re-entrance guard. Bumping the generation makes the in-flight attempt
    // disown its result (it kills its own PTY on arrival), and clearing the
    // flag lets the new spawn through.
    if (entry.shellSpawning) {
      entry.spawnGen++;
      entry.shellSpawning = false;
    }

    entry.shellExited = false;
    entry.instance.term.clear();
    entry.instance.term.write(restartingLine());

    void startShell(activeId);
  }, [sessionsRef, startShell]);

  return { startShell, restartActiveSession };
}
