/**
 * uiStore `terminal` slice — terminal session registry initial state and
 * actions.
 *
 * Purpose: initial value, ID/label generators, and action implementations
 * for the `s.terminal` namespace of the UI store. Extracted verbatim from
 * `../uiStore.ts` (pure code motion; behavior unchanged). Type
 * declarations (TerminalSession, slice and action shapes) live in
 * `./types.ts` (one-directional imports — no cycles). The module-level ID
 * counter lives here; the test-only reset in the composition root calls
 * `resetTerminalIdCounter()`.
 *
 * @module stores/uiStore/terminalSlice
 */

import type {
  TerminalActions,
  TerminalSession,
  TerminalSlice,
  UIGet,
  UISet,
} from "./types";

export const MAX_TERMINAL_SESSIONS = 5;

export const initialTerminal: TerminalSlice = {
  sessions: [],
  activeSessionId: null,
};

let nextTerminalId = 1;

function generateTerminalId(): string {
  return `term-${nextTerminalId++}`;
}

function generateTerminalLabel(sessions: TerminalSession[]): string {
  const used = new Set(
    sessions
      .map((s) => {
        const m = s.label.match(/^Terminal (\d+)$/);
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => n > 0),
  );
  let n = 1;
  while (used.has(n)) n++;
  return `Terminal ${n}`;
}

/** Reset the session ID counter — for tests only (via resetTerminalSessionStore). */
export function resetTerminalIdCounter(): void {
  nextTerminalId = 1;
}

/** Apply a partial update to one session by id (no-op for unknown ids). */
function updateSession(set: UISet, id: string, patch: Partial<TerminalSession>): void {
  set((s) => ({
    terminal: {
      ...s.terminal,
      sessions: s.terminal.sessions.map((session) =>
        session.id === id ? { ...session, ...patch } : session,
      ),
    },
  }));
}

export function createTerminalActions(set: UISet, get: UIGet): TerminalActions {
  return {
    terminalCreateSession: () => {
      const state = get().terminal;
      if (state.sessions.length >= MAX_TERMINAL_SESSIONS) return null;
      const session: TerminalSession = {
        id: generateTerminalId(),
        label: generateTerminalLabel(state.sessions),
        isAlive: true,
      };
      set((s) => ({
        terminal: {
          sessions: [...s.terminal.sessions, session],
          activeSessionId: session.id,
        },
      }));
      return session;
    },
    terminalRemoveSession: (id) => {
      const state = get().terminal;
      const remaining = state.sessions.filter((s) => s.id !== id);
      let activeId = state.activeSessionId;
      if (activeId === id) {
        activeId =
          remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      }
      set((s) => ({
        terminal: {
          ...s.terminal,
          sessions: remaining,
          activeSessionId: activeId,
        },
      }));
    },
    terminalSetActiveSession: (id) => {
      const state = get().terminal;
      if (state.sessions.some((s) => s.id === id)) {
        // Activating a session clears its background-activity flag (WI-4.3).
        set((s) => ({
          terminal: {
            ...s.terminal,
            activeSessionId: id,
            sessions: s.terminal.sessions.map((session) =>
              session.id === id && session.hasActivity
                ? { ...session, hasActivity: false }
                : session,
            ),
          },
        }));
      }
    },
    terminalMarkSessionDead: (id) => {
      updateSession(set, id, { isAlive: false });
    },
    terminalMarkSessionAlive: (id) => {
      updateSession(set, id, { isAlive: true });
    },
    terminalRenameSession: (id, label) => {
      // isUserRenamed locks the label so a later program title (G4/WI-3.2)
      // can't override the user's explicit choice.
      updateSession(set, id, { label, isUserRenamed: true });
    },
    terminalSetProgramTitle: (id, title) => {
      // A program controls this via OSC 0/2 — strip control chars, collapse
      // whitespace, and cap length so a hostile/garbled title can't bloat the
      // store or corrupt the tab UI / screen-reader output (Codex audit).
      const clean = Array.from(title)
        .filter((ch) => {
          const c = ch.codePointAt(0) ?? 0;
          return c > 0x1f && c !== 0x7f; // drop C0 control chars + DEL
        })
        .join("")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 256);
      updateSession(set, id, { programTitle: clean });
    },
    terminalMarkActivity: (id) => {
      // The active session's output is visible — flagging it would leave a
      // stale activity dot after the user switches away (audit-fix).
      if (get().terminal.activeSessionId === id) return;
      updateSession(set, id, { hasActivity: true });
    },
  };
}
