/**
 * uiStore `terminal` slice — terminal session registry initial state and
 * actions.
 *
 * Purpose: initial value, ID/ordinal generators, and action implementations
 * for the `s.terminal` namespace of the UI store. Type declarations
 * (TerminalSession, slice and action shapes) live in `./types.ts`
 * (one-directional imports — no cycles). The module-level ID counter lives
 * here; the test-only reset in the composition root calls
 * `resetTerminalIdCounter()`.
 *
 * Key decisions:
 *   - A session's display number is its `ordinal` field, allocated on create
 *     and reused when a session closes. It is NOT recovered by parsing the
 *     label: that string is display text, so a translation or a rename made
 *     the parse meaningless (every tab showed the same glyph).
 *   - `requestedCwd` ("Open Terminal Here") is peeked by the spawn path and
 *     cleared only after a spawn using it succeeds, so a failed first attempt
 *     stays retryable in the directory the user asked for.
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

/**
 * Smallest unused 1-based ordinal. Read from the sessions' own `ordinal`
 * field, not scraped back out of their labels: the label is display text and a
 * rename or a translation would make that parse meaningless.
 */
function nextTerminalOrdinal(sessions: TerminalSession[]): number {
  const used = new Set(sessions.map((s) => s.ordinal));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/** Reset the session ID counter — for tests only (via resetTerminalSessionStore). */
export function resetTerminalIdCounter(): void {
  nextTerminalId = 1;
}

/** Apply a partial update to one session by id (no-op for unknown ids). */
function updateSession(set: UISet, id: string, patch: Partial<TerminalSession>): void {
  mapSession(set, id, (session) => ({ ...session, ...patch }));
}

/**
 * Replace one session via an arbitrary transform.
 *
 * `updateSession` can only ADD or overwrite keys; a caller that needs to take a
 * key back off the session (`terminalClearRequestedCwd`) cannot express that as
 * a patch — `{ requestedCwd: undefined }` leaves the key in place holding
 * undefined, which is not the shape `terminalCreateSession` produces for a
 * session that never had one.
 */
function mapSession(
  set: UISet,
  id: string,
  transform: (session: TerminalSession) => TerminalSession
): void {
  set((s) => {
    // Genuinely a no-op for an unknown id: mapping unconditionally would build
    // a new sessions array and wake every subscriber for a stale PTY/title
    // event about a session that is already gone.
    if (!s.terminal.sessions.some((session) => session.id === id)) return s;
    return {
      terminal: {
        ...s.terminal,
        sessions: s.terminal.sessions.map((session) =>
          session.id === id ? transform(session) : session,
        ),
      },
    };
  });
}

export function createTerminalActions(set: UISet, get: UIGet): TerminalActions {
  return {
    terminalCreateSession: (options) => {
      const state = get().terminal;
      if (state.sessions.length >= MAX_TERMINAL_SESSIONS) return null;
      const ordinal = nextTerminalOrdinal(state.sessions);
      const session: TerminalSession = {
        id: generateTerminalId(),
        // Default display text. The identity that survives translation is
        // `ordinal`; this string is only what the tooltip shows until the
        // program sets a title or the user renames the session.
        label: `Terminal ${ordinal}`,
        ordinal,
        isAlive: true,
        // "Open Terminal Here" pins the start directory (WI-4.2); the spawn
        // path takes it exactly once.
        ...(options?.requestedCwd ? { requestedCwd: options.requestedCwd } : {}),
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
    terminalPeekRequestedCwd: (id) =>
      get().terminal.sessions.find((s) => s.id === id)?.requestedCwd,
    terminalClearRequestedCwd: (id) => {
      // Cleared only after a SUCCESSFUL spawn (see useTerminalShellLifecycle).
      // Clearing on read would lose the user's directory when the first spawn
      // fails, and their retry would silently open somewhere else.
      if (get().terminal.sessions.find((s) => s.id === id)?.requestedCwd === undefined) return;
      // Take the key OFF, restoring the shape a session created without a
      // requested directory has — see mapSession.
      mapSession(set, id, ({ requestedCwd: _requestedCwd, ...rest }) => rest);
    },
    terminalMarkActivity: (id) => {
      // The active session's output is visible — flagging it would leave a
      // stale activity dot after the user switches away (audit-fix).
      if (get().terminal.activeSessionId === id) return;
      updateSession(set, id, { hasActivity: true });
    },
  };
}
