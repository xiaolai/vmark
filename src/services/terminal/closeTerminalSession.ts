/**
 * closeTerminalSession — the ONE remove-session + panel-hide policy
 * (audit 20260831 #32).
 *
 * Purpose: TerminalPanel's close button and the clean-exit path had grown
 * near-identical copies of "remove the session, pick a visible fallback,
 * hide the panel when it was the last visible one" — and the predicates had
 * already drifted (`<= 1` versus exact visible membership).
 *
 * Semantics:
 *   - `onlyIfVisible` (the UI close button): a stale active id pointing at a
 *     HIDDEN session is refused outright — clicking close must never remove
 *     a session the user cannot see.
 *   - Without it (clean exit): the session is removed regardless — a hidden
 *     scope's shell exiting cleanly still closes its tab — but the panel
 *     hides only when the closed session was the last VISIBLE one (D-T7).
 *   - The hide re-reads visibility and never TOGGLES a hidden panel back on
 *     (the journey-35 resurrect).
 *
 * @coordinates-with components/Terminal/TerminalPanel.tsx — close button
 * @coordinates-with components/Terminal/useTerminalShellLifecycle.ts — clean exit
 * @module services/terminal/closeTerminalSession
 */
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { useUIStore } from "@/stores/uiStore";
import { getVisibleTerminalSessions } from "./visibleTerminalSessions";

export function removeTerminalSessionWithPanelPolicy(
  sessionId: string,
  opts?: { onlyIfVisible?: boolean },
): void {
  const visibleIds = getVisibleTerminalSessions(getCurrentWindowLabel()).map(
    (s) => s.id,
  );
  const isMember = visibleIds.includes(sessionId);
  if (opts?.onlyIfVisible && !isMember) return;
  const wasLastVisible = isMember && visibleIds.length === 1;
  useUIStore.getState().terminalRemoveSession(sessionId, { visibleIds });
  if (!wasLastVisible) return;
  const now = useUIStore.getState();
  if (now.terminalVisible) now.toggleTerminal();
}
