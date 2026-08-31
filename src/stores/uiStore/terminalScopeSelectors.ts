/**
 * uiStore `terminal` slice — scoped visibility selectors (WI-TS1.3).
 *
 * Purpose: THE one count vocabulary for terminal scoping (plan invariant 7).
 * The visible population drives tab-bar rendering, the session cap gate,
 * last-session panel-hide, and auto-create alike. Owner-exact enumeration is
 * deliberately NOT exported — it exists only inside remove/rekey/adopt
 * actions (terminalScopeActions.ts).
 *
 * Pure over the slice: rail state and the active instance id are parameters,
 * so React hooks and imperative services share one rule (D-T15: rail off ⇒
 * every session is visible, stamped or not — stamps are inert, never erased).
 *
 * @coordinates-with terminalScopeActions.ts — action-internal counterparts
 * @module stores/uiStore/terminalScopeSelectors
 */
import type { TerminalSession, TerminalSlice } from "./types";

/**
 * THE scope-visibility predicate: a session is visible in `scopeId`'s scope
 * when it is window-scoped (no stamp) or stamped with that scope. Every other
 * rule in this module — and the slice's creation union and the scope actions'
 * internal filters — builds on this ONE predicate, so the visibility rule
 * cannot fork (audit 20260831 #2/#4).
 */
export function isSessionVisibleInScope(
  session: TerminalSession,
  scopeId: string | null,
): boolean {
  return !session.workspaceInstanceId || session.workspaceInstanceId === scopeId;
}

/**
 * The sessions visible in the window right now: with the rail on, the active
 * instance's scope ∪ window-scoped; with it off, ALL sessions (D-T15 — a
 * stamped session's stamp is inert while the rail is disabled, and reactivates
 * on re-enable).
 */
export function selectVisibleTerminalSessions(
  terminal: Pick<TerminalSlice, "sessions">,
  activeInstanceId: string | null,
  railEnabled: boolean,
): TerminalSession[] {
  if (!railEnabled) return terminal.sessions;
  return terminal.sessions.filter((s) => isSessionVisibleInScope(s, activeInstanceId));
}

/** Invariant 7: the ONLY exported session count. */
export function selectVisibleSessionCount(
  terminal: Pick<TerminalSlice, "sessions">,
  activeInstanceId: string | null,
  railEnabled: boolean,
): number {
  return selectVisibleTerminalSessions(terminal, activeInstanceId, railEnabled).length;
}
