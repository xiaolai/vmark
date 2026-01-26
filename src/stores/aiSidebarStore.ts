/**
 * AI Sidebar Store
 *
 * Manages AI sidebar state including sessions, messages, and streaming.
 * Sessions persist across app restarts via localStorage.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// --- Types ---

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

interface AISidebarState {
  // UI State
  isOpen: boolean;
  width: number;

  // Session State
  sessions: Session[];
  currentSessionId: string | null;

  // Streaming State
  isStreaming: boolean;
  partialResponse: string;

  // Actions
  toggleSidebar: () => void;
  openSidebar: () => void;
  closeSidebar: () => void;
  setWidth: (width: number) => void;

  // Session Actions
  createSession: () => string;
  selectSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  clearAllSessions: () => void;

  // Message Actions
  addUserMessage: (content: string) => void;
  addAssistantMessage: (content: string) => void;
  updateStreamingMessage: (content: string) => void;
  completeStreamingMessage: () => void;

  // Getters
  getCurrentSession: () => Session | null;
  getSessionMessages: () => Message[];
}

// --- Constants ---

const MAX_SESSIONS = 50;
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 280;
const MAX_WIDTH = 500;

// --- Helpers ---

const generateId = () => crypto.randomUUID();

const generateSessionTitle = (firstMessage: string): string => {
  // Take first 30 chars of first message as title
  const title = firstMessage.slice(0, 30).trim();
  return title.length < firstMessage.length ? `${title}...` : title;
};

// --- Store ---

export const useAISidebarStore = create<AISidebarState>()(
  persist(
    (set, get) => ({
      // Initial State
      isOpen: false,
      width: DEFAULT_WIDTH,
      sessions: [],
      currentSessionId: null,
      isStreaming: false,
      partialResponse: "",

      // UI Actions
      toggleSidebar: () => set((state) => ({ isOpen: !state.isOpen })),
      openSidebar: () => set({ isOpen: true }),
      closeSidebar: () => set({ isOpen: false }),
      setWidth: (width) =>
        set({ width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width)) }),

      // Session Actions
      createSession: () => {
        const id = generateId();
        const now = Date.now();
        const newSession: Session = {
          id,
          title: "New Conversation",
          createdAt: now,
          updatedAt: now,
          messages: [],
        };

        set((state) => {
          // Limit sessions to MAX_SESSIONS (remove oldest)
          const sessions = [newSession, ...state.sessions].slice(0, MAX_SESSIONS);
          return {
            sessions,
            currentSessionId: id,
            isStreaming: false,
            partialResponse: "",
          };
        });

        return id;
      },

      selectSession: (sessionId) => {
        const session = get().sessions.find((s) => s.id === sessionId);
        if (session) {
          set({
            currentSessionId: sessionId,
            isStreaming: false,
            partialResponse: "",
          });
        }
      },

      deleteSession: (sessionId) => {
        set((state) => {
          const sessions = state.sessions.filter((s) => s.id !== sessionId);
          const currentSessionId =
            state.currentSessionId === sessionId
              ? sessions[0]?.id ?? null
              : state.currentSessionId;
          return { sessions, currentSessionId };
        });
      },

      clearAllSessions: () => {
        set({
          sessions: [],
          currentSessionId: null,
          isStreaming: false,
          partialResponse: "",
        });
      },

      // Message Actions
      addUserMessage: (content) => {
        const state = get();
        let sessionId = state.currentSessionId;

        // Create session if none exists
        if (!sessionId) {
          sessionId = get().createSession();
        }

        const message: Message = {
          id: generateId(),
          role: "user",
          content,
          timestamp: Date.now(),
        };

        set((state) => ({
          sessions: state.sessions.map((session) => {
            if (session.id !== sessionId) return session;

            const messages = [...session.messages, message];
            const title =
              session.messages.length === 0
                ? generateSessionTitle(content)
                : session.title;

            return {
              ...session,
              title,
              updatedAt: Date.now(),
              messages,
            };
          }),
        }));
      },

      addAssistantMessage: (content) => {
        const { currentSessionId } = get();
        if (!currentSessionId) return;

        const message: Message = {
          id: generateId(),
          role: "assistant",
          content,
          timestamp: Date.now(),
        };

        set((state) => ({
          sessions: state.sessions.map((session) => {
            if (session.id !== currentSessionId) return session;
            return {
              ...session,
              updatedAt: Date.now(),
              messages: [...session.messages, message],
            };
          }),
          isStreaming: false,
          partialResponse: "",
        }));
      },

      updateStreamingMessage: (content) => {
        set({
          isStreaming: true,
          partialResponse: content,
        });
      },

      completeStreamingMessage: () => {
        const { partialResponse, currentSessionId } = get();
        if (!currentSessionId || !partialResponse) {
          set({ isStreaming: false, partialResponse: "" });
          return;
        }

        // Add the complete message
        const message: Message = {
          id: generateId(),
          role: "assistant",
          content: partialResponse,
          timestamp: Date.now(),
        };

        set((state) => ({
          sessions: state.sessions.map((session) => {
            if (session.id !== currentSessionId) return session;
            return {
              ...session,
              updatedAt: Date.now(),
              messages: [...session.messages, message],
            };
          }),
          isStreaming: false,
          partialResponse: "",
        }));
      },

      // Getters
      getCurrentSession: () => {
        const { sessions, currentSessionId } = get();
        return sessions.find((s) => s.id === currentSessionId) ?? null;
      },

      getSessionMessages: () => {
        const session = get().getCurrentSession();
        return session?.messages ?? [];
      },
    }),
    {
      name: "vmark-ai-sidebar",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Only persist these fields
        isOpen: state.isOpen,
        width: state.width,
        sessions: state.sessions,
        currentSessionId: state.currentSessionId,
      }),
    }
  )
);

// --- Selectors ---

export const selectIsOpen = (state: AISidebarState) => state.isOpen;
export const selectWidth = (state: AISidebarState) => state.width;
export const selectSessions = (state: AISidebarState) => state.sessions;
export const selectCurrentSessionId = (state: AISidebarState) => state.currentSessionId;
export const selectIsStreaming = (state: AISidebarState) => state.isStreaming;
export const selectPartialResponse = (state: AISidebarState) => state.partialResponse;
