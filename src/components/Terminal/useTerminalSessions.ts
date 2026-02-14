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
 *   - IME composition guard: data from onData during compositionstart..compositionend
 *     is dropped to prevent garbled preedit text from being sent to the PTY.
 *   - Theme, font size, and workspace root changes are synced across all sessions
 *     via settingsStore/workspaceStore subscriptions. Workspace root change
 *     auto-cd's running sessions (Ctrl+U to clear partial input first).
 *   - Session map (sessionsRef) is imperative (not React state) because xterm
 *     instances must be managed outside React's render cycle.
 *
 * @coordinates-with TerminalPanel.tsx — provides fit(), getActiveTerminal, getActiveSearchAddon
 * @coordinates-with createTerminalInstance.ts — factory for xterm + addons
 * @coordinates-with spawnPty.ts — shell process creation
 * @coordinates-with terminalSessionStore — store driving session list and active ID
 * @module components/Terminal/useTerminalSessions
 */
import { useRef, useEffect, useCallback } from "react";
import type { IPty } from "tauri-pty";
import { useSettingsStore, themes } from "@/stores/settingsStore";
import { useTerminalSessionStore } from "@/stores/terminalSessionStore";
import {
  createTerminalInstance,
  type TerminalInstance,
} from "./createTerminalInstance";
import { spawnPty, resolveTerminalCwd } from "./spawnPty";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { SearchAddon } from "@xterm/addon-search";

interface SessionEntry {
  instance: TerminalInstance;
  pty: IPty | null;
  ptyRefForKeys: React.RefObject<IPty | null>;
  spawnedCwd: string | undefined;
  shellStarted: boolean;
  shellExited: boolean;
  disposed: boolean;
}

export interface UseTerminalSessionsCallbacks {
  onSearch?: () => void;
}
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

  // Fit the active terminal
  const fit = useCallback(() => {
    const activeId = useTerminalSessionStore.getState().activeSessionId;
    if (!activeId) return;
    const entry = sessionsRef.current.get(activeId);
    if (!entry) return;

    try {
      entry.instance.fitAddon.fit();
      const { term } = entry.instance;
      if (entry.pty && term.cols > 0 && term.rows > 0) {
        entry.pty.resize(term.cols, term.rows);
      }
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

  /** Spawn shell for a session entry. */
  const startShell = useCallback(async (sessionId: string) => {
    const entry = sessionsRef.current.get(sessionId);
    if (!entry || entry.disposed) return;

    entry.shellExited = false;
    const cwd = resolveTerminalCwd();

    try {
      const pty = await spawnPty({
        term: entry.instance.term,
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
        return;
      }
      currentEntry.pty = pty;
      currentEntry.spawnedCwd = cwd;

      // If workspace changed while spawning, cd to the current root
      const currentRoot = useWorkspaceStore.getState().rootPath;
      if (currentRoot && currentRoot !== cwd) {
        const escaped = currentRoot.replace(/'/g, "'\\''");
        pty.write(`\x15cd '${escaped}'\n`);
        currentEntry.spawnedCwd = currentRoot;
      }
    } catch (err) {
      const e = sessionsRef.current.get(sessionId);
      if (e && !e.disposed) {
        e.instance.term.write(`\r\nFailed to start shell: ${err}\r\n`);
        e.instance.term.write("Press any key to retry...\r\n");
        e.shellExited = true;
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

    startShell(activeId).then(() => {
      const e = sessionsRef.current.get(activeId);
      if (e) e.ptyRefForKeys.current = e.pty;
    });
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
      const useWebGL = termSettings?.useWebGL ?? true;

      // Create a shared ptyRef that we'll update as the pty changes
      const ptyRefForKeys: React.RefObject<IPty | null> = { current: null };

      const instance = createTerminalInstance({
        parentEl: parent,
        settings: { fontSize, lineHeight, useWebGL },
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
        disposed: false,
      };
      sessionsRef.current.set(sessionId, entry);

      // xterm → PTY (or restart on key press after exit)
      instance.term.onData((data) => {
        const e = sessionsRef.current.get(sessionId);
        if (!e) return;
        // Ignore preedit data leaked by xterm during IME composition (issue #59)
        if (instance.composing) return;
        if (e.shellExited && !e.pty) {
          e.shellExited = false;
          e.instance.term.clear();
          startShell(sessionId).then(() => {
            // Update ptyRef for key handler after reconnect
            const refreshed = sessionsRef.current.get(sessionId);
            if (refreshed) ptyRefForKeys.current = refreshed.pty;
          });
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

  /** Remove a session — kill PTY and dispose instance. */
  const removeSessionEntry = useCallback((sessionId: string) => {
    const entry = sessionsRef.current.get(sessionId);
    if (!entry) return;
    entry.disposed = true;
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
      }
    }
    if (activeId) {
      const entry = sessionsRef.current.get(activeId);
      if (entry) {
        requestAnimationFrame(() => {
          try {
            entry.instance.fitAddon.fit();
            entry.instance.term.focus();
          } catch { /* ignore */ }

          // Start shell after first fit so PTY gets the real dimensions
          // instead of 80×24 defaults from a hidden container
          if (!entry.shellStarted && !entry.shellExited && !entry.disposed) {
            entry.shellStarted = true;
            startShell(activeId).then(() => {
              const e = sessionsRef.current.get(activeId);
              if (e) e.ptyRefForKeys.current = e.pty;
            });
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

    return () => {
      unsubscribe();
      // Dispose all sessions
      for (const [, entry] of sessionsRef.current) {
        entry.disposed = true;
        if (entry.pty) {
          try { entry.pty.kill(); } catch { /* ignore */ }
        }
        entry.instance.dispose();
      }
      sessionsRef.current.clear();
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
      const colors = themes[themeId];
      const newTheme = {
        background: colors.background,
        foreground: colors.foreground,
        cursor: colors.foreground,
        cursorAccent: colors.background,
        selectionBackground: colors.selection ?? "rgba(0,102,204,0.25)",
      };
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

      const escaped = newRoot.replace(/'/g, "'\\''");
      for (const [, entry] of sessionsRef.current) {
        if (entry.pty && !entry.shellExited && entry.spawnedCwd !== newRoot) {
          // Ctrl+U clears any partial input, then cd to new workspace
          entry.pty.write(`\x15cd '${escaped}'\n`);
          entry.spawnedCwd = newRoot;
        }
      }
    });
  }, []);

  // Sync font size across all sessions when terminal settings change
  useEffect(() => {
    const getTermSettings = () => useSettingsStore.getState().terminal;
    let prev = getTermSettings();
    return useSettingsStore.subscribe((state) => {
      const curr = state.terminal;
      if (!curr || !prev) { prev = curr; return; }
      if (curr.fontSize === prev.fontSize && curr.lineHeight === prev.lineHeight) return;
      prev = curr;
      for (const [, entry] of sessionsRef.current) {
        entry.instance.term.options.fontSize = curr.fontSize;
        entry.instance.term.options.lineHeight = curr.lineHeight;
        try { entry.instance.fitAddon.fit(); } catch { /* ignore */ }
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
