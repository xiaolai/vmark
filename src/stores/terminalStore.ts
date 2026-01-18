import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// Terminal panel size constraints
const TERMINAL_MIN_HEIGHT = 100;
const TERMINAL_MAX_HEIGHT = 600;
const TERMINAL_DEFAULT_HEIGHT = 200;
const TERMINAL_MIN_WIDTH = 200;
const TERMINAL_MAX_WIDTH = 800;
const TERMINAL_DEFAULT_WIDTH = 400;
const MAX_SESSIONS = 2; // Max 2 panes (1 main + 1 split)

export type SplitDirection = "horizontal" | "vertical";

/** Terminal session metadata */
export interface TerminalSession {
  id: string;
  title: string;
  cwd?: string;
  createdAt: number;
  /** True if this session needs to be restored (persisted but PTY not spawned yet) */
  needsRestore?: boolean;
  /** Split state - if set, this session is split with another */
  splitWith?: string;
  /** Direction of split (only set on the primary session of a split) */
  splitDirection?: SplitDirection;
}

interface TerminalState {
  visible: boolean;
  height: number;
  width: number;
  sessions: TerminalSession[];
  activeSessionId: string | null;
}

interface TerminalActions {
  toggle: () => void;
  setVisible: (visible: boolean) => void;
  setHeight: (height: number) => void;
  setWidth: (width: number) => void;
  // Session management
  addSession: (session: TerminalSession) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string) => void;
  updateSessionTitle: (sessionId: string, title: string) => void;
  updateSessionId: (oldId: string, newId: string) => void;
  markSessionRestored: (sessionId: string) => void;
  getSessionsToRestore: () => TerminalSession[];
  clearSessions: () => void;
  // Split management
  splitSession: (sessionId: string, newSessionId: string, direction: SplitDirection) => void;
  unsplitSession: (sessionId: string) => void;
  getSplitSibling: (sessionId: string) => TerminalSession | null;
}

export const useTerminalStore = create<TerminalState & TerminalActions>()(
  persist(
    (set, get) => ({
      visible: false,
      height: TERMINAL_DEFAULT_HEIGHT,
      width: TERMINAL_DEFAULT_WIDTH,
      sessions: [],
      activeSessionId: null,

      toggle: () => set((state) => ({ visible: !state.visible })),
      setVisible: (visible) => set({ visible }),
      setHeight: (height) =>
        set({
          height: Math.min(TERMINAL_MAX_HEIGHT, Math.max(TERMINAL_MIN_HEIGHT, height)),
        }),
      setWidth: (width) =>
        set({
          width: Math.min(TERMINAL_MAX_WIDTH, Math.max(TERMINAL_MIN_WIDTH, width)),
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
        const removedSession = state.sessions.find((s) => s.id === sessionId);

        // Clear splitWith/splitDirection on the sibling session if it exists
        let newSessions = state.sessions.filter((s) => s.id !== sessionId);
        if (removedSession?.splitWith) {
          const siblingId = removedSession.splitWith;
          newSessions = newSessions.map((s) =>
            s.id === siblingId ? { ...s, splitWith: undefined, splitDirection: undefined } : s
          );
        }
        // Also clear if another session had splitWith pointing to the removed one
        newSessions = newSessions.map((s) =>
          s.splitWith === sessionId ? { ...s, splitWith: undefined, splitDirection: undefined } : s
        );

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

      updateSessionId: (oldId, newId) => {
        set((state) => ({
          sessions: state.sessions.map((s) => {
            // Update the session's own ID
            if (s.id === oldId) {
              return { ...s, id: newId, needsRestore: false };
            }
            // Update splitWith references pointing to the old ID
            if (s.splitWith === oldId) {
              return { ...s, splitWith: newId };
            }
            return s;
          }),
          activeSessionId: state.activeSessionId === oldId ? newId : state.activeSessionId,
        }));
      },

      markSessionRestored: (sessionId) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, needsRestore: false } : s
          ),
        }));
      },

      getSessionsToRestore: () => {
        return get().sessions.filter((s) => s.needsRestore);
      },

      clearSessions: () => set({ sessions: [], activeSessionId: null }),

      splitSession: (sessionId, newSessionId, direction) => {
        const state = get();
        const session = state.sessions.find((s) => s.id === sessionId);
        if (!session) return;
        if (state.sessions.length >= MAX_SESSIONS) return;
        // Don't split if already split
        if (session.splitWith) return;

        const newSession: TerminalSession = {
          id: newSessionId,
          title: `Terminal ${state.sessions.length + 1}`,
          cwd: session.cwd,
          createdAt: Date.now(),
          splitWith: sessionId,
        };

        set({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? { ...s, splitWith: newSessionId, splitDirection: direction }
              : s
          ).concat(newSession),
        });
      },

      unsplitSession: (sessionId) => {
        const state = get();
        const session = state.sessions.find((s) => s.id === sessionId);
        if (!session || !session.splitWith) return;

        const siblingId = session.splitWith;

        // Remove split state from both sessions, but keep both
        set({
          sessions: state.sessions.map((s) => {
            if (s.id === sessionId || s.id === siblingId) {
              return { ...s, splitWith: undefined, splitDirection: undefined };
            }
            return s;
          }),
        });
      },

      getSplitSibling: (sessionId) => {
        const state = get();
        const session = state.sessions.find((s) => s.id === sessionId);
        if (!session?.splitWith) return null;
        return state.sessions.find((s) => s.id === session.splitWith) ?? null;
      },
    }),
    {
      name: "vmark-terminal-ui",
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? localStorage
          : { getItem: () => null, setItem: () => {}, removeItem: () => {} }
      ),
      // Only persist UI state (size, visibility), NOT sessions
      // Sessions start fresh each app launch since PTYs don't survive restart
      partialize: (state) => ({
        visible: state.visible,
        height: state.height,
        width: state.width,
      }),
      // Explicitly ignore old session data from localStorage
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<TerminalState> | undefined;
        if (!persistedState) return current;
        return {
          ...current,
          visible: persistedState.visible ?? current.visible,
          height: persistedState.height ?? current.height,
          width: persistedState.width ?? current.width,
          // Explicitly keep sessions empty - don't restore from old localStorage
        };
      },
    }
  )
);

// Export constants for use in resize hook
export {
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MAX_HEIGHT,
  TERMINAL_MIN_WIDTH,
  TERMINAL_MAX_WIDTH,
  MAX_SESSIONS,
};
