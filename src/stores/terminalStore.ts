import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// Terminal panel height constraints
const TERMINAL_MIN_HEIGHT = 100;
const TERMINAL_MAX_HEIGHT = 600;
const TERMINAL_DEFAULT_HEIGHT = 200;
const MAX_SESSIONS = 5;

/** Terminal session metadata */
export interface TerminalSession {
  id: string;
  title: string;
  cwd?: string;
  createdAt: number;
}

interface TerminalState {
  visible: boolean;
  height: number;
  sessions: TerminalSession[];
  activeSessionId: string | null;
}

interface TerminalActions {
  toggle: () => void;
  setVisible: (visible: boolean) => void;
  setHeight: (height: number) => void;
  // Session management
  addSession: (session: TerminalSession) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string) => void;
  updateSessionTitle: (sessionId: string, title: string) => void;
  clearSessions: () => void;
}

export const useTerminalStore = create<TerminalState & TerminalActions>()(
  persist(
    (set, get) => ({
      visible: false,
      height: TERMINAL_DEFAULT_HEIGHT,
      sessions: [],
      activeSessionId: null,

      toggle: () => set((state) => ({ visible: !state.visible })),
      setVisible: (visible) => set({ visible }),
      setHeight: (height) =>
        set({
          height: Math.min(TERMINAL_MAX_HEIGHT, Math.max(TERMINAL_MIN_HEIGHT, height)),
        }),

      addSession: (session) => {
        const state = get();
        if (state.sessions.length >= MAX_SESSIONS) return;
        set({
          sessions: [...state.sessions, session],
          activeSessionId: session.id,
        });
      },

      removeSession: (sessionId) => {
        const state = get();
        const newSessions = state.sessions.filter((s) => s.id !== sessionId);
        let newActiveId = state.activeSessionId;

        // If we removed the active session, switch to another
        if (state.activeSessionId === sessionId) {
          const removedIndex = state.sessions.findIndex((s) => s.id === sessionId);
          if (newSessions.length > 0) {
            // Try to select the session at the same index, or the last one
            const newIndex = Math.min(removedIndex, newSessions.length - 1);
            newActiveId = newSessions[newIndex].id;
          } else {
            newActiveId = null;
          }
        }

        set({
          sessions: newSessions,
          activeSessionId: newActiveId,
        });
      },

      setActiveSession: (sessionId) => {
        const state = get();
        if (state.sessions.some((s) => s.id === sessionId)) {
          set({ activeSessionId: sessionId });
        }
      },

      updateSessionTitle: (sessionId, title) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, title } : s
          ),
        }));
      },

      clearSessions: () => set({ sessions: [], activeSessionId: null }),
    }),
    {
      name: "vmark-terminal-ui",
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? localStorage
          : { getItem: () => null, setItem: () => {}, removeItem: () => {} }
      ),
      // Don't persist sessions (they're runtime state)
      partialize: (state) => ({
        visible: state.visible,
        height: state.height,
      }),
    }
  )
);

// Export constants for use in resize hook
export { TERMINAL_MIN_HEIGHT, TERMINAL_MAX_HEIGHT, MAX_SESSIONS };
