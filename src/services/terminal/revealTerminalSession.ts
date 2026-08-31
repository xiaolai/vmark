/**
 * revealTerminalSession
 *
 * Purpose: The one place that turns "I want a terminal session" into a live,
 * visible one. Both `openTerminalHere` (WI-4.2) and `runInTerminal` (WI-4.3)
 * need the same steps — pick or create a session, re-read the store, reveal
 * the panel — and had grown near-duplicate copies of them.
 *
 * Two entry points rather than one with a mode flag, because their FAILURE
 * shapes genuinely differ: reuse-or-create can never fail (an empty panel is
 * below the cap by definition), while create-a-new-one can hit the cap. A
 * single signature would force the caller that cannot fail to carry a dead
 * null branch — which is exactly the unreachable code an audit flagged.
 *
 * @coordinates-with openTerminalHere.ts — creates a session pinned to a directory
 * @coordinates-with runInTerminal.ts — reuses the active session when there is one
 * @module services/terminal/revealTerminalSession
 */
import { useUIStore } from "@/stores/uiStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { getVisibleTerminalSessions } from "./visibleTerminalSessions";
import { createTerminalSessionInScope } from "./createTerminalSession";

/** Make the panel visible. Revealing nothing looks like the command failed. */
function revealPanel(): void {
  // Re-read: creating a session ran subscribers synchronously.
  const now = useUIStore.getState();
  if (!now.terminalVisible) now.toggleTerminal();
}

/**
 * Take the active session — verified to be VISIBLE — or the first visible
 * one, or create one on an empty visible scope, and reveal the panel
 * (WI-TS4.2/D-T10). The membership check matters (audit 20260831 #18): the
 * active id is normally a member of the visible population (invariant 2),
 * but a rail toggle sequence (off → activate another scope's session → on)
 * can leave it pointing at a HIDDEN session, and reusing that would paste
 * into a shell the user cannot see. A fallback pick is also activated, so
 * the session that receives the command is the session on screen.
 */
export function reuseOrCreateTerminalSession(): string {
  const store = useUIStore.getState();
  const windowLabel = getCurrentWindowLabel();
  const visible = getVisibleTerminalSessions(windowLabel);
  const activeId = store.terminal.activeSessionId;
  const existing =
    activeId && visible.some((s) => s.id === activeId)
      ? activeId
      : visible[0]?.id ?? null;
  if (existing) {
    if (existing !== activeId) store.terminalSetActiveSession(existing);
    revealPanel();
    return existing;
  }
  const created = createTerminalSessionInScope(windowLabel);
  if (!created) {
    // Unreachable by construction: an empty visible population is below the
    // creation-union cap in every state that resolves no owner (D-T5). Fail
    // loud at the origin rather than dereferencing null if that argument
    // ever stops holding (audit 20260831 #19).
    throw new Error(
      "reuseOrCreateTerminalSession: creation refused over an empty visible scope",
    );
  }
  revealPanel();
  return created.id;
}

/**
 * Create a NEW session pinned to `requestedCwd` and reveal the panel — what
 * "Open Terminal Here" means, even when other sessions are running. Stamped
 * with the active scope's owner (D-T1). Returns null at the creation-union
 * cap, which is a state the user can really reach.
 */
export function createTerminalSessionAt(requestedCwd: string): string | null {
  const created = createTerminalSessionInScope(getCurrentWindowLabel(), {
    requestedCwd,
  });
  if (!created) return null;
  revealPanel();
  return created.id;
}
