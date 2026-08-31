/**
 * uiStore `terminal` slice — scope-transition actions (WI-TS1.2, the kernel).
 *
 * Purpose: the actions the rail coordinator and the instance lifecycle call
 * to move terminal sessions between per-workspace-instance scopes. Split from
 * terminalSlice.ts to keep both files under the size gate.
 *
 * Key decisions (plan 20260831-terminal-per-instance-sessions):
 *   - D-T3: a scope switch NEVER removes sessions from the store — hiding is
 *     the activeSessionId change; only remove/rekey touch membership.
 *   - D-T5: adoption/rekey never kill and never consult the cap; ordinals are
 *     renumbered only on in-scope collision, labels untouched.
 *   - D-T11: every action that activates a session clears its hasActivity,
 *     the same rule terminalSetActiveSession applies.
 *   - Invariant 7: the owner-exact filters here are action-internal — the
 *     exported COUNT vocabulary lives in terminalScopeSelectors.ts.
 *
 * @coordinates-with terminalSlice.ts — base session actions
 * @coordinates-with services/workspaces/switchWorkspaceInstance.ts — caller
 * @module stores/uiStore/terminalScopeActions
 */
import type {
  TerminalScopeActions,
  TerminalSession,
  TerminalSlice,
  UIGet,
  UISet,
} from "./types";
import { isSessionVisibleInScope } from "./terminalScopeSelectors";
import { smallestUnusedOrdinal, withActiveSession } from "./terminalSlice";

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
function activationFor(terminal: TerminalSlice, scopeId: string): string | null {
  const visible = visibleIn(terminal.sessions, scopeId);
  const remembered = terminal.lastActiveByScope[scopeId];
  if (remembered && visible.some((s) => s.id === remembered)) return remembered;
  return visible[0]?.id ?? null;
}

// Activation goes through the slice's ONE transition, withActiveSession
// (audit R2-6) — a restored session never keeps a stale activity dot, by the
// same rule terminalSetActiveSession applies.

export function createTerminalScopeActions(set: UISet, get: UIGet): TerminalScopeActions {
  return {
    terminalAdoptUnscopedSessions: (instanceId) => {
      const movedIds = new Set(
        get()
          .terminal.sessions.filter((s) => !s.workspaceInstanceId)
          .map((s) => s.id),
      );
      // Idempotent: nothing window-scoped, nothing to do (no store wake).
      if (movedIds.size === 0) return;
      set((s) => {
        const stamped = s.terminal.sessions.map((session) =>
          movedIds.has(session.id)
            ? { ...session, workspaceInstanceId: instanceId }
            : session,
        );
        return {
          terminal: {
            ...s.terminal,
            sessions: renumberIntoScope(stamped, movedIds, instanceId),
          },
        };
      });
    },

    terminalSwitchScope: (outgoingId, incomingId) => {
      set((s) => {
        const lastActiveByScope = outgoingId
          ? {
              ...s.terminal.lastActiveByScope,
              [outgoingId]: s.terminal.activeSessionId,
            }
          : s.terminal.lastActiveByScope;
        const next = { ...s.terminal, lastActiveByScope };
        return { terminal: withActiveSession(next, activationFor(next, incomingId)) };
      });
    },

    terminalHydrateScope: (instanceId) => {
      // Distinct from terminalSwitchScope(null, id) only in intent today, but
      // kept separate because hydrate is CONVERGENT (D-T12): calling it twice,
      // or after a user switch already adopted, re-derives the same state.
      set((s) => ({
        terminal: withActiveSession(s.terminal, activationFor(s.terminal, instanceId)),
      }));
    },

    terminalRealignActive: (visibleIds) => {
      // R2-15 (audit 20260831 round 2): after a rail-MODE toggle the visible
      // population changes with no scope switch, so nothing realigned the
      // active session — a stale hidden active over an empty tab bar blocked
      // auto-create. Keep the current active if still visible; otherwise the
      // first visible session, else null. Idempotent by construction.
      const { activeSessionId } = get().terminal;
      if (activeSessionId && visibleIds.includes(activeSessionId)) return;
      const next = visibleIds[0] ?? null;
      if (next === activeSessionId) return;
      set((s) => ({ terminal: withActiveSession(s.terminal, next) }));
    },

    terminalRemoveScopeSessions: (instanceId) => {
      set((s) => {
        const sessions = s.terminal.sessions.filter(
          (session) => session.workspaceInstanceId !== instanceId,
        );
        if (
          sessions.length === s.terminal.sessions.length &&
          !(instanceId in s.terminal.lastActiveByScope)
        ) {
          return s;
        }
        const { [instanceId]: _dropped, ...lastActiveByScope } =
          s.terminal.lastActiveByScope;
        return {
          terminal: {
            ...s.terminal,
            sessions,
            // The reconcile disposes removed sessions' xterm+PTY (D-T3's
            // removal path — correct here). Never leave active pointing at a
            // removed id; the caller realigns via terminalHydrateScope.
            activeSessionId: sessions.some(
              (session) => session.id === s.terminal.activeSessionId,
            )
              ? s.terminal.activeSessionId
              : null,
            lastActiveByScope,
          },
        };
      });
    },

    terminalRekeyScope: (oldId, newId) => {
      set((s) => {
        const movedIds = new Set(
          s.terminal.sessions
            .filter((session) => session.workspaceInstanceId === oldId)
            .map((session) => session.id),
        );
        const stamped = s.terminal.sessions.map((session) =>
          movedIds.has(session.id)
            ? { ...session, workspaceInstanceId: newId }
            : session,
        );
        const sessions =
          movedIds.size > 0
            ? renumberIntoScope(stamped, movedIds, newId)
            : s.terminal.sessions;
        const { [oldId]: oldSlot, ...rest } = s.terminal.lastActiveByScope;
        // Target-wins merge — mirrors workspaceInstanceUiStore.rekeyInstanceUiState.
        const lastActiveByScope =
          newId in rest
            ? rest
            : oldSlot !== undefined
              ? { ...rest, [newId]: oldSlot }
              : rest;
        return { terminal: { ...s.terminal, sessions, lastActiveByScope } };
      });
    },
  };
}
