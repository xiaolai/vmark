/**
 * terminalStore scope-transition actions (WI-TS1.2, the kernel).
 *
 * Purpose: the actions the rail coordinator and the instance lifecycle call
 * to move terminal sessions between per-workspace-instance scopes. Split from
 * sessionActions.ts to keep both files under the size gate.
 *
 * Key decisions (plan
 *   `.claude/tdd-guardian/20260831-terminal-per-instance-sessions.md`):
 *   - D-T3: a scope switch NEVER removes sessions from the store — hiding is
 *     the activeSessionId change; only remove/rekey touch membership.
 *   - D-T5: adoption/rekey never kill and never consult the cap; ordinals are
 *     renumbered only on in-scope collision, labels untouched.
 *   - D-T11: every action that activates a session clears its hasActivity,
 *     the same rule terminalSetActiveSession applies.
 *   - Invariant 7: the owner-exact filters here are action-internal — the
 *     exported COUNT vocabulary lives in scopeSelectors.ts.
 *
 * @coordinates-with sessionActions.ts — base session actions
 * @coordinates-with services/workspaces/switchWorkspaceInstance.ts — caller
 * @module stores/terminalStore/scopeActions
 */
import type {
  TerminalGet,
  TerminalScopeActions,
  TerminalSession,
  TerminalSet,
  TerminalState,
} from "./types";
import { isSessionVisibleInScope } from "./scopeSelectors";
import { smallestUnusedOrdinal, withActiveSession } from "./sessionActions";

/** The scope's visible population: window-scoped ∪ scope-stamped. */
function visibleIn(sessions: TerminalSession[], scopeId: string): TerminalSession[] {
  return sessions.filter((s) => isSessionVisibleInScope(s, scopeId));
}

/**
 * Renumber `movedIds` sessions so no ordinal collides inside `scopeId`'s
 * visible union. Non-moved sessions keep their ordinals; a moved session
 * keeps its own unless it collides, in which case it takes the smallest
 * unused (labels untouched — the ordinal is the identity, D-T5).
 */
function renumberIntoScope(
  sessions: TerminalSession[],
  movedIds: ReadonlySet<string>,
  scopeId: string,
): TerminalSession[] {
  const used = new Set(
    sessions
      .filter((s) => !movedIds.has(s.id) && isSessionVisibleInScope(s, scopeId))
      .map((s) => s.ordinal),
  );
  return sessions.map((s) => {
    if (!movedIds.has(s.id)) return s;
    if (!used.has(s.ordinal)) {
      used.add(s.ordinal);
      return s;
    }
    const n = smallestUnusedOrdinal(used);
    used.add(n);
    return { ...s, ordinal: n };
  });
}

/** Remembered-live ?? first-visible ?? null (WI-TS1.2 activation rule). */
function activationFor(terminal: TerminalState, scopeId: string): string | null {
  const visible = visibleIn(terminal.sessions, scopeId);
  const remembered = terminal.lastActiveByScope[scopeId];
  if (remembered && visible.some((s) => s.id === remembered)) return remembered;
  return visible[0]?.id ?? null;
}

// Activation goes through the store's ONE transition, withActiveSession:
// a restored session never keeps a stale activity dot, by the
// same rule terminalSetActiveSession applies.

export function createTerminalScopeActions(
  set: TerminalSet,
  get: TerminalGet,
): TerminalScopeActions {
  return {
    terminalAdoptUnscopedSessions: (instanceId) => {
      const movedIds = new Set(
        get()
          .sessions.filter((s) => !s.workspaceInstanceId)
          .map((s) => s.id),
      );
      // Idempotent: nothing window-scoped, nothing to do (no store wake).
      if (movedIds.size === 0) return;
      set((s) => {
        const stamped = s.sessions.map((session) =>
          movedIds.has(session.id)
            ? { ...session, workspaceInstanceId: instanceId }
            : session,
        );
        return { sessions: renumberIntoScope(stamped, movedIds, instanceId) };
      });
    },

    terminalSwitchScope: (outgoingId, incomingId) => {
      set((s) => {
        const lastActiveByScope = outgoingId
          ? { ...s.lastActiveByScope, [outgoingId]: s.activeSessionId }
          : s.lastActiveByScope;
        const next = { ...s, lastActiveByScope };
        return withActiveSession(next, activationFor(next, incomingId));
      });
    },

    terminalHydrateScope: (instanceId) => {
      // Distinct from terminalSwitchScope(null, id) only in intent today, but
      // kept separate because hydrate is CONVERGENT (D-T12): calling it twice,
      // or after a user switch already adopted, re-derives the same state.
      set((s) => withActiveSession(s, activationFor(s, instanceId)));
    },

    terminalRealignActive: (visibleIds) => {
      // R2-15: after a rail-MODE toggle the visible
      // population changes with no scope switch, so nothing realigned the
      // active session — a stale hidden active over an empty tab bar blocked
      // auto-create. Keep the current active if still visible; otherwise the
      // first visible session, else null. Idempotent by construction.
      const { activeSessionId } = get();
      if (activeSessionId && visibleIds.includes(activeSessionId)) return;
      const next = visibleIds[0] ?? null;
      if (next === activeSessionId) return;
      set((s) => withActiveSession(s, next));
    },

    terminalRemoveScopeSessions: (instanceId) => {
      set((s) => {
        const sessions = s.sessions.filter(
          (session) => session.workspaceInstanceId !== instanceId,
        );
        if (
          sessions.length === s.sessions.length &&
          !(instanceId in s.lastActiveByScope)
        ) {
          return s;
        }
        const { [instanceId]: _dropped, ...lastActiveByScope } = s.lastActiveByScope;
        return {
          sessions,
          // The reconcile disposes removed sessions' xterm+PTY (D-T3's
          // removal path — correct here). Never leave active pointing at a
          // removed id; the caller realigns via terminalHydrateScope.
          activeSessionId: sessions.some((session) => session.id === s.activeSessionId)
            ? s.activeSessionId
            : null,
          lastActiveByScope,
        };
      });
    },

    terminalRekeyScope: (oldId, newId) => {
      set((s) => {
        const movedIds = new Set(
          s.sessions
            .filter((session) => session.workspaceInstanceId === oldId)
            .map((session) => session.id),
        );
        const stamped = s.sessions.map((session) =>
          movedIds.has(session.id)
            ? { ...session, workspaceInstanceId: newId }
            : session,
        );
        const sessions =
          movedIds.size > 0
            ? renumberIntoScope(stamped, movedIds, newId)
            : s.sessions;
        const { [oldId]: oldSlot, ...rest } = s.lastActiveByScope;
        // Target-wins merge — mirrors workspaceInstanceUiStore.rekeyInstanceUiState.
        const lastActiveByScope =
          newId in rest
            ? rest
            : oldSlot !== undefined
              ? { ...rest, [newId]: oldSlot }
              : rest;
        return { sessions, lastActiveByScope };
      });
    },
  };
}
