/**
 * useTerminalShellLifecycle
 *
 * Purpose: Owns spawning and restart for terminal sessions, and routes each
 * shell exit to terminalShellExit.
 * Extracted from useTerminalSessions so that hook focuses on registry +
 * visibility orchestration. Behavior preserved verbatim from the inline
 * implementation; user-facing status lines now route through i18n.
 *
 * Key decisions:
 *   - Re-entrance guard (shellSpawning) prevents concurrent spawns.
 *   - spawnGen ignores a stale PTY's onExit after a restart. What a current
 *     exit does (close on code 0, keep the buffer and prompt otherwise, log
 *     every exit) lives in terminalShellExit.ts.
 *   - A new terminal inherits a live sibling's cwd (OSC 7), else falls back
 *     to workspace-or-file resolution.
 *   - Spawn failures mark the session dead and prompt "press any key".
 *   - A restart during an IN-FLIGHT spawn supersedes it: restartActiveSession
 *     bumps spawnGen and clears shellSpawning, and the older attempt disowns
 *     its PTY on arrival. Without that, restarting before the first shell
 *     appeared did nothing at all.
 *   - An explicit "Open Terminal Here" cwd outranks sibling inheritance and is
 *     released only once a spawn using it succeeds.
 *   - Every PTY attaches to a PRISTINE terminal (#1471). startShell is the one
 *     path all spawns take (first, restart, press-any-key respawn), so it —
 *     not its callers — resets the terminal, waits until xterm has parsed the
 *     reset, and drops the dead program's tab title.
 *
 * @coordinates-with useTerminalSessions.ts — sole caller
 * @coordinates-with spawnPty.ts — shell process creation
 * @coordinates-with terminalShellExit.ts — what a shell exit does
 * @coordinates-with terminalSessionReset.ts — what a session boundary resets
 * @coordinates-with terminalMessages.ts — localized buffer status lines
 * @module components/Terminal/useTerminalShellLifecycle
 */
import { useCallback } from "react";
import { useTerminalStore } from "@/stores/terminalStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { initialState } from "@/stores/settingsStore/defaults";
import { errorMessage } from "@/utils/errorMessage";
import { spawnPty, resolveTerminalWorkspaceRoot } from "./spawnPty";
import { resolveTerminalSpawnContext } from "./resolveTerminalSpawnContext";
import { buildCdCommand } from "./terminalSessionStoreSync";
import { shouldFollowWorkspaceCd } from "@/services/terminal/terminalCdFollow";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { failedToStartLine, pressAnyKeyToRetryLine, restartingLine } from "./terminalMessages";
import { resetTerminalForNewSession } from "./terminalSessionReset";
import { handleShellExit } from "./terminalShellExit";
import type { SessionEntry, SessionsRef } from "./terminalSessionTypes";

/** Reset the terminal for a new PTY (#1471); settles once xterm parsed it. The
 *  blink setting is read then, because xterm keeps a program's `?12` in it. */
function resetForNewSession(entry: SessionEntry, statusLine: string): Promise<void> {
  const cursorBlink = () =>
    ({ ...initialState.terminal, ...useSettingsStore.getState().terminal }).cursorBlink;
  return resetTerminalForNewSession(entry.instance.term, { cursorBlink, statusLine });
}

/** The OSC 0/2 tab title belonged to the dead program: fall back to the label. */
function dropProgramTitle(sessionId: string): void {
  const store = useTerminalStore.getState();
  const hasTitle = store.sessions.some((s) => s.id === sessionId && s.programTitle);
  if (hasTitle) store.terminalSetProgramTitle(sessionId, "");
}

export interface TerminalShellLifecycle {
  /** Spawn the shell for a session on a freshly reset terminal, showing
   *  `statusLine` (if any) until the shell draws. Guarded against re-entrance. */
  startShell: (sessionId: string, statusLine?: string) => Promise<void>;
  /** Kill the active session's PTY and respawn it on a reset terminal. */
  restartActiveSession: () => void;
}

export function useTerminalShellLifecycle(
  sessionsRef: SessionsRef,
): TerminalShellLifecycle {
  const startShell = useCallback(
    async (sessionId: string, statusLine = "") => {
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
      const resetParsed = resetForNewSession(entry, statusLine);
      // An EXPLICIT request ("Open Terminal Here") outranks
      // everything else. PEEKED, not consumed: it is cleared only once the
      // spawn succeeds, so a failed first spawn can still be retried in the
      // directory the user actually asked for.
      const requestedCwd = useTerminalStore.getState().terminalPeekRequestedCwd(sessionId);
      // D-T9 (WI-TS4.1): cwd AND the env's workspace root come from the ONE
      // spawn-context contract — request > same-scope sibling OSC-7 cwd >
      // owner scope > active-scope/file fallback — resolved ONCE before the
      // await, so a rail switch mid-spawn cannot retarget either.
      const storeSession = useTerminalStore
        .getState()
        .sessions.find((s) => s.id === sessionId);
      const context = resolveTerminalSpawnContext(
        getCurrentWindowLabel(),
        storeSession,
        (siblingId) => {
          const sib = sessionsRef.current.get(siblingId);
          if (!sib || sib.disposed || !sib.pty || sib.shellExited) return undefined;
          return sib.instance.getCwd() ?? undefined;
        },
      );
      const cwd = context.cwd;
      // Captured BEFORE the await so the post-spawn check can tell "the
      // workspace changed while we were spawning" from "this session simply
      // starts somewhere other than the workspace root". Comparing the root
      // against `cwd` conflated the two and immediately cd'd a sibling-
      // inheriting terminal back to the root, undoing the sibling-cwd inheritance (Codex audit).
      const rootBeforeSpawn = resolveTerminalWorkspaceRoot();

      // Spawn only once the reset is parsed: until then the dead program's
      // modes still turn pointer motion and query replies into input. Stand
      // down if a restart or a removal overtook this attempt meanwhile.
      await resetParsed;
      const live = sessionsRef.current.get(sessionId);
      if (!live || live.disposed || live.spawnGen !== gen) return;
      dropProgramTitle(sessionId);

      try {
        const pty = await spawnPty({
          sessionId,
          ...(storeSession?.windowsShell ? { windowsShell: storeSession.windowsShell } : {}),
          ...(storeSession?.pendingCode !== undefined && !storeSession.codeBlockDispatched ? {
            codeBlockSource: storeSession.pendingCode,
            claimCodeBlock: () => useTerminalStore.getState().terminalClaimPendingCode(sessionId),
          } : {}),
          term: entry.instance.term,
          // Omitted when nothing resolved a directory — see spawnPty's cwd note.
          ...(cwd !== undefined ? { cwd } : {}),
          ...(context.workspaceRoot !== undefined
            ? { workspaceRoot: context.workspaceRoot }
            : {}),
          onExit: (exitCode) => {
            const e = sessionsRef.current.get(sessionId);
            // Ignore a stale exit from a PTY superseded by a restart.
            if (!e || e.disposed || e.spawnGen !== gen) return;
            handleShellExit(e, sessionId, exitCode);
          },
          disposed: () => {
            const e = sessionsRef.current.get(sessionId);
            return !e || e.disposed || e.spawnGen !== gen;
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
        useTerminalStore.getState().terminalMarkSessionAlive(sessionId);
        if (storeSession?.pendingCode !== undefined) {
          useTerminalStore.getState().terminalClearPendingCode(sessionId);
        }
        // The requested directory has now been honored — release it so a later
        // restart resolves normally instead of re-anchoring to a stale request.
        if (requestedCwd) useTerminalStore.getState().terminalClearRequestedCwd(sessionId);

        // If the workspace changed WHILE spawning, cd to the new root — but
        // NOT when the user explicitly asked for a directory, and
        // NOT for a scope-stamped session (WI-TS2.1/D-T4 — its workspace
        // never changes under it; a rail switch hides it instead). That
        // catch-up `cd` would otherwise walk the shell straight back out of
        // the folder they right-clicked, which looks like the feature is
        // broken rather than like a workspace sync.
        const currentRoot = resolveTerminalWorkspaceRoot();
        if (
          !requestedCwd &&
          currentRoot &&
          currentRoot !== rootBeforeSpawn &&
          shouldFollowWorkspaceCd(sessionId)
        ) {
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
          useTerminalStore.getState().terminalMarkSessionDead(sessionId);
        }
      }
    },
    [sessionsRef],
  );

  const restartActiveSession = useCallback(() => {
    const activeId = useTerminalStore.getState().activeSessionId;
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
    // startShell resets the terminal (#1471), so it writes the notice too —
    // written here first, the reset would wipe it.
    void startShell(activeId, restartingLine());
  }, [sessionsRef, startShell]);

  return { startShell, restartActiveSession };
}
