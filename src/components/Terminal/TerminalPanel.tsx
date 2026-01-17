import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  useTerminalStore,
  type TerminalSession,
  type SplitDirection,
} from "@/stores/terminalStore";
import { useSettingsStore, type ThemeId } from "@/stores/settingsStore";
import { useTerminalResize } from "@/hooks/useTerminalResize";
import { TerminalView } from "./TerminalView";
import { TerminalTabs } from "./TerminalTabs";
import "./TerminalPanel.css";

/**
 * Chrome colors for terminal panel (tabs, header, buttons).
 * These match the terminal content themes for visual consistency.
 */
interface TerminalChromeColors {
  bg: string;
  border: string;
  text: string;
  textActive: string;
  hoverBg: string;
  activeBg: string;
}

const chromeThemes: Record<ThemeId, TerminalChromeColors> = {
  // White theme - clean, light
  white: {
    bg: "#f3f3f3",
    border: "#e0e0e0",
    text: "#666666",
    textActive: "#1a1a1a",
    hoverBg: "#e8e8e8",
    activeBg: "#ffffff",
  },
  // Paper theme - soft gray
  paper: {
    bg: "#e6e5e5",
    border: "#d5d4d4",
    text: "#666666",
    textActive: "#1a1a1a",
    hoverBg: "#dcdcdc",
    activeBg: "#EEEDED",
  },
  // Mint theme - green-tinted
  mint: {
    bg: "#b8d9bd",
    border: "#a3c9a8",
    text: "#4a5f52",
    textActive: "#2d3a35",
    hoverBg: "#a8cead",
    activeBg: "#CCE6D0",
  },
  // Sepia theme - warm, book-like
  sepia: {
    bg: "#efe5ce",
    border: "#e0d4b8",
    text: "#8b7355",
    textActive: "#5c4b37",
    hoverBg: "#e6d9be",
    activeBg: "#F9F0DB",
  },
  // Night theme - dark with vibrant accents
  night: {
    bg: "#252526",
    border: "#3c3c3c",
    text: "#808080",
    textActive: "#d6d9de",
    hoverBg: "#2a2d2e",
    activeBg: "#23262b",
  },
};

/** Get terminal chrome colors based on settings */
function useTerminalChromeColors(): TerminalChromeColors {
  const terminalThemeSetting = useSettingsStore((state) => state.terminal.theme);
  const appTheme = useSettingsStore((state) => state.appearance.theme);

  return useMemo(() => {
    // "Dark" - always use Night chrome
    if (terminalThemeSetting === "dark") return chromeThemes.night;

    // "Light" - use current app theme, but if app is Night, use White instead
    if (terminalThemeSetting === "light") {
      return appTheme === "night" ? chromeThemes.white : chromeThemes[appTheme];
    }

    // "Follow App" (auto) - use the chrome that matches the app theme
    return chromeThemes[appTheme] ?? chromeThemes.paper;
  }, [terminalThemeSetting, appTheme]);
}

/** Represents a mounted terminal - either new or restoring */
interface MountedTerminal {
  key: string;
  /** Session to restore, if any */
  sessionToRestore?: TerminalSession;
}

export function TerminalPanel() {
  const visible = useTerminalStore((state) => state.visible);
  const height = useTerminalStore((state) => state.height);
  const width = useTerminalStore((state) => state.width);
  const sessions = useTerminalStore((state) => state.sessions);
  const activeSessionId = useTerminalStore((state) => state.activeSessionId);
  const removeSession = useTerminalStore((state) => state.removeSession);
  const getSessionsToRestore = useTerminalStore((state) => state.getSessionsToRestore);
  const splitSession = useTerminalStore((state) => state.splitSession);
  const position = useSettingsStore((state) => state.terminal.position);
  const handleResizeStart = useTerminalResize();
  const chromeColors = useTerminalChromeColors();

  // Local state to track mounted terminals
  const [mountedTerminals, setMountedTerminals] = useState<MountedTerminal[]>([]);

  // Create a new terminal session by mounting a new TerminalView
  const handleNewSession = useCallback(() => {
    const key = `term-${Date.now()}`;
    setMountedTerminals((prev) => [...prev, { key }]);
  }, []);

  // Split the active session
  const handleSplitSession = useCallback(
    (sessionId: string, direction: SplitDirection) => {
      // Create placeholder ID - will be updated when PTY spawns
      const tempId = `split-${Date.now()}`;
      splitSession(sessionId, tempId, direction);
      // Mount a new terminal view for the split
      setMountedTerminals((prev) => [...prev, { key: `split-${tempId}` }]);
    },
    [splitSession]
  );

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

  // Restore sessions on initial mount when panel becomes visible
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (visible && mountedTerminals.length === 0 && !hasInitialized.current) {
      hasInitialized.current = true;

      // Check for sessions that need restoration
      const sessionsToRestore = getSessionsToRestore();

      if (sessionsToRestore.length > 0) {
        // Mount terminals for each session that needs restoration
        const restoredTerminals: MountedTerminal[] = sessionsToRestore.map((session, index) => ({
          key: `restore-${session.id}-${index}`,
          sessionToRestore: session,
        }));
        setMountedTerminals(restoredTerminals);
      } else {
        // No sessions to restore, create a new one
        handleNewSession();
      }
    }
  }, [visible, mountedTerminals.length, handleNewSession, getSessionsToRestore]);

  // Clean up mounted terminals that no longer have sessions
  useEffect(() => {
    // Count active sessions (not needing restore)
    const activeSessionCount = sessions.filter((s) => !s.needsRestore).length;
    // Only clean up after restoration is complete
    if (mountedTerminals.length > 0 && activeSessionCount > 0 && activeSessionCount < mountedTerminals.length) {
      setMountedTerminals((prev) => prev.slice(0, activeSessionCount || 1));
    }
  }, [sessions, mountedTerminals.length]);

  // Reset initialization flag when panel is hidden
  useEffect(() => {
    if (!visible) {
      hasInitialized.current = false;
    }
  }, [visible]);

  if (!visible) return null;

  // Determine which terminals to show
  const hasNoTerminals = mountedTerminals.length === 0;
  const isRightPosition = position === "right";

  // Style based on position, including chrome CSS custom properties
  const panelStyle: React.CSSProperties & Record<`--${string}`, string> = {
    ...(isRightPosition ? { width, height: "100%" } : { height, width: "100%" }),
    "--terminal-chrome-bg": chromeColors.bg,
    "--terminal-chrome-border": chromeColors.border,
    "--terminal-chrome-text": chromeColors.text,
    "--terminal-chrome-text-active": chromeColors.textActive,
    "--terminal-chrome-hover-bg": chromeColors.hoverBg,
    "--terminal-chrome-active-bg": chromeColors.activeBg,
  };

  const panelClassName = `terminal-panel terminal-panel--${position}`;

  // Get the active session and check if it has a split
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const hasSplit = activeSession?.splitWith && activeSession?.splitDirection;
  const splitSibling = hasSplit
    ? sessions.find((s) => s.id === activeSession.splitWith)
    : null;

  return (
    <div className={panelClassName} style={panelStyle}>
      {/* Resize handle - position depends on panel position */}
      <div
        className={`terminal-resize-handle terminal-resize-handle--${position}`}
        onMouseDown={handleResizeStart}
      />

      {/* Tabs bar - only show when we have sessions */}
      {sessions.length > 0 && (
        <TerminalTabs
          onNewSession={handleNewSession}
          onCloseSession={handleCloseSession}
          onSplitSession={handleSplitSession}
        />
      )}

      {/* Terminal views */}
      <div className="terminal-content">
        {/* If active session has a split, render split layout */}
        {hasSplit && splitSibling ? (
          <div
            className={`terminal-split terminal-split--${activeSession!.splitDirection}`}
          >
            {/* Primary terminal */}
            <div className="terminal-split-pane">
              {mountedTerminals.map((mounted, index) => {
                const session = sessions[index];
                if (session?.id !== activeSessionId) return null;
                return (
                  <div key={mounted.key} className="terminal-session">
                    <TerminalView sessionToRestore={mounted.sessionToRestore} />
                  </div>
                );
              })}
            </div>
            {/* Split divider */}
            <div className="terminal-split-divider" />
            {/* Secondary terminal */}
            <div className="terminal-split-pane">
              {mountedTerminals.map((mounted, index) => {
                const session = sessions[index];
                if (session?.id !== splitSibling.id) return null;
                return (
                  <div key={mounted.key} className="terminal-session">
                    <TerminalView sessionToRestore={mounted.sessionToRestore} />
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Normal single terminal view */
          mountedTerminals.map((mounted, index) => {
            const session = sessions[index];
            const isActive = session?.id === activeSessionId || hasNoTerminals;

            return (
              <div
                key={mounted.key}
                className="terminal-session"
                style={{ display: isActive ? "flex" : "none" }}
              >
                <TerminalView sessionToRestore={mounted.sessionToRestore} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
