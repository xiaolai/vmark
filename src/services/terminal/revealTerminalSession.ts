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

/** Make the panel visible. Revealing nothing looks like the command failed. */
function revealPanel(): void {
  // Re-read: creating a session ran subscribers synchronously.
  const now = useUIStore.getState();
  if (!now.terminalVisible) now.toggleTerminal();
}

/**
 * Take the active session, or create one on an empty panel, and reveal the
 * panel. Returns a session id ALWAYS — the two outcomes are exhaustive: a
 * non-empty panel has a session to reuse, and an empty panel is by definition
 * below MAX_TERMINAL_SESSIONS so creation cannot fail. Typing it non-nullable
 * means callers have no dead "couldn't get one" branch to carry.
 */
export function reuseOrCreateTerminalSession(): string {
  const store = useUIStore.getState();
  const existing =
    store.terminal.activeSessionId ?? store.terminal.sessions[0]?.id ?? null;
  // Non-null assertion is sound: `sessions` is empty here, so the cap check
  // inside terminalCreateSession cannot trip.
  const sessionId = existing ?? store.terminalCreateSession()!.id;
  revealPanel();
  return sessionId;
}

/**
 * Create a NEW session pinned to `requestedCwd` and reveal the panel — what
 * "Open Terminal Here" means, even when other sessions are running. Returns
 * null at MAX_TERMINAL_SESSIONS, which is a state the user can really reach.
 */
export function createTerminalSessionAt(requestedCwd: string): string | null {
  const created = useUIStore.getState().terminalCreateSession({ requestedCwd });
  if (!created) return null;
  revealPanel();
  return created.id;
}
