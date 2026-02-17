/**
 * TerminalPanel
 *
 * Purpose: Container for the integrated terminal — sits below or to the right
 * of the editor (based on effectiveTerminalPosition) with a drag-to-resize
 * handle. Hosts multiple terminal sessions via useTerminalSessions, a search
 * bar, a tab bar, and a context menu.
 *
 * User interactions:
 *   - Drag the resize handle to adjust panel height (bottom) or width (right)
 *   - Right-click for copy/paste/clear context menu
 *   - Use the tab bar to create/switch/close terminal sessions
 *   - Cmd+F within terminal opens the inline search bar
 *
 * Key decisions:
 *   - Deferred activation: xterm is not initialized until the panel is first
 *     shown (activated flag), avoiding the performance cost of creating a
 *     terminal instance on every app launch.
 *   - NULL_REF sentinel prevents useTerminalSessions from initializing
 *     before the container is mounted.
 *   - Auto-creates a session when the panel becomes visible with none
 *     existing (e.g., user closed all tabs then re-opened the panel).
 *   - Fit is called on show, resize, and position change to keep xterm
 *     dimensions in sync.
 *   - Adds .terminal-resizing class during drag to suppress CSS transitions.
 *
 * @coordinates-with useTerminalSessions.ts — manages xterm + PTY lifecycle
 * @coordinates-with useTerminalResize.ts — vertical/horizontal drag handle
 * @coordinates-with useTerminalPosition.ts — auto-repositioning algorithm
 * @coordinates-with TerminalTabBar.tsx — session switching and management
 * @coordinates-with TerminalSearchBar.tsx — inline search within terminal output
 * @coordinates-with TerminalContextMenu.tsx — right-click copy/paste/clear menu
 * @module components/Terminal/TerminalPanel
 */
import { useRef, useEffect, useState, useCallback, type RefObject } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useTerminalSessionStore } from "@/stores/terminalSessionStore";
import { useTerminalSessions } from "./useTerminalSessions";
import { useTerminalResize } from "./useTerminalResize";
import { TerminalTabBar } from "./TerminalTabBar";
import { TerminalContextMenu } from "./TerminalContextMenu";
import { TerminalSearchBar } from "./TerminalSearchBar";
import "./terminal-panel.css";

const NULL_REF: RefObject<HTMLDivElement | null> = { current: null };

export function TerminalPanel() {
  const visible = useUIStore((s) => s.terminalVisible);
  const height = useUIStore((s) => s.terminalHeight);
  const width = useUIStore((s) => s.terminalWidth);
  const position = useUIStore((s) => s.effectiveTerminalPosition);
  const containerRef = useRef<HTMLDivElement>(null);

  // Defer xterm init until first show
  const [activated, setActivated] = useState(false);
  useEffect(() => {
    if (visible && !activated) setActivated(true);
  }, [visible, activated]);

  // Search bar state
  const [searchVisible, setSearchVisible] = useState(false);

  const onSearch = useCallback(() => {
    setSearchVisible((v) => !v);
  }, []);

  const activeSessionId = useTerminalSessionStore((s) => s.activeSessionId);

  const { fit, getActiveTerminal, getActiveSearchAddon, restartActiveSession } =
    useTerminalSessions(activated ? containerRef : NULL_REF, { onSearch });

  // Create a session when terminal becomes visible with none existing
  // (e.g., user closed all tabs then re-opened the panel)
  useEffect(() => {
    if (!visible) return;
    const store = useTerminalSessionStore.getState();
    if (store.sessions.length === 0) {
      store.createSession();
    }
  }, [visible]);

  // Refit when shown, resized, or position changes
  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => fit());
  }, [visible, height, width, position, fit]);

  // Track resizing state to suppress CSS transitions during drag
  const [isResizing, setIsResizing] = useState(false);

  const direction = position === "right" ? "horizontal" : "vertical";

  const handleResize = useTerminalResize(direction, () => {
    if (!isResizing) setIsResizing(true);
    requestAnimationFrame(() => fit());
  });

  // Wrap handleResize to manage resizing state
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      setIsResizing(true);

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mouseup", handleMouseUp);
      };
      document.addEventListener("mouseup", handleMouseUp);

      handleResize(e);
    },
    [handleResize]
  );

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Tab bar actions
  const handleClose = useCallback(() => {
    const store = useTerminalSessionStore.getState();
    if (!store.activeSessionId) return;

    const isLast = store.sessions.length <= 1;
    store.removeSession(store.activeSessionId);

    // Last session — also hide the panel
    if (isLast) {
      useUIStore.getState().toggleTerminal();
    }
  }, []);

  const handleRestart = useCallback(() => {
    restartActiveSession();
  }, [restartActiveSession]);

  // Not yet activated — render nothing
  if (!activated) return null;

  const active = getActiveTerminal();
  const isRight = position === "right";

  const panelStyle: React.CSSProperties = isRight
    ? { width, display: visible ? "flex" : "none" }
    : { height, display: visible ? "flex" : "none" };

  const panelClassName = [
    "terminal-panel",
    isRight ? "terminal-panel--right" : "terminal-panel--bottom",
    isResizing && "terminal-resizing",
  ]
    .filter(Boolean)
    .join(" ");

  const handleClassName = isRight
    ? "terminal-resize-handle--vertical"
    : "terminal-resize-handle--horizontal";

  return (
    <div className={panelClassName} style={panelStyle}>
      <div className={handleClassName} onMouseDown={handleResizeStart} />
      <div className="terminal-body">
        <div className="terminal-sessions-container">
          <div
            ref={containerRef}
            className="terminal-container"
            onContextMenu={handleContextMenu}
          />
          {searchVisible && (
            <TerminalSearchBar
              // Reset search state when switching terminal sessions so stale highlights are cleared.
              key={activeSessionId}
              getSearchAddon={getActiveSearchAddon}
              onClose={() => setSearchVisible(false)}
            />
          )}
        </div>
        <TerminalTabBar onClose={handleClose} onRestart={handleRestart} />
      </div>
      {contextMenu && active && (
        <TerminalContextMenu
          position={contextMenu}
          term={active.term}
          ptyRef={active.ptyRef}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
