/**
 * AI Sidebar Store Tests
 *
 * Tests for session management, messages, and streaming state.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAISidebarStore } from "./aiSidebarStore";

// Mock localStorage for persistence tests
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

// Mock crypto.randomUUID
vi.stubGlobal("crypto", {
  randomUUID: vi.fn(() => `test-uuid-${Date.now()}-${Math.random()}`),
});

describe("aiSidebarStore", () => {
  beforeEach(() => {
    // Reset store to initial state
    useAISidebarStore.setState({
      isOpen: false,
      width: 320,
      sessions: [],
      currentSessionId: null,
      isStreaming: false,
      partialResponse: "",
    });
    localStorageMock.clear();
  });

  describe("UI State", () => {
    it("has correct initial state", () => {
      const state = useAISidebarStore.getState();

      expect(state.isOpen).toBe(false);
      expect(state.width).toBe(320);
      expect(state.sessions).toEqual([]);
      expect(state.currentSessionId).toBeNull();
      expect(state.isStreaming).toBe(false);
      expect(state.partialResponse).toBe("");
    });

    it("toggleSidebar toggles isOpen", () => {
      const { toggleSidebar } = useAISidebarStore.getState();

      expect(useAISidebarStore.getState().isOpen).toBe(false);

      toggleSidebar();
      expect(useAISidebarStore.getState().isOpen).toBe(true);

      toggleSidebar();
      expect(useAISidebarStore.getState().isOpen).toBe(false);
    });

    it("openSidebar sets isOpen to true", () => {
      const { openSidebar } = useAISidebarStore.getState();

      openSidebar();
      expect(useAISidebarStore.getState().isOpen).toBe(true);

      // Should stay true if called again
      openSidebar();
      expect(useAISidebarStore.getState().isOpen).toBe(true);
    });

    it("closeSidebar sets isOpen to false", () => {
      useAISidebarStore.setState({ isOpen: true });
      const { closeSidebar } = useAISidebarStore.getState();

      closeSidebar();
      expect(useAISidebarStore.getState().isOpen).toBe(false);
    });

    it("setWidth updates width within bounds", () => {
      const { setWidth } = useAISidebarStore.getState();

      // Normal value
      setWidth(400);
      expect(useAISidebarStore.getState().width).toBe(400);

      // Below minimum (280)
      setWidth(200);
      expect(useAISidebarStore.getState().width).toBe(280);

      // Above maximum (500)
      setWidth(600);
      expect(useAISidebarStore.getState().width).toBe(500);
    });
  });

  describe("Session Management", () => {
    it("createSession creates a new session and selects it", () => {
      const { createSession } = useAISidebarStore.getState();

      const sessionId = createSession();

      const state = useAISidebarStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.currentSessionId).toBe(sessionId);
      expect(state.sessions[0].id).toBe(sessionId);
      expect(state.sessions[0].title).toBe("New Conversation");
      expect(state.sessions[0].messages).toEqual([]);
    });

    it("createSession adds new session at the beginning", () => {
      const { createSession } = useAISidebarStore.getState();

      const firstId = createSession();
      const secondId = createSession();

      const { sessions } = useAISidebarStore.getState();
      expect(sessions[0].id).toBe(secondId);
      expect(sessions[1].id).toBe(firstId);
    });

    it("createSession limits sessions to MAX_SESSIONS (50)", () => {
      const { createSession } = useAISidebarStore.getState();

      // Create 55 sessions
      for (let i = 0; i < 55; i++) {
        createSession();
      }

      const { sessions } = useAISidebarStore.getState();
      expect(sessions).toHaveLength(50);
    });

    it("selectSession changes currentSessionId", () => {
      const { createSession, selectSession } = useAISidebarStore.getState();

      const firstId = createSession();
      const secondId = createSession();

      expect(useAISidebarStore.getState().currentSessionId).toBe(secondId);

      selectSession(firstId);
      expect(useAISidebarStore.getState().currentSessionId).toBe(firstId);
    });

    it("selectSession clears streaming state", () => {
      const { createSession, selectSession } = useAISidebarStore.getState();

      createSession();
      const secondId = createSession();

      // Set streaming state
      useAISidebarStore.setState({
        isStreaming: true,
        partialResponse: "partial content",
      });

      selectSession(secondId);

      const state = useAISidebarStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.partialResponse).toBe("");
    });

    it("selectSession does nothing for non-existent session", () => {
      const { createSession, selectSession } = useAISidebarStore.getState();

      const sessionId = createSession();
      selectSession("non-existent-id");

      expect(useAISidebarStore.getState().currentSessionId).toBe(sessionId);
    });

    it("deleteSession removes session and selects another", () => {
      const { createSession, deleteSession } = useAISidebarStore.getState();

      const firstId = createSession();
      const secondId = createSession();

      deleteSession(secondId);

      const state = useAISidebarStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.currentSessionId).toBe(firstId);
    });

    it("deleteSession sets currentSessionId to null when last session deleted", () => {
      const { createSession, deleteSession } = useAISidebarStore.getState();

      const sessionId = createSession();
      deleteSession(sessionId);

      const state = useAISidebarStore.getState();
      expect(state.sessions).toHaveLength(0);
      expect(state.currentSessionId).toBeNull();
    });

    it("clearAllSessions removes all sessions", () => {
      const { createSession, clearAllSessions } = useAISidebarStore.getState();

      createSession();
      createSession();
      createSession();

      clearAllSessions();

      const state = useAISidebarStore.getState();
      expect(state.sessions).toHaveLength(0);
      expect(state.currentSessionId).toBeNull();
      expect(state.isStreaming).toBe(false);
      expect(state.partialResponse).toBe("");
    });
  });

  describe("Message Actions", () => {
    it("addUserMessage adds message to current session", () => {
      const { createSession, addUserMessage } = useAISidebarStore.getState();

      createSession();
      addUserMessage("Hello, AI!");

      const session = useAISidebarStore.getState().getCurrentSession();
      expect(session?.messages).toHaveLength(1);
      expect(session?.messages[0].role).toBe("user");
      expect(session?.messages[0].content).toBe("Hello, AI!");
    });

    it("addUserMessage creates session if none exists", () => {
      const { addUserMessage } = useAISidebarStore.getState();

      expect(useAISidebarStore.getState().sessions).toHaveLength(0);

      addUserMessage("Hello!");

      const state = useAISidebarStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.currentSessionId).not.toBeNull();
    });

    it("addUserMessage updates session title from first message", () => {
      const { createSession, addUserMessage } = useAISidebarStore.getState();

      createSession();
      addUserMessage("This is a very long first message that should be truncated");

      const session = useAISidebarStore.getState().getCurrentSession();
      // Title is first 30 chars + "..." if truncated
      expect(session?.title).toBe("This is a very long first mess...");
    });

    it("addUserMessage does not update title on subsequent messages", () => {
      const { createSession, addUserMessage } = useAISidebarStore.getState();

      createSession();
      addUserMessage("First message");
      addUserMessage("Second message");

      const session = useAISidebarStore.getState().getCurrentSession();
      expect(session?.title).toBe("First message");
    });

    it("addAssistantMessage adds message to current session", () => {
      const { createSession, addAssistantMessage } = useAISidebarStore.getState();

      createSession();
      addAssistantMessage("Hello, I am the AI assistant!");

      const session = useAISidebarStore.getState().getCurrentSession();
      expect(session?.messages).toHaveLength(1);
      expect(session?.messages[0].role).toBe("assistant");
      expect(session?.messages[0].content).toBe("Hello, I am the AI assistant!");
    });

    it("addAssistantMessage clears streaming state", () => {
      const { createSession, addAssistantMessage } = useAISidebarStore.getState();

      createSession();
      useAISidebarStore.setState({
        isStreaming: true,
        partialResponse: "partial",
      });

      addAssistantMessage("Complete response");

      const state = useAISidebarStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.partialResponse).toBe("");
    });

    it("addAssistantMessage does nothing without current session", () => {
      const { addAssistantMessage } = useAISidebarStore.getState();

      addAssistantMessage("No session message");

      expect(useAISidebarStore.getState().sessions).toHaveLength(0);
    });
  });

  describe("Streaming", () => {
    it("updateStreamingMessage sets streaming state", () => {
      const { createSession, updateStreamingMessage } = useAISidebarStore.getState();

      createSession();
      updateStreamingMessage("Streaming content...");

      const state = useAISidebarStore.getState();
      expect(state.isStreaming).toBe(true);
      expect(state.partialResponse).toBe("Streaming content...");
    });

    it("updateStreamingMessage accumulates content", () => {
      const { createSession, updateStreamingMessage } = useAISidebarStore.getState();

      createSession();
      updateStreamingMessage("Part 1");
      updateStreamingMessage("Part 1 Part 2");

      expect(useAISidebarStore.getState().partialResponse).toBe("Part 1 Part 2");
    });

    it("completeStreamingMessage adds final message and clears streaming", () => {
      const { createSession, updateStreamingMessage, completeStreamingMessage } =
        useAISidebarStore.getState();

      createSession();
      updateStreamingMessage("Complete response text");
      completeStreamingMessage();

      const state = useAISidebarStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.partialResponse).toBe("");

      const session = state.getCurrentSession();
      expect(session?.messages).toHaveLength(1);
      expect(session?.messages[0].role).toBe("assistant");
      expect(session?.messages[0].content).toBe("Complete response text");
    });

    it("completeStreamingMessage does nothing without partial response", () => {
      const { createSession, completeStreamingMessage } = useAISidebarStore.getState();

      createSession();
      completeStreamingMessage();

      const session = useAISidebarStore.getState().getCurrentSession();
      expect(session?.messages).toHaveLength(0);
    });

    it("completeStreamingMessage does nothing without current session", () => {
      const { completeStreamingMessage } = useAISidebarStore.getState();

      useAISidebarStore.setState({
        isStreaming: true,
        partialResponse: "orphan response",
      });

      completeStreamingMessage();

      const state = useAISidebarStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.partialResponse).toBe("");
      expect(state.sessions).toHaveLength(0);
    });
  });

  describe("Getters", () => {
    it("getCurrentSession returns current session", () => {
      const { createSession, getCurrentSession } = useAISidebarStore.getState();

      const sessionId = createSession();
      const session = getCurrentSession();

      expect(session).not.toBeNull();
      expect(session?.id).toBe(sessionId);
    });

    it("getCurrentSession returns null when no session selected", () => {
      const { getCurrentSession } = useAISidebarStore.getState();

      expect(getCurrentSession()).toBeNull();
    });

    it("getSessionMessages returns messages from current session", () => {
      const { createSession, addUserMessage, addAssistantMessage, getSessionMessages } =
        useAISidebarStore.getState();

      createSession();
      addUserMessage("User message");
      addAssistantMessage("Assistant message");

      const messages = getSessionMessages();
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("User message");
      expect(messages[1].content).toBe("Assistant message");
    });

    it("getSessionMessages returns empty array when no session", () => {
      const { getSessionMessages } = useAISidebarStore.getState();

      expect(getSessionMessages()).toEqual([]);
    });
  });

  describe("Session timestamps", () => {
    it("createSession sets createdAt and updatedAt", () => {
      const before = Date.now();
      const { createSession } = useAISidebarStore.getState();

      createSession();

      const session = useAISidebarStore.getState().getCurrentSession();
      const after = Date.now();

      expect(session?.createdAt).toBeGreaterThanOrEqual(before);
      expect(session?.createdAt).toBeLessThanOrEqual(after);
      expect(session?.updatedAt).toBe(session?.createdAt);
    });

    it("addUserMessage updates session updatedAt", async () => {
      const { createSession, addUserMessage } = useAISidebarStore.getState();

      createSession();
      const initialUpdatedAt = useAISidebarStore.getState().getCurrentSession()?.updatedAt;

      // Small delay to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 10));

      addUserMessage("New message");
      const newUpdatedAt = useAISidebarStore.getState().getCurrentSession()?.updatedAt;

      expect(newUpdatedAt).toBeGreaterThan(initialUpdatedAt!);
    });
  });
});
