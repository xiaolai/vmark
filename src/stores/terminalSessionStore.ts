/**
 * Terminal Session Store
 *
 * Purpose: Manages terminal tab sessions — creation (up to 5), removal,
 *   activation, dead-marking, and renaming.
 *
 * Key decisions:
 *   - Max 5 concurrent sessions to limit resource usage (each session
 *     spawns a real PTY via Tauri shell plugin).
 *   - Labels auto-assign "Terminal N" using lowest-unused-number strategy
 *     so closing Terminal 2 then creating a new one reuses the name.
 *   - isAlive flag allows UI to show dead sessions (for scroll-back review)
 *     without allowing new input.
 *   - IDs use a simple incrementing counter — fine for session-scoped use.
 *
 * @coordinates-with Terminal component — renders xterm.js for each session
 * @coordinates-with uiStore.ts — terminalVisible toggle
 * @module stores/terminalSessionStore
 */

import { create } from "zustand";

export interface TerminalSession {
  id: string;
  label: string;
  isAlive: boolean;
}

const MAX_SESSIONS = 5;

interface TerminalSessionState {
  sessions: TerminalSession[];
  activeSessionId: string | null;
}

interface TerminalSessionActions {
  createSession: () => TerminalSession | null;
  removeSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  markSessionDead: (id: string) => void;
  markSessionAlive: (id: string) => void;
  renameSession: (id: string, label: string) => void;
}

let nextId = 1;

function generateId(): string {
  return `term-${nextId++}`;
}

function generateLabel(sessions: TerminalSession[]): string {
  // Find lowest unused number
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

export const useTerminalSessionStore = create<
  TerminalSessionState & TerminalSessionActions
>()((set, get) => ({
  sessions: [],
  activeSessionId: null,

  createSession: () => {
    const state = get();
    if (state.sessions.length >= MAX_SESSIONS) return null;

    const session: TerminalSession = {
      id: generateId(),
      label: generateLabel(state.sessions),
      isAlive: true,
    };

    set({
      sessions: [...state.sessions, session],
      activeSessionId: session.id,
    });

    return session;
  },

  removeSession: (id) => {
    const state = get();
    const remaining = state.sessions.filter((s) => s.id !== id);
    let activeId = state.activeSessionId;

    if (activeId === id) {
      // Switch to last remaining session, or null
      activeId = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    }

    set({ sessions: remaining, activeSessionId: activeId });
  },

  setActiveSession: (id) => {
    const state = get();
    if (state.sessions.some((s) => s.id === id)) {
      set({ activeSessionId: id });
    }
  },

  markSessionDead: (id) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, isAlive: false } : s,
      ),
    }));
  },

  markSessionAlive: (id) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, isAlive: true } : s,
      ),
    }));
  },

  renameSession: (id, label) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, label } : s,
      ),
    }));
  },
}));

/** Reset store and ID counter — for tests only. */
export function resetTerminalSessionStore() {
  nextId = 1;
  useTerminalSessionStore.setState({
    sessions: [],
    activeSessionId: null,
  });
}
