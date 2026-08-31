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
import { isSessionVisibleInScope } from "./terminalScopeSelectors";

export const MAX_TERMINAL_SESSIONS = 5;

export const initialTerminal: TerminalSlice = {
  sessions: [],
  activeSessionId: null,
  lastActiveByScope: {},
};

let nextTerminalId = 1;

function generateTerminalId(): string {
  return `term-${nextTerminalId++}`;
}

/** THE smallest-unused allocation rule (audit 20260831 R2-5): creation and
 *  the scope actions' renumbering share it, so the rules cannot diverge. */
export function smallestUnusedOrdinal(used: ReadonlySet<number>): number {
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/**
 * Smallest unused 1-based ordinal. Read from the sessions' own `ordinal`
 * field, not scraped back out of their labels: the label is display text and a
 * rename or a translation would make that parse meaningless.
 */
function nextTerminalOrdinal(sessions: TerminalSession[]): number {
  return smallestUnusedOrdinal(new Set(sessions.map((s) => s.ordinal)));
}

/**
 * Activate `activeId` on the slice, clearing the activated session's
 * hasActivity (D-T11). THE one activation transition (audit R2-6):
 * terminalSetActiveSession and every scope action apply it, so the
 * activity-clear rule cannot fork.
 */
export function withActiveSession(
  terminal: TerminalSlice,
  activeId: string | null,
): TerminalSlice {
  return {
    ...terminal,
    activeSessionId: activeId,
    sessions: activeId
      ? terminal.sessions.map((s) =>
          s.id === activeId && s.hasActivity ? { ...s, hasActivity: false } : s,
        )
      : terminal.sessions,
  };
}

/**
 * The creation-time union (WI-TS1.1, D-T5): the sessions a new session owned
 * by `ownerInstanceId` will be visible alongside — same-scope ∪ window-scoped.
 * Cap and ordinal allocation both run over this union, so no two co-visible
 * sessions share an ordinal and the `+` gate counts what the user can see.
 *
 * An UNSCOPED creation counts every session. That is exact for rail-off
 * (D-T15: everything is visible), and exact for the rail-on carve-outs too:
 * a placeholder-active window has no real instances (placeholders are sole
 * occupants), and a mid-restore window starts from an empty terminal store
 * (no session persistence, D-T12) — in both states no stamped session can
 * exist, so "all sessions" IS the window-scoped population.
 */
export function creationUnion(
  sessions: TerminalSession[],
  ownerInstanceId?: string,
): TerminalSession[] {
  if (!ownerInstanceId) return sessions;
  return sessions.filter((s) => isSessionVisibleInScope(s, ownerInstanceId));
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
      // Cap and ordinal run over the VISIBLE union (D-T5), a creation-time
      // gate only — adoption/rekey never consult it, so a scope can
      // transiently exceed the cap without anything being killed.
      const union = creationUnion(state.sessions, options?.ownerInstanceId);
      if (union.length >= MAX_TERMINAL_SESSIONS) return null;
      const ordinal = nextTerminalOrdinal(union);
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
        // Owner stamp (WI-TS1.1, D-T1). Key absent ⇒ window-scoped.
        ...(options?.ownerInstanceId
          ? { workspaceInstanceId: options.ownerInstanceId }
          : {}),
      };
      set((s) => ({
        terminal: {
          ...s.terminal,
          sessions: [...s.terminal.sessions, session],
          activeSessionId: session.id,
        },
      }));
      return session;
    },
    terminalRemoveSession: (id, opts) => {
      const state = get().terminal;
      const remaining = state.sessions.filter((s) => s.id !== id);
      let activeId = state.activeSessionId;
      if (activeId === id) {
        // Fallback-active picks from the caller's VISIBLE population when
        // given (WI-TS1.2) — activating a hidden scope's session would show
        // nothing. Without the hint: all remaining (rail-off behavior).
        const candidates = opts?.visibleIds
          ? remaining.filter((s) => opts.visibleIds?.includes(s.id))
          : remaining;
        activeId =
          candidates.length > 0 ? candidates[candidates.length - 1].id : null;
      }
      // The fallback is an ACTIVATION, so it goes through the one transition
      // (audit round 3, R3-1): a fallback session carrying an activity dot
      // has just become the visible session, and the dot must clear (D-T11).
      set((s) => ({
        terminal: withActiveSession(
          { ...s.terminal, sessions: remaining },
          activeId,
        ),
      }));
    },
    terminalSetActiveSession: (id) => {
      const state = get().terminal;
      if (state.sessions.some((s) => s.id === id)) {
        // Activating a session clears its background-activity flag (WI-4.3)
        // — via the ONE activation transition (withActiveSession).
        set((s) => ({ terminal: withActiveSession(s.terminal, id) }));
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
      // C1 controls and bidi overrides are stripped too (audit 20260831 #3):
      // a bidi override in a tab label can visually reverse the strip's text.
      const clean = Array.from(title)
        .filter((ch) => {
          const c = ch.codePointAt(0) ?? 0;
          if (c <= 0x1f || c === 0x7f) return false; // C0 + DEL
          if (c >= 0x80 && c <= 0x9f) return false; // C1
          if (c >= 0x202a && c <= 0x202e) return false; // bidi embeddings/overrides
          if (c >= 0x2066 && c <= 0x2069) return false; // bidi isolates
          return true;
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
