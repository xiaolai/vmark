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
 *   - A new terminal inherits a live sibling's cwd (OSC 7), else falls back
 *     to workspace-or-file resolution.
 *   - Spawn failures mark the session dead and prompt "press any key".
 *
 * @coordinates-with useTerminalSessions.ts — sole caller
 * @coordinates-with spawnPty.ts — shell process creation
 * @coordinates-with terminalMessages.ts — localized buffer status lines
 * @module components/Terminal/useTerminalShellLifecycle
 */
import { useCallback } from "react";
import { useUIStore } from "@/stores/uiStore";
import { errorMessage } from "@/utils/errorMessage";
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
import type { SessionsRef } from "./terminalSessionTypes";

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
      // WI-2.2: a new terminal inherits a live sibling's cwd (OSC 7) so it
      // starts where the user is; first terminal / no sibling →
      // workspace-or-file resolution.
      let inheritedCwd: string | undefined;
      for (const [id, sib] of sessionsRef.current) {
        if (id === sessionId || sib.disposed || !sib.pty || sib.shellExited) continue;
        const live = sib.instance.getCwd();
        if (live) {
          inheritedCwd = live;
          break;
        }
      }
      const cwd = inheritedCwd ?? resolveTerminalCwd();

      try {
        const pty = await spawnPty({
          term: entry.instance.term,
          cwd,
          onExit: (exitCode) => {
            const e = sessionsRef.current.get(sessionId);
            // Ignore a stale exit from a PTY superseded by a restart.
            if (e && !e.disposed && e.spawnGen === gen) {
              e.pty = null;
              // Clear the key-handler's PTY ref so keystrokes after exit
              // don't write to the dead process.
              e.ptyRefForKeys.current = null;
              e.shellExited = true;
              const ui = useUIStore.getState();
              if (exitCode === 0) {
                // Clean exit (Ctrl+D / `exit`) — close the tab (#1103), and
                // hide the panel when this was the last session. A hidden
                // panel stays hidden; reopening auto-creates a fresh session
                // (TerminalPanel visibility effect).
                const wasLast =
                  ui.terminal.sessions.length === 1 &&
                  ui.terminal.sessions[0].id === sessionId;
                ui.terminalRemoveSession(sessionId);
                if (wasLast && ui.terminalVisible) ui.toggleTerminal();
              } else {
                // Non-zero exit — keep the buffer readable and offer respawn.
                e.instance.term.write(processExitedLine(exitCode));
                e.instance.term.write(pressAnyKeyToRestartLine());
                ui.terminalMarkSessionDead(sessionId);
              }
            }
          },
          disposed: () => {
            const e = sessionsRef.current.get(sessionId);
            return !e || e.disposed;
          },
        });

        const currentEntry = sessionsRef.current.get(sessionId);
        if (!currentEntry || currentEntry.disposed) {
          try {
            pty.kill();
          } catch {
            /* ignore */
          }
          if (currentEntry) currentEntry.shellSpawning = false;
          return;
        }
        currentEntry.pty = pty;
        currentEntry.ptyRefForKeys.current = pty;
        currentEntry.spawnedCwd = cwd;
        currentEntry.shellSpawning = false;
        useUIStore.getState().terminalMarkSessionAlive(sessionId);

        // If workspace changed while spawning, cd to the current root.
        const currentRoot = resolveTerminalWorkspaceRoot();
        if (currentRoot && currentRoot !== cwd) {
          pty.write(buildCdCommand(currentRoot));
          currentEntry.spawnedCwd = currentRoot;
        }
      } catch (err) {
        const e = sessionsRef.current.get(sessionId);
        if (e && !e.disposed) {
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

    entry.shellExited = false;
    entry.instance.term.clear();
    entry.instance.term.write(restartingLine());

    startShell(activeId);
  }, [sessionsRef, startShell]);

  return { startShell, restartActiveSession };
}
