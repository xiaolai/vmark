/**
 * useTerminalSessions
 *
 * Purpose: Orchestrates the lifecycle of multiple terminal sessions — each
 * with its own xterm instance and PTY process. Subscribes to
 * terminalSessionStore for create, remove, and switch operations. Concerns
 * that don't depend on the hook's closure state are extracted into helpers.
 *
 * Key decisions:
 *   - Shell spawn is deferred: the PTY is not started until the session's container
 *     is visible and fitAddon has measured real dimensions. This avoids spawning at
 *     80x24 defaults while hidden, which causes blank-line artifacts on resize.
 *   - A clean shell exit (code 0) closes the session's tab (#1103). After a
 *     non-zero exit, pressing any key respawns the shell — the "dead session"
 *     state is visually indicated in the tab bar.
 *   - IME forwarding (composition commit + onData → PTY with grace-period
 *     block and chunked re-emission dedup) is implemented in
 *     terminalSessionInputWiring.ts (#59, #454, #525, #608, #619).
 *   - Theme / workspace-root / terminal-settings sync is implemented in
 *     terminalSessionStoreSync.ts. Theme uses buildXtermThemeForId();
 *     workspace-root change auto-cd's running sessions via buildCdCommand()
 *     which Ctrl+U-clears partial input and POSIX-quotes the path.
 *   - Spawn failures are reflected in the UI via markSessionDead().
 *   - Session map (sessionsRef) is imperative (not React state) because xterm
 *     instances must be managed outside React's render cycle.
 *   - resetDisplay is exposed via getActiveTerminal() so the context menu's
 *     "Reset Display" action can clear the WebGL atlas and re-paint (#856).
 *
 * @coordinates-with TerminalPanel.tsx — provides fit(), getActiveTerminal, getActiveSearchAddon
 * @coordinates-with createTerminalInstance.ts — factory for xterm + addons
 * @coordinates-with terminalSessionStoreSync.ts — theme / workspace / settings sync effects
 * @coordinates-with terminalSessionInputWiring.ts — IME and onData → PTY wiring
 * @coordinates-with spawnPty.ts — shell process creation
 * @coordinates-with terminalSessionStore — store driving session list and active ID
 * @module components/Terminal/useTerminalSessions
 */
import { useRef, useEffect, useCallback } from "react";
import type { IPty } from "@/lib/pty";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";
import { createTerminalInstance } from "./createTerminalInstance";
import { resolveBellAction, playTerminalBell } from "./terminalBell";
import { maybeNotifyTerminalBell, flagWindowAttentionOnBell } from "@/services/terminalAttention";
import { useUIStoreSync } from "./terminalSessionStoreSync";
import { useTerminalShellLifecycle } from "./useTerminalShellLifecycle";
import {
  removeSessionEntry,
  switchVisibility,
  disposeAllSessions,
} from "./terminalSessionRegistry";
import { wireSessionInput } from "./terminalSessionInputWiring";
import type { SearchAddon } from "@xterm/addon-search";
import type { SessionEntry } from "./terminalSessionTypes";

const PTY_RESIZE_DEBOUNCE_MS = 100;

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
  // Synced after commit (read only from terminal event handlers). #1063
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  // Debounce PTY resize to avoid excessive resize calls during drag
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Fit the active terminal
  const fit = useCallback(() => {
    const activeId = useUIStore.getState().terminal.activeSessionId;
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
    const activeId = useUIStore.getState().terminal.activeSessionId;
    if (!activeId) return null;
    const entry = sessionsRef.current.get(activeId);
    return entry?.instance.searchAddon ?? null;
  }, []);

  /** Get terminal + pty refs for context menu. */
  const getActiveTerminal = useCallback(() => {
    const activeId = useUIStore.getState().terminal.activeSessionId;
    if (!activeId) return null;
    const entry = sessionsRef.current.get(activeId);
    if (!entry) return null;
    return {
      term: entry.instance.term,
      ptyRef: entry.ptyRefForKeys,
      resetDisplay: entry.instance.resetDisplay,
    };
  }, []);

  // Shell spawn / exit / restart lifecycle (with localized status lines).
  const { startShell, restartActiveSession } =
    useTerminalShellLifecycle(sessionsRef);

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
      const macOptionIsMeta = termSettings?.macOptionIsMeta ?? true;
      const screenReaderMode = termSettings?.screenReaderMode ?? false;
      const minimumContrastRatio = termSettings?.minimumContrastRatio ?? 4.5;
      const scrollback = termSettings?.scrollback ?? 5000;
      const themeId = useSettingsStore.getState().appearance.theme;

      // Create a shared ptyRef that we'll update as the pty changes
      const ptyRefForKeys: React.RefObject<IPty | null> = { current: null };

      const instance = createTerminalInstance({
        parentEl: parent,
        settings: { fontSize, lineHeight, cursorStyle, cursorBlink, useWebGL, macOptionIsMeta, screenReaderMode, minimumContrastRatio, scrollback, themeId },
        ptyRef: ptyRefForKeys,
        onSearch: () => callbacksRef.current?.onSearch?.(),
        onBell: () => {
          // Bell mode read live so setting changes affect running sessions (WI-4.3).
          const bellMode = useSettingsStore.getState().terminal?.bellMode ?? "visual";
          const isActive = useUIStore.getState().terminal.activeSessionId === sessionId;
          const action = resolveBellAction(bellMode, isActive);
          if (action.sound) playTerminalBell();
          if (action.markActivity) useUIStore.getState().terminalMarkActivity(sessionId);
          maybeNotifyTerminalBell(); // OS notice when an unfocused window rings (#1057)
          flagWindowAttentionOnBell(); // mark this window in the cross-window status panel (#1057)
        },
      });

      // Program title → per-session tab title (G4/WI-3.2). xterm parses OSC
      // 0/2 internally and exposes onTitleChange; registering our own OSC
      // handler would shadow the built-in (LIFO). The returned IDisposable is
      // owned by term.dispose() — no manual cleanup needed.
      instance.term.onTitleChange((title) => {
        if (title) useUIStore.getState().terminalSetProgramTitle(sessionId, title);
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
        spawnGen: 0,
        pendingRafId: null,
        lastSeenCommitTime: 0,
        lastCommittedConsumed: 0,
      };
      sessionsRef.current.set(sessionId, entry);

      // Wire IME composition commit + onData → PTY forwarding (with the
      // composition-grace block and chunked-re-emission dedup). See
      // terminalSessionInputWiring.ts for the design notes.
      // Shell is spawned lazily by switchVisibility after the container
      // is visible and fitAddon has measured the real dimensions.
      wireSessionInput({
        sessionId,
        getEntry: (id) => sessionsRef.current.get(id),
        startShell,
      });
    },
    [containerRef, startShell],
  );

  /** Remove a session — cancel pending rAF, kill PTY, and dispose instance. */
  const removeSession = useCallback(
    (sessionId: string) => removeSessionEntry(sessionsRef, sessionId),
    [],
  );

  /** Show active session container, hide others, and lazily spawn its shell. */
  const switchToVisible = useCallback(
    (activeId: string | null) =>
      switchVisibility(sessionsRef, activeId, startShell),
    [startShell],
  );

  // Initialize on mount — subscribe to store changes
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const state = useUIStore.getState();

    if (state.terminal.sessions.length === 0) {
      // First launch — create initial session
      const session = state.terminalCreateSession();
      if (session) {
        createSession(session.id);
        switchToVisible(session.id);
      }
    } else {
      // Sessions already exist (e.g., hot-exit restore) — create instances
      for (const s of state.terminal.sessions) {
        createSession(s.id);
      }
      switchToVisible(state.terminal.activeSessionId);
    }

    // Subscribe to store changes
    let prevSessionIds = new Set(
      useUIStore.getState().terminal.sessions.map((s) => s.id),
    );
    let prevActiveId = useUIStore.getState().terminal.activeSessionId;

    const unsubscribe = useUIStore.subscribe((storeState) => {
      const currentIds = new Set(storeState.terminal.sessions.map((s) => s.id));

      // Detect new sessions
      for (const id of currentIds) {
        if (!prevSessionIds.has(id) && !sessionsRef.current.has(id)) {
          createSession(id);
        }
      }

      // Detect removed sessions
      for (const id of prevSessionIds) {
        if (!currentIds.has(id)) {
          removeSession(id);
        }
      }

      // Detect active session change
      if (storeState.terminal.activeSessionId !== prevActiveId) {
        switchToVisible(storeState.terminal.activeSessionId);
      }

      prevSessionIds = currentIds;
      prevActiveId = storeState.terminal.activeSessionId;
    });

    const sessions = sessionsRef.current;
    return () => {
      unsubscribe();
      clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = undefined;
      disposeAllSessions(sessions);
      initializedRef.current = false;
    };
  }, [containerRef, createSession, removeSession, switchToVisible]);

  // Theme + workspace-root + terminal-settings sync, all in one call.
  // See terminalSessionStoreSync.ts for the per-effect design notes.
  useUIStoreSync(sessionsRef);

  return {
    fit,
    getActiveTerminal,
    getActiveSearchAddon,
    restartActiveSession,
    sessionsRef,
  };
}
