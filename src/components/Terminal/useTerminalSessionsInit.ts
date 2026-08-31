/**
 * useTerminalSessionsInit
 *
 * Purpose: mount-time initialization + store subscription for the terminal
 * session registry. Extracted verbatim from useTerminalSessions.ts (WI-TS0.2
 * pre-split). Owns two responsibilities the plan's decision record cites:
 *   - D-T3's reconcile: an id that LEFT the store array means dispose xterm +
 *     kill PTY (via removeSession → removeSessionEntry). A workspace switch
 *     must therefore never remove ids from the store.
 *   - D-T8's mount-time creator: the first-launch auto-create for a window
 *     with no sessions.
 *
 * @coordinates-with useTerminalSessions.ts — sole caller
 * @coordinates-with terminalSessionReconcile.ts — pure id diff
 * @coordinates-with terminalSessionRegistry.ts — dispose helpers
 * @module components/Terminal/useTerminalSessionsInit
 */
import { useEffect, useRef } from "react";
import { useUIStore } from "@/stores/uiStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { maybeAutoCreateTerminalSession } from "@/services/terminal/maybeAutoCreateTerminalSession";
import { diffSessionIds } from "./terminalSessionReconcile";
import { disposeAllSessions } from "./terminalSessionRegistry";
import type { SessionsRef } from "./terminalSessionTypes";

export interface TerminalSessionsInitCallbacks {
  createSession: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
  switchToVisible: (activeId: string | null) => void;
}

/** Initialize on mount and subscribe to store changes (create/remove/switch). */
export function useTerminalSessionsInit(
  containerRef: React.RefObject<HTMLDivElement | null>,
  sessionsRef: SessionsRef,
  { createSession, removeSession, switchToVisible }: TerminalSessionsInitCallbacks,
): void {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const state = useUIStore.getState();

    if (state.terminal.sessions.length === 0) {
      // First launch — auto-create through the ONE shared gate (WI-TS3.2 /
      // D-T8). This creator used to be unconditional, so a hot-exit-restored
      // visible panel over a refusing scope spawned a shell into $HOME; a
      // refusal now leaves the panel's empty-state hint instead.
      if (maybeAutoCreateTerminalSession(getCurrentWindowLabel())) {
        const createdId = useUIStore.getState().terminal.activeSessionId;
        if (createdId) {
          createSession(createdId);
          switchToVisible(createdId);
        }
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

      const { added, removed } = diffSessionIds(prevSessionIds, currentIds, (id) =>
        sessionsRef.current.has(id));
      for (const id of added) createSession(id);
      for (const id of removed) removeSession(id);

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
      // Per-entry PTY resize timers are cleared by disposeAllSessions.
      disposeAllSessions(sessions);
      initializedRef.current = false;
    };
  }, [containerRef, sessionsRef, createSession, removeSession, switchToVisible]);
}
