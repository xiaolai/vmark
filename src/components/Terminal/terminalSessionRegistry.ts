/**
 * terminalSessionRegistry
 *
 * Purpose: Pure registry/visibility helpers for terminal sessions, extracted
 * from useTerminalSessions so that hook focuses on wiring. These operate on a
 * sessions map and carry no React state. Behavior preserved verbatim.
 *
 * @coordinates-with useTerminalSessions.ts — sole caller
 * @module components/Terminal/terminalSessionRegistry
 */
import type { SessionEntry, SessionsRef } from "./terminalSessionTypes";

/** Remove a session — cancel pending rAF, kill PTY, and dispose instance. */
export function removeSessionEntry(
  sessionsRef: SessionsRef,
  sessionId: string,
): void {
  const entry = sessionsRef.current.get(sessionId);
  if (!entry) return;
  entry.disposed = true;
  if (entry.pendingRafId !== null) {
    cancelAnimationFrame(entry.pendingRafId);
    entry.pendingRafId = null;
  }
  if (entry.pty) {
    try {
      entry.pty.kill();
    } catch {
      /* ignore */
    }
  }
  entry.instance.dispose();
  sessionsRef.current.delete(sessionId);
}

/** Show the active session's container, hide others, and lazily spawn its shell
 *  after the container is visible and fitAddon has measured real dimensions. */
export function switchVisibility(
  sessionsRef: SessionsRef,
  activeId: string | null,
  startShell: (sessionId: string) => void,
): void {
  for (const [id, entry] of sessionsRef.current) {
    if (id === activeId) {
      entry.instance.container.style.display = "block";
    } else {
      entry.instance.container.style.display = "none";
      entry.instance.searchAddon.clearDecorations();
      // Cancel pending RAF to prevent spawning a shell while hidden.
      if (entry.pendingRafId !== null) {
        cancelAnimationFrame(entry.pendingRafId);
        entry.pendingRafId = null;
      }
    }
  }
  if (!activeId) return;
  const entry = sessionsRef.current.get(activeId);
  if (!entry) return;
  if (entry.pendingRafId !== null) {
    cancelAnimationFrame(entry.pendingRafId);
    entry.pendingRafId = null;
  }
  entry.pendingRafId = requestAnimationFrame(() => {
    entry.pendingRafId = null;
    try {
      entry.instance.fitAddon.fit();
      entry.instance.term.focus();
    } catch {
      /* ignore */
    }

    // Start shell after first fit so PTY gets the real dimensions instead of
    // 80×24 defaults from a hidden container. Reset first to clear blank-line
    // artifacts from opening xterm in a hidden (display:none) container.
    if (!entry.shellStarted && !entry.shellExited && !entry.disposed) {
      entry.shellStarted = true;
      entry.instance.term.reset();
      startShell(activeId);
    }
  });
}

/** Dispose every session in the map (mount-effect cleanup). */
export function disposeAllSessions(sessions: Map<string, SessionEntry>): void {
  for (const [, entry] of sessions) {
    entry.disposed = true;
    if (entry.pendingRafId !== null) {
      cancelAnimationFrame(entry.pendingRafId);
      entry.pendingRafId = null;
    }
    if (entry.pty) {
      try {
        entry.pty.kill();
      } catch {
        /* ignore */
      }
    }
    entry.instance.dispose();
  }
  sessions.clear();
}
