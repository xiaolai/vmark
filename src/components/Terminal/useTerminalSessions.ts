/**
 * useTerminalSessions
 *
 * Purpose: Manages the lifecycle of multiple terminal sessions — each with its own
 * xterm instance and PTY process. Subscribes to terminalSessionStore for create,
 * remove, and switch operations.
 *
 * Key decisions:
 *   - Shell spawn is deferred: the PTY is not started until the session's container
 *     is visible and fitAddon has measured real dimensions. This avoids spawning at
 *     80x24 defaults while hidden, which causes blank-line artifacts on resize.
 *   - After a shell exits, pressing any key respawns it — no manual restart needed.
 *     The "dead session" state is visually indicated in the tab bar.
 *   - IME composition guard: during active composition all onData is blocked;
 *     during the 80ms grace period only ASCII data is blocked (garbled spaces)
 *     while non-ASCII (CJK punctuation) passes through (#454). Clean committed
 *     text is written directly via onCompositionCommit. Late onData events
 *     matching recently committed text are deduplicated within 150ms (#525).
 *   - Theme sync uses buildXtermThemeForId() from terminalTheme.ts for
 *     per-theme ANSI color palettes. Font size and workspace root changes
 *     are also synced across all sessions via store subscriptions.
 *   - Workspace root change auto-cd's running sessions via buildCdCommand(),
 *     which escapes paths for shell safety (Ctrl+U clears partial input first).
 *   - Spawn failures are reflected in the UI via markSessionDead().
 *   - Session map (sessionsRef) is imperative (not React state) because xterm
 *     instances must be managed outside React's render cycle.
 *
 * @coordinates-with TerminalPanel.tsx — provides fit(), getActiveTerminal, getActiveSearchAddon
 * @coordinates-with createTerminalInstance.ts — factory for xterm + addons
 * @coordinates-with terminalTheme.ts — per-theme ANSI color palettes for xterm.js
 * @coordinates-with spawnPty.ts — shell process creation
 * @coordinates-with terminalSessionStore — store driving session list and active ID
 * @module components/Terminal/useTerminalSessions
 */
import { useRef, useEffect, useCallback } from "react";
import type { IPty } from "@/lib/pty";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTerminalSessionStore } from "@/stores/terminalSessionStore";
import {
  createTerminalInstance,
  type TerminalInstance,
} from "./createTerminalInstance";
import { buildXtermThemeForId } from "./terminalTheme";
import { spawnPty, resolveTerminalCwd } from "./spawnPty";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { SearchAddon } from "@xterm/addon-search";

const PTY_RESIZE_DEBOUNCE_MS = 100;

/**
 * Escape a path for shell `cd` command.
 * POSIX: wraps in single quotes with proper escaping.
 * Note: VMark is macOS-primary; Windows best-effort.
 */
function escapePathForCd(path: string): string {
  const sanitized = path.replace(/[\n\r]/g, "");
  return sanitized.replace(/'/g, "'\\''");
}

/** Build a cd command string for the given path. */
function buildCdCommand(path: string): string {
  const escaped = escapePathForCd(path);
  // Ctrl+U clears any partial input, then cd
  return `\x15cd '${escaped}'\n`;
}

interface SessionEntry {
  instance: TerminalInstance;
  pty: IPty | null;
  ptyRefForKeys: React.RefObject<IPty | null>;
  spawnedCwd: string | undefined;
  shellStarted: boolean;
  shellExited: boolean;
  shellSpawning: boolean;
  disposed: boolean;
  pendingRafId: number | null;
}

/** Callbacks passed to the terminal sessions hook for panel-level actions. */
export interface UseTerminalSessionsCallbacks {
  onSearch?: () => void;
}
/** Hook managing the lifecycle of multiple terminal sessions (xterm + PTY) with theme and workspace sync. */
export function useTerminalSessions(
  containerRef: React.RefObject<HTMLDivElement | null>,
  callbacks?: UseTerminalSessionsCallbacks,
) {
  const sessionsRef = useRef<Map<string, SessionEntry>>(new Map());
  const initializedRef = useRef(false);

  // Store callbacks in a ref to avoid recreating createSession on every render.
  // The callbacks object is a new literal each render, but the individual
  // functions (onSearch) are stable useCallbacks from the parent.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Debounce PTY resize to avoid excessive resize calls during drag
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Fit the active terminal
  const fit = useCallback(() => {
    const activeId = useTerminalSessionStore.getState().activeSessionId;
    if (!activeId) return;
    const entry = sessionsRef.current.get(activeId);
    if (!entry) return;

    try {
      entry.instance.fitAddon.fit();
      // Debounce PTY resize — visual fit is instant, but PTY resize is deferred
      clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        if (entry.disposed || sessionsRef.current.get(activeId) !== entry) return;
        const { term } = entry.instance;
        if (entry.pty && term.cols > 0 && term.rows > 0) {
          try {
            entry.pty.resize(term.cols, term.rows);
          } catch {
            // PTY may have exited/disposed between debounce ticks
          }
        }
      }, PTY_RESIZE_DEBOUNCE_MS);
    } catch {
      // Container may not be visible
    }
  }, []);

  /** Get search addon of active session. */
  const getActiveSearchAddon = useCallback((): SearchAddon | null => {
    const activeId = useTerminalSessionStore.getState().activeSessionId;
    if (!activeId) return null;
    const entry = sessionsRef.current.get(activeId);
    return entry?.instance.searchAddon ?? null;
  }, []);

  /** Get terminal + pty refs for context menu. */
  const getActiveTerminal = useCallback(() => {
    const activeId = useTerminalSessionStore.getState().activeSessionId;
    if (!activeId) return null;
    const entry = sessionsRef.current.get(activeId);
    if (!entry) return null;
    return { term: entry.instance.term, ptyRef: entry.ptyRefForKeys };
  }, []);

  /** Spawn shell for a session entry. Guarded against re-entrance. */
  const startShell = useCallback(async (sessionId: string) => {
    const entry = sessionsRef.current.get(sessionId);
    if (!entry || entry.disposed) return;

    // Re-entrance guard: prevent concurrent spawns for the same session
    if (entry.shellSpawning) return;
    entry.shellSpawning = true;

    entry.shellExited = false;
    const cwd = resolveTerminalCwd();

    try {
      const pty = await spawnPty({
        term: entry.instance.term,
        cwd,
        onExit: (exitCode) => {
          const e = sessionsRef.current.get(sessionId);
          if (e && !e.disposed) {
            e.instance.term.write(
              `\r\n[Process exited with code ${exitCode}]\r\n`,
            );
            e.instance.term.write("Press any key to restart...\r\n");
            e.pty = null;
            e.shellExited = true;
            useTerminalSessionStore.getState().markSessionDead(sessionId);
          }
        },
        disposed: () => {
          const e = sessionsRef.current.get(sessionId);
          return !e || e.disposed;
        },
      });

      const currentEntry = sessionsRef.current.get(sessionId);
      if (!currentEntry || currentEntry.disposed) {
        try { pty.kill(); } catch { /* ignore */ }
        if (currentEntry) currentEntry.shellSpawning = false;
        return;
      }
      currentEntry.pty = pty;
      currentEntry.ptyRefForKeys.current = pty;
      currentEntry.spawnedCwd = cwd;
      currentEntry.shellSpawning = false;
      useTerminalSessionStore.getState().markSessionAlive(sessionId);

      // If workspace changed while spawning, cd to the current root
      const currentRoot = useWorkspaceStore.getState().rootPath;
      if (currentRoot && currentRoot !== cwd) {
        pty.write(buildCdCommand(currentRoot));
        currentEntry.spawnedCwd = currentRoot;
      }
    } catch (err) {
      const e = sessionsRef.current.get(sessionId);
      if (e && !e.disposed) {
        e.shellSpawning = false;
        const errMsg = err instanceof Error ? err.message : String(err);
        e.instance.term.write(`\r\nFailed to start shell: ${errMsg}\r\n`);
        e.instance.term.write("Press any key to retry...\r\n");
        e.shellExited = true;
        useTerminalSessionStore.getState().markSessionDead(sessionId);
      }
    }
  }, []);

  /** Kill current PTY, clear terminal, respawn shell for the active session. */
  const restartActiveSession = useCallback(() => {
    const activeId = useTerminalSessionStore.getState().activeSessionId;
    if (!activeId) return;
    const entry = sessionsRef.current.get(activeId);
    if (!entry || entry.disposed) return;

    // Kill current PTY
    if (entry.pty) {
      try { entry.pty.kill(); } catch { /* ignore */ }
      entry.pty = null;
      entry.ptyRefForKeys.current = null;
    }

    entry.shellExited = false;
    entry.instance.term.clear();
    entry.instance.term.write("\r\nRestarting shell...\r\n");

    startShell(activeId);
  }, [startShell]);

  /** Create a new session with xterm + PTY. */
  const createSession = useCallback(
    (sessionId: string) => {
      const parent = containerRef.current;
      if (!parent) return;

      // Skip if already exists (guard against double-init)
      if (sessionsRef.current.has(sessionId)) return;

      const termSettings = useSettingsStore.getState().terminal;
      const fontSize = termSettings?.fontSize ?? 13;
      const lineHeight = termSettings?.lineHeight ?? 1.2;
      const cursorStyle = termSettings?.cursorStyle ?? "bar";
      const cursorBlink = termSettings?.cursorBlink ?? true;
      const useWebGL = termSettings?.useWebGL ?? true;

      // Create a shared ptyRef that we'll update as the pty changes
      const ptyRefForKeys: React.RefObject<IPty | null> = { current: null };

      const instance = createTerminalInstance({
        parentEl: parent,
        settings: { fontSize, lineHeight, cursorStyle, cursorBlink, useWebGL },
        ptyRef: ptyRefForKeys,
        onSearch: () => callbacksRef.current?.onSearch?.(),
      });

      const entry: SessionEntry = {
        instance,
        pty: null,
        ptyRefForKeys,
        spawnedCwd: undefined,
        shellStarted: false,
        shellExited: false,
        shellSpawning: false,
        disposed: false,
        pendingRafId: null,
      };
      sessionsRef.current.set(sessionId, entry);

      // IME composition commit: write clean committed text directly to PTY,
      // bypassing xterm's onData which may inject spaces (macOS Chinese IME).
      // If the shell is dead/spawning, restart it — don't silently drop CJK input.
      instance.onCompositionCommit = (text: string) => {
        const e = sessionsRef.current.get(sessionId);
        if (!e) return;
        if (e.pty) {
          e.pty.write(text);
        } else if (e.shellExited) {
          // "Press any key to restart" — treat IME commit as that key
          e.shellExited = false;
          e.instance.term.clear();
          startShell(sessionId);
        }
      };

      // xterm → PTY (or restart on key press after exit)
      instance.term.onData((data) => {
        const e = sessionsRef.current.get(sessionId);
        if (!e) return;
        // Ignore preedit data leaked by xterm during IME composition (issue #59).
        // During active composition: block everything (preedit is garbled).
        // During grace period: only block ASCII data (garbled syllable spaces);
        // let non-ASCII through so CJK punctuation isn't silently dropped (#454).
        if (instance.composing) {
          if (!instance.inGracePeriod) return; // active composition — block all
          // Grace period: block the committed text xterm re-emits (#608).
          // Without this, CJK text (e.g., "你好") passes the ASCII-only check below,
          // gets written to PTY, and then onCompositionCommit writes it again → duplication.
          if (instance.pendingCommitText && data === instance.pendingCommitText) return;
          // eslint-disable-next-line no-control-regex
          if (/^[\x00-\x7F]+$/.test(data)) return; // grace period — block ASCII only
        }
        // Deduplicate: WeChat IME may send onData with the same text that was
        // already committed via onCompositionCommit. Skip if data matches the
        // last committed text and arrives within 150ms of the commit (#525).
        if (
          instance.lastCommittedText &&
          data === instance.lastCommittedText &&
          Date.now() - instance.lastCommitTime < 150
        ) {
          return;
        }
        if (e.shellExited && !e.pty) {
          e.shellExited = false;
          e.instance.term.clear();
          startShell(sessionId);
          return;
        }
        if (e.pty) {
          e.pty.write(data);
        }
      });

      // Shell is spawned lazily by switchVisibility after the container
      // is visible and fitAddon has measured the real dimensions.
      // This avoids spawning at 80×24 defaults while hidden, which
      // causes blank lines when the terminal is later resized.
    },
    [containerRef, startShell],
  );

  /** Remove a session — cancel pending rAF, kill PTY, and dispose instance. */
  const removeSessionEntry = useCallback((sessionId: string) => {
    const entry = sessionsRef.current.get(sessionId);
    if (!entry) return;
    entry.disposed = true;
    if (entry.pendingRafId !== null) {
      cancelAnimationFrame(entry.pendingRafId);
      entry.pendingRafId = null;
    }
    if (entry.pty) {
      try { entry.pty.kill(); } catch { /* ignore */ }
    }
    entry.instance.dispose();
    sessionsRef.current.delete(sessionId);
  }, []);

  /** Show active session container, hide others. */
  const switchVisibility = useCallback((activeId: string | null) => {
    for (const [id, entry] of sessionsRef.current) {
      if (id === activeId) {
        entry.instance.container.style.display = "block";
      } else {
        entry.instance.container.style.display = "none";
        entry.instance.searchAddon.clearDecorations();
        // Cancel pending RAF to prevent spawning a shell while hidden
        if (entry.pendingRafId !== null) {
          cancelAnimationFrame(entry.pendingRafId);
          entry.pendingRafId = null;
        }
      }
    }
    if (activeId) {
      const entry = sessionsRef.current.get(activeId);
      if (entry) {
        if (entry.pendingRafId !== null) {
          cancelAnimationFrame(entry.pendingRafId);
          entry.pendingRafId = null;
        }
        entry.pendingRafId = requestAnimationFrame(() => {
          entry.pendingRafId = null;
          try {
            entry.instance.fitAddon.fit();
            entry.instance.term.focus();
          } catch { /* ignore */ }

          // Start shell after first fit so PTY gets the real dimensions
          // instead of 80×24 defaults from a hidden container.
          // Reset first to clear blank-line artifacts from opening xterm
          // in a hidden (display:none) container where it can't measure properly.
          if (!entry.shellStarted && !entry.shellExited && !entry.disposed) {
            entry.shellStarted = true;
            entry.instance.term.reset();
            startShell(activeId);
          }
        });
      }
    }
  }, [startShell]);

  // Initialize on mount — subscribe to store changes
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const state = useTerminalSessionStore.getState();

    if (state.sessions.length === 0) {
      // First launch — create initial session
      const session = state.createSession();
      if (session) {
        createSession(session.id);
        switchVisibility(session.id);
      }
    } else {
      // Sessions already exist (e.g., hot-exit restore) — create instances
      for (const s of state.sessions) {
        createSession(s.id);
      }
      switchVisibility(state.activeSessionId);
    }

    // Subscribe to store changes
    let prevSessionIds = new Set(
      useTerminalSessionStore.getState().sessions.map((s) => s.id),
    );
    let prevActiveId = useTerminalSessionStore.getState().activeSessionId;

    const unsubscribe = useTerminalSessionStore.subscribe((storeState) => {
      const currentIds = new Set(storeState.sessions.map((s) => s.id));

      // Detect new sessions
      for (const id of currentIds) {
        if (!prevSessionIds.has(id) && !sessionsRef.current.has(id)) {
          createSession(id);
        }
      }

      // Detect removed sessions
      for (const id of prevSessionIds) {
        if (!currentIds.has(id)) {
          removeSessionEntry(id);
        }
      }

      // Detect active session change
      if (storeState.activeSessionId !== prevActiveId) {
        switchVisibility(storeState.activeSessionId);
      }

      prevSessionIds = currentIds;
      prevActiveId = storeState.activeSessionId;
    });

    const sessions = sessionsRef.current;
    return () => {
      unsubscribe();
      clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = undefined;
      // Dispose all sessions
      for (const [, entry] of sessions) {
        entry.disposed = true;
        if (entry.pendingRafId !== null) {
          cancelAnimationFrame(entry.pendingRafId);
          entry.pendingRafId = null;
        }
        if (entry.pty) {
          try { entry.pty.kill(); } catch { /* ignore */ }
        }
        entry.instance.dispose();
      }
      sessions.clear();
      initializedRef.current = false;
    };
  }, [containerRef, createSession, removeSessionEntry, switchVisibility]);

  // Sync theme across all sessions when settings change
  useEffect(() => {
    let prevTheme = useSettingsStore.getState().appearance.theme;
    return useSettingsStore.subscribe((state) => {
      const themeId = state.appearance.theme;
      if (themeId === prevTheme) return;
      prevTheme = themeId;
      const newTheme = buildXtermThemeForId(themeId);
      for (const [, entry] of sessionsRef.current) {
        entry.instance.term.options.theme = newTheme;
      }
    });
  }, []);

  // cd running sessions when workspace root changes
  useEffect(() => {
    let prevRoot = useWorkspaceStore.getState().rootPath;
    return useWorkspaceStore.subscribe((state) => {
      const newRoot = state.rootPath;
      if (!newRoot || newRoot === prevRoot) {
        prevRoot = newRoot;
        return;
      }
      prevRoot = newRoot;

      const cdCommand = buildCdCommand(newRoot);
      for (const [, entry] of sessionsRef.current) {
        if (entry.pty && !entry.shellExited && entry.spawnedCwd !== newRoot) {
          entry.pty.write(cdCommand);
          entry.spawnedCwd = newRoot;
        }
      }
    });
  }, []);

  // Sync terminal settings (font, cursor) across all sessions when changed
  useEffect(() => {
    const getTermSettings = () => useSettingsStore.getState().terminal;
    let prev = getTermSettings();
    return useSettingsStore.subscribe((state) => {
      const curr = state.terminal;
      if (!curr || !prev) { prev = curr; return; }
      const fontChanged = curr.fontSize !== prev.fontSize || curr.lineHeight !== prev.lineHeight;
      const cursorChanged = curr.cursorStyle !== prev.cursorStyle || curr.cursorBlink !== prev.cursorBlink;
      if (!fontChanged && !cursorChanged) return;
      prev = curr;
      for (const [, entry] of sessionsRef.current) {
        const opts = entry.instance.term.options;
        if (fontChanged) {
          opts.fontSize = curr.fontSize;
          opts.lineHeight = curr.lineHeight;
        }
        if (cursorChanged) {
          opts.cursorStyle = curr.cursorStyle;
          opts.cursorBlink = curr.cursorBlink;
        }
        if (fontChanged) {
          try { entry.instance.fitAddon.fit(); } catch { /* ignore */ }
        }
      }
    });
  }, []);

  return {
    fit,
    getActiveTerminal,
    getActiveSearchAddon,
    restartActiveSession,
    sessionsRef,
  };
}
