/**
 * Terminal Tabs Component
 *
 * Displays tabs for multiple terminal sessions with add/close controls.
 */

import { Plus, X } from "lucide-react";
import { useTerminalStore, MAX_SESSIONS } from "@/stores/terminalStore";
import "./TerminalTabs.css";

interface TerminalTabsProps {
  onNewSession: () => void;
  onCloseSession: (sessionId: string) => void;
}

export function TerminalTabs({ onNewSession, onCloseSession }: TerminalTabsProps) {
  const sessions = useTerminalStore((state) => state.sessions);
  const activeSessionId = useTerminalStore((state) => state.activeSessionId);
  const setActiveSession = useTerminalStore((state) => state.setActiveSession);

  const canAddMore = sessions.length < MAX_SESSIONS;

  return (
    <div className="terminal-tabs">
      <div className="terminal-tabs-list">
        {sessions.map((session) => (
          <button
            key={session.id}
            className={`terminal-tab ${session.id === activeSessionId ? "active" : ""}`}
            onClick={() => setActiveSession(session.id)}
          >
            <span className="terminal-tab-title">{session.title}</span>
            <button
              className="terminal-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onCloseSession(session.id);
              }}
              title="Close terminal"
            >
              <X className="w-3 h-3" />
            </button>
          </button>
        ))}
      </div>

      {canAddMore && (
        <button
          className="terminal-tab-add"
          onClick={onNewSession}
          title="New terminal"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
