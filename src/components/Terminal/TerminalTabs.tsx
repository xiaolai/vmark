/**
 * Terminal Tabs Component
 *
 * Displays tabs for multiple terminal sessions with add/close/split controls.
 */

import { Plus, X, Columns2, Rows2 } from "lucide-react";
import { useTerminalStore, MAX_SESSIONS, type SplitDirection } from "@/stores/terminalStore";
import "./TerminalTabs.css";

interface TerminalTabsProps {
  onNewSession: () => void;
  onCloseSession: (sessionId: string) => void;
  onSplitSession?: (sessionId: string, direction: SplitDirection) => void;
}

export function TerminalTabs({ onNewSession, onCloseSession, onSplitSession }: TerminalTabsProps) {
  const sessions = useTerminalStore((state) => state.sessions);
  const activeSessionId = useTerminalStore((state) => state.activeSessionId);
  const setActiveSession = useTerminalStore((state) => state.setActiveSession);

  const canAddMore = sessions.length < MAX_SESSIONS;
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const canSplit = canAddMore && activeSession && !activeSession.splitWith;

  return (
    <div className="terminal-tabs">
      {/* New terminal button - leftmost */}
      {canAddMore && (
        <button
          className="terminal-tab-action"
          onClick={onNewSession}
          title="New terminal"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}

      <div className="terminal-tabs-list">
        {sessions
          // Don't show tabs for sessions that are secondary in a split (they share the main tab)
          .filter((session) => {
            // If this session has splitWith set but no splitDirection, it's a secondary session
            if (session.splitWith && !session.splitDirection) return false;
            return true;
          })
          .map((session) => (
            <button
              key={session.id}
              className={`terminal-tab ${session.id === activeSessionId ? "active" : ""}`}
              onClick={() => setActiveSession(session.id)}
            >
              <span className="terminal-tab-title">
                {session.title}
                {session.splitWith && session.splitDirection && " (split)"}
              </span>
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

      <div className="terminal-tabs-actions">
        {/* Split horizontal button */}
        {canSplit && onSplitSession && (
          <button
            className="terminal-tab-action"
            onClick={() => onSplitSession(activeSessionId!, "horizontal")}
            title="Split horizontal"
          >
            <Columns2 className="w-4 h-4" />
          </button>
        )}

        {/* Split vertical button */}
        {canSplit && onSplitSession && (
          <button
            className="terminal-tab-action"
            onClick={() => onSplitSession(activeSessionId!, "vertical")}
            title="Split vertical"
          >
            <Rows2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
