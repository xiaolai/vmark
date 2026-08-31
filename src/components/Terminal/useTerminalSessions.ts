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
 *   - IME forwarding (single writer per keystroke: composition commit + onData
 *     → PTY) is implemented in terminalSessionInputWiring.ts (Channel Ownership).
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
 * Also publishes a per-session terminal resolver (services/terminal/
 * activeTerminal) so non-React callers — "Run in Terminal" from a code block —
 * can reach a live xterm without a ref threaded through the tree.
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
import { initialState } from "@/stores/settingsStore/defaults";
import { currentTerminalThemeId } from "./terminalThemeId";
import { useUIStore } from "@/stores/uiStore";
import { createTerminalInstance } from "./createTerminalInstance";
import { sessionBellHandler } from "./terminalSessionBell";
import { useUIStoreSync } from "./terminalSessionStoreSync";
import { useTerminalShellLifecycle } from "./useTerminalShellLifecycle";
import { useTerminalSessionsInit } from "./useTerminalSessionsInit";
import { removeSessionEntry, switchVisibility } from "./terminalSessionRegistry";
import { registerTerminalResolver } from "@/services/terminal/activeTerminal";
import { wireSessionInput } from "./terminalSessionInputWiring";
import type { SearchAddon } from "@xterm/addon-search";
import type { SessionEntry } from "./terminalSessionTypes";
import { fitAndResizePty } from "./fitAndResizePty";
import { terminalError } from "@/utils/debug";
import { voidAsync } from "@/utils/voidAsync";

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

  // Store callbacks in a ref to avoid recreating createSession on every render.
  // The callbacks object is a new literal each render, but the individual
  // functions (onSearch) are stable useCallbacks from the parent.
  const callbacksRef = useRef(callbacks);
  // Synced after commit (read only from terminal event handlers). #1063
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  // Fit the active terminal (and propagate the new dimensions to its PTY)
  const fit = useCallback(() => {
    const activeId = useUIStore.getState().terminal.activeSessionId;
    if (!activeId) return;
    const entry = sessionsRef.current.get(activeId);
    if (!entry) return;

    // Debounce lives on the entry, so fitting one session can no longer cancel
    // another session's pending PTY resize.
    fitAndResizePty(entry, () => sessionsRef.current.get(activeId) !== entry);
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
      // OSC 133 marks for "Copy Command Output" (WI-4.4). Empty without
      // shell integration, which hides the menu item.
      getCommands: entry.instance.getCommands,
    };
  }, []);

  // Publish a per-SESSION terminal resolver for non-React callers (WI-4.3
  // "Run in Terminal"). Keyed by id rather than "the active one" so a deferred
  // delivery lands in the session it was requested for, even if the user
  // switched tabs meanwhile. Registered per window; cleared on unmount so a
  // torn-down panel cannot hand out a disposed instance.
  useEffect(
    () =>
      registerTerminalResolver((sessionId) => {
        const entry = sessionsRef.current.get(sessionId);
        return entry && !entry.disposed ? entry.instance.term : null;
      }),
    [],
  );

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

      // The store's OWN defaults, not ten literals restated here (audit #19).
      const { fontSize, lineHeight, cursorStyle, cursorBlink, useWebGL, macOptionIsMeta,
        screenReaderMode, minimumContrastRatio, scrollback, osc52Clipboard } =
        { ...initialState.terminal, ...useSettingsStore.getState().terminal };
      // A session created while a browser tab is focused opens on the neutral palette.
      const themeId = currentTerminalThemeId();

      // Create a shared ptyRef that we'll update as the pty changes
      const ptyRefForKeys: React.RefObject<IPty | null> = { current: null };

      // Construction can throw (WebGL exhaustion, disposed parent). Uncaught it
      // propagated out of the INIT EFFECT, which then never registered cleanup —
      // leaking every session built before the failure (audit #17).
      let instance;
      try {
        instance = createTerminalInstance({
        parentEl: parent,
        settings: { fontSize, lineHeight, cursorStyle, cursorBlink, useWebGL, macOptionIsMeta, screenReaderMode, minimumContrastRatio, scrollback, osc52Clipboard, themeId },
        ptyRef: ptyRefForKeys,
        onSearch: () => callbacksRef.current?.onSearch?.(),
        onBell: sessionBellHandler(sessionId),
        });
      } catch (error) {
        terminalError(`Failed to create terminal instance for ${sessionId}:`, error);
        // Audit 20260831 #38: leaving the store session alive rendered a
        // permanently blank tab that neither fit nor restart could recover
        // (no entry ever registered). Remove it — the reconcile's removal
        // pass is a no-op for an id with no live instance.
        useUIStore.getState().terminalRemoveSession(sessionId);
        return;
      }

      // Program title → per-session tab title (G4/WI-3.2). xterm parses OSC
      // 0/2 internally and exposes onTitleChange; registering our own OSC
      // handler would shadow the built-in (LIFO). The returned IDisposable is
      // owned by term.dispose() — no manual cleanup needed.
      // An EMPTY title is forwarded too: `OSC 2 ; BEL` is how a program clears a
      // title it set, and swallowing it left a stale tab name forever. The store
      // trims, so "" lands as "" and the tab falls back to its label (audit #18).
      instance.term.onTitleChange((title) => {
        useUIStore.getState().terminalSetProgramTitle(sessionId, title);
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
      };
      sessionsRef.current.set(sessionId, entry);

      // Wire IME composition commit + onData → PTY forwarding (single writer per
      // keystroke). See terminalSessionInputWiring.ts for the design notes.
      // Shell is spawned lazily by switchVisibility after the container
      // is visible and fitAddon has measured the real dimensions.
      wireSessionInput({
        sessionId,
        getEntry: (id) => sessionsRef.current.get(id),
        startShell: voidAsync(startShell, (e) => terminalError("Failed to start shell:", e)),
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
      switchVisibility(sessionsRef, activeId, voidAsync(startShell, (e) => terminalError("Failed to start shell:", e))),
    [startShell],
  );

  // Initialize on mount and subscribe to store changes. Extracted to
  // useTerminalSessionsInit.ts (WI-TS0.2) — the D-T3 reconcile (store removal
  // → dispose) and the D-T8 mount-time creator both live there.
  useTerminalSessionsInit(containerRef, sessionsRef, {
    createSession,
    removeSession,
    switchToVisible,
  });

  // Theme + workspace-root + terminal-settings sync, all in one call.
  // See terminalSessionStoreSync.ts for the per-effect design notes.
  useUIStoreSync(sessionsRef);

  return {
    fit,
    getActiveTerminal,
    getActiveSearchAddon,
    restartActiveSession,
  };
}
