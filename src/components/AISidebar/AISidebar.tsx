/**
 * AI Sidebar Component
 *
 * Right sidebar for AI assistant interactions with session history and chat view.
 */

import { useRef, useEffect, useState, useCallback } from "react";
import { X, Plus, Trash2, Send, Bot, User, Loader2 } from "lucide-react";
import {
  useAISidebarStore,
  selectIsOpen,
  selectWidth,
  selectSessions,
  selectCurrentSessionId,
  selectIsStreaming,
  selectPartialResponse,
  type Session,
} from "@/stores/aiSidebarStore";
import { useAIAgent } from "@/hooks/useAIAgent";
import "./AISidebar.css";

// --- Session List ---

interface SessionItemProps {
  session: Session;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function SessionItem({ session, isActive, onSelect, onDelete }: SessionItemProps) {
  const timeAgo = formatTimeAgo(session.updatedAt);

  return (
    <div
      className={`ai-session-item ${isActive ? "active" : ""}`}
      onClick={onSelect}
    >
      <div className="ai-session-item-content">
        <div className="ai-session-item-title">{session.title}</div>
        <div className="ai-session-item-time">{timeAgo}</div>
      </div>
      <button
        className="ai-session-item-delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete session"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function SessionList() {
  const sessions = useAISidebarStore(selectSessions);
  const currentSessionId = useAISidebarStore(selectCurrentSessionId);
  const selectSession = useAISidebarStore((s) => s.selectSession);
  const deleteSession = useAISidebarStore((s) => s.deleteSession);
  const createSession = useAISidebarStore((s) => s.createSession);

  // Group sessions by date
  const groupedSessions = groupSessionsByDate(sessions);

  return (
    <div className="ai-session-list">
      <div className="ai-session-list-header">
        <span>Sessions</span>
        <button
          className="ai-session-new-btn"
          onClick={createSession}
          title="New conversation"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="ai-session-list-content">
        {Object.entries(groupedSessions).map(([group, groupSessions]) => (
          <div key={group} className="ai-session-group">
            <div className="ai-session-group-header">{group}</div>
            {groupSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === currentSessionId}
                onSelect={() => selectSession(session.id)}
                onDelete={() => deleteSession(session.id)}
              />
            ))}
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="ai-session-empty">
            No conversations yet. Start one below!
          </div>
        )}
      </div>
    </div>
  );
}

// --- Message Bubble ---

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

function MessageBubble({ role, content, isStreaming }: MessageBubbleProps) {
  const Icon = role === "user" ? User : Bot;

  return (
    <div className={`ai-message ${role}`}>
      <div className="ai-message-icon">
        <Icon size={14} />
      </div>
      <div className="ai-message-content">
        {content}
        {isStreaming && <span className="ai-cursor">|</span>}
      </div>
    </div>
  );
}

// --- Chat View ---

function ChatView() {
  const currentSession = useAISidebarStore((s) => s.getCurrentSession());
  const isStreaming = useAISidebarStore(selectIsStreaming);
  const partialResponse = useAISidebarStore(selectPartialResponse);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = currentSession?.messages ?? [];

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, partialResponse]);

  if (!currentSession) {
    return (
      <div className="ai-chat-empty">
        <Bot size={32} className="ai-chat-empty-icon" />
        <p>Select a session or start a new conversation</p>
      </div>
    );
  }

  return (
    <div className="ai-chat-view">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
      ))}
      {isStreaming && partialResponse && (
        <MessageBubble role="assistant" content={partialResponse} isStreaming />
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

// --- Input Area ---

function ChatInput() {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { customPrompt, isProcessing, cancel, partialContent } = useAIAgent();
  const addUserMessage = useAISidebarStore((s) => s.addUserMessage);
  const updateStreamingMessage = useAISidebarStore((s) => s.updateStreamingMessage);
  const completeStreamingMessage = useAISidebarStore((s) => s.completeStreamingMessage);
  const createSession = useAISidebarStore((s) => s.createSession);
  const currentSessionId = useAISidebarStore(selectCurrentSessionId);

  // Sync streaming content from useAIAgent to sidebar store
  useEffect(() => {
    if (isProcessing && partialContent) {
      updateStreamingMessage(partialContent);
    }
  }, [isProcessing, partialContent, updateStreamingMessage]);

  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isProcessing) return;

    // Create session if none exists
    if (!currentSessionId) {
      createSession();
    }

    // Add user message to store
    addUserMessage(trimmed);
    setInput("");

    try {
      // Run the AI query
      const result = await customPrompt(trimmed);
      completeStreamingMessage();
      // The useAIAgent hook handles streaming via partialContent
      // We just need to store the final result
      if (result) {
        // Result is already in partialResponse, completeStreamingMessage will handle it
      }
    } catch {
      // Error handled by hook
    }
  }, [input, isProcessing, currentSessionId, addUserMessage, customPrompt, completeStreamingMessage, createSession]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="ai-chat-input-container">
      <textarea
        ref={inputRef}
        className="ai-chat-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message..."
        rows={1}
        disabled={isProcessing}
      />
      {isProcessing ? (
        <button className="ai-chat-send-btn" onClick={cancel} title="Cancel">
          <Loader2 size={16} className="animate-spin" />
        </button>
      ) : (
        <button
          className="ai-chat-send-btn"
          onClick={handleSubmit}
          disabled={!input.trim()}
          title="Send"
        >
          <Send size={16} />
        </button>
      )}
    </div>
  );
}

// --- Main Component ---

export function AISidebar() {
  const isOpen = useAISidebarStore(selectIsOpen);
  const width = useAISidebarStore(selectWidth);
  const closeSidebar = useAISidebarStore((s) => s.closeSidebar);
  const setWidth = useAISidebarStore((s) => s.setWidth);

  // Resize handling
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(width);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = startX.current - e.clientX;
      setWidth(startWidth.current + delta);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [setWidth]);

  if (!isOpen) return null;

  return (
    <div className="ai-sidebar" style={{ width }}>
      {/* Resize handle */}
      <div className="ai-sidebar-resize" onMouseDown={handleMouseDown} />

      {/* Header */}
      <div className="ai-sidebar-header">
        <div className="ai-sidebar-title">
          <Bot size={16} />
          <span>AI Assistant</span>
        </div>
        <button className="ai-sidebar-close" onClick={closeSidebar} title="Close">
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="ai-sidebar-content">
        <SessionList />
        <div className="ai-sidebar-divider" />
        <ChatView />
      </div>

      {/* Input */}
      <ChatInput />
    </div>
  );
}

// --- Helpers ---

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function groupSessionsByDate(sessions: Session[]): Record<string, Session[]> {
  const groups: Record<string, Session[]> = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const thisWeek = today - 7 * 86400000;

  for (const session of sessions) {
    let group: string;
    if (session.updatedAt >= today) {
      group = "Today";
    } else if (session.updatedAt >= yesterday) {
      group = "Yesterday";
    } else if (session.updatedAt >= thisWeek) {
      group = "This Week";
    } else {
      group = "Older";
    }

    if (!groups[group]) {
      groups[group] = [];
    }
    groups[group].push(session);
  }

  return groups;
}

export default AISidebar;
