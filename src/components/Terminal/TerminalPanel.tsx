import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTerminalStore } from "@/stores/terminalStore";
import { useTerminalResize } from "@/hooks/useTerminalResize";
import { TerminalView } from "./TerminalView";
import { TerminalTabs } from "./TerminalTabs";
import "./TerminalPanel.css";

export function TerminalPanel() {
  const visible = useTerminalStore((state) => state.visible);
  const height = useTerminalStore((state) => state.height);
  const sessions = useTerminalStore((state) => state.sessions);
  const activeSessionId = useTerminalStore((state) => state.activeSessionId);
  const removeSession = useTerminalStore((state) => state.removeSession);
  const handleResizeStart = useTerminalResize();

  // Local state to track mounted terminals (by key, not session ID)
  // This allows us to mount TerminalView before we know its PTY session ID
  const [mountedTerminals, setMountedTerminals] = useState<string[]>([]);

  // Create a new terminal session by mounting a new TerminalView
  const handleNewSession = useCallback(() => {
    const key = `term-${Date.now()}`;
    setMountedTerminals((prev) => [...prev, key]);
  }, []);

  // Close a session
  const handleCloseSession = useCallback(
    async (sessionId: string) => {
      // Kill PTY if still running
      try {
        await invoke("pty_kill", { sessionId });
      } catch {
        // Session may already be dead
      }
      removeSession(sessionId);
    },
    [removeSession]
  );

  // Auto-create first terminal when panel becomes visible
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (visible && mountedTerminals.length === 0 && !hasInitialized.current) {
      hasInitialized.current = true;
      handleNewSession();
    }
  }, [visible, mountedTerminals.length, handleNewSession]);

  // Clean up mounted terminals that no longer have sessions
  useEffect(() => {
    // Only clean up if we have both mounted terminals and sessions
    if (mountedTerminals.length > 0 && sessions.length < mountedTerminals.length) {
      // Remove the last mounted terminal if session count decreased
      setMountedTerminals((prev) => prev.slice(0, sessions.length || 1));
    }
  }, [sessions.length, mountedTerminals.length]);

  // Reset initialization flag when panel is hidden
  useEffect(() => {
    if (!visible) {
      hasInitialized.current = false;
    }
  }, [visible]);

  if (!visible) return null;

  // Determine which terminals to show
  const hasNoTerminals = mountedTerminals.length === 0;

  return (
    <div className="terminal-panel" style={{ height }}>
      {/* Resize handle at the top */}
      <div className="terminal-resize-handle" onMouseDown={handleResizeStart} />

      {/* Tabs bar - only show when we have sessions */}
      {sessions.length > 0 && (
        <TerminalTabs
          onNewSession={handleNewSession}
          onCloseSession={handleCloseSession}
        />
      )}

      {/* Terminal views - keep all mounted but only show active */}
      <div className="terminal-content">
        {mountedTerminals.map((key, index) => {
          // Match this terminal to a session by index order
          const session = sessions[index];
          const isActive = session?.id === activeSessionId || hasNoTerminals;

          return (
            <div
              key={key}
              className="terminal-session"
              style={{ display: isActive ? "flex" : "none" }}
            >
              <TerminalView />
            </div>
          );
        })}
      </div>
    </div>
  );
}
