/**
 * TerminalPanel
 *
 * Purpose: Container for the integrated terminal — sits on any side of the
 * editor (top/bottom/left/right, based on effectiveTerminalPosition) with a
 * drag-to-resize handle on the editor-adjacent edge. Hosts multiple terminal
 * sessions via useTerminalSessions, a search
 * bar, a tab bar (vertical for a top/bottom panel, horizontal for left/right),
 * and a context menu.
 *
 * User interactions:
 *   - Drag the resize handle to adjust panel height (top/bottom) or width (left/right)
 *   - Double-click the resize handle to maximize the panel and back (WI-4.5)
 *   - Right-click for copy / paste / select-all / clear / reset-display /
 *     copy-command-output menu (the last needs shell integration)
 *   - Use the tab bar to create/switch/close sessions and swap the panel side
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
 *     dimensions in sync, and again from a ResizeObserver on the container so
 *     transition frames and cross-axis window resizes are not missed.
 *   - Adds .terminal-resizing class during drag to suppress CSS transitions.
 *
 * @coordinates-with useTerminalSessions.ts — manages xterm + PTY lifecycle
 * @coordinates-with useTerminalResize.ts — vertical/horizontal drag handle
 * @coordinates-with useTerminalAutoFit.ts — container-box observer that refits xterm
 * @coordinates-with useTerminalPosition.ts — auto-repositioning algorithm
 * @coordinates-with TerminalTabBar.tsx — session switching and management
 * @coordinates-with TerminalSearchBar.tsx — inline search within terminal output
 * @coordinates-with TerminalContextMenu.tsx — right-click copy/paste/clear/reset-display menu
 * @module components/Terminal/TerminalPanel
 */
import { useRef, useEffect, useState, useCallback, type RefObject, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";
import { useTerminalSessions } from "./useTerminalSessions";
import { useTerminalResize } from "./useTerminalResize";
import { useTerminalAutoFit } from "./useTerminalAutoFit";
import { isHorizontalTerminalAxis } from "./useTerminalPosition";
import { TerminalTabBar } from "./TerminalTabBar";
import { TerminalContextMenu } from "./TerminalContextMenu";
import { TerminalSearchBar } from "./TerminalSearchBar";
import { resolveBufferLineFromEvent } from "./resolveBufferLine";
import "./terminal-panel.css";

const NULL_REF: RefObject<HTMLDivElement | null> = { current: null };

/** Container for the integrated terminal with resize handle, tab bar, search bar, and context menu. */
export function TerminalPanel() {
  const { t } = useTranslation("statusbar");
  const visible = useUIStore((s) => s.terminalVisible);
  const height = useUIStore((s) => s.terminalHeight);
  const width = useUIStore((s) => s.terminalWidth);
  const position = useUIStore((s) => s.effectiveTerminalPosition);
  const containerRef = useRef<HTMLDivElement>(null);

  // Defer xterm init until first show — latch once visible. Adjusted during
  // render (a one-way latch that converges immediately) rather than in an effect,
  // avoiding an extra render before xterm mounts (#1063).
  const [activated, setActivated] = useState(false);
  if (visible && !activated) setActivated(true);

  // Search bar state
  const [searchVisible, setSearchVisible] = useState(false);

  const onSearch = useCallback(() => {
    setSearchVisible((v) => !v);
  }, []);

  const activeSessionId = useUIStore((s) => s.terminal.activeSessionId);

  const { fit, getActiveTerminal, getActiveSearchAddon, restartActiveSession } =
    useTerminalSessions(activated ? containerRef : NULL_REF, { onSearch });

  // Create a session when terminal becomes visible with none existing
  // (e.g., user closed all tabs then re-opened the panel)
  useEffect(() => {
    if (!visible) return;
    const store = useUIStore.getState();
    if (store.terminal.sessions.length === 0) {
      store.terminalCreateSession();
    }
  }, [visible]);

  // Refit when shown, resized, or position changes
  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => fit());
  }, [visible, height, width, position, fit]);

  // …and whenever the container's box actually changes. The effect above fires
  // on the state change, one frame *before* the CSS width/height transition has
  // played out, and it never sees a cross-axis change (a right panel's width is
  // untouched by a window height resize). The observer covers both.
  useTerminalAutoFit(containerRef, fit, activated);

  // Track resizing state to suppress CSS transitions during drag
  const [isResizing, setIsResizing] = useState(false);
  const resizeCleanupRef: MutableRefObject<(() => void) | null> = useRef(null);

  // `onResize` fires during a DRAG only — a maximize writes the store
  // dimension and lets the width/height effect above refit, so calling it
  // there too would schedule the same fit twice. It must therefore mean
  // "geometry changed — refit", never "a drag is in progress": setting drag
  // state here would leave `terminal-resizing` stuck.
  const { handleResizeStart: handleResize, toggleMaximize } = useTerminalResize(
    position,
    () => requestAnimationFrame(() => fit()),
  );

  // Double-clicking the handle maximizes the panel to its cap and back
  // (WI-4.5/F6) — the honest answer to "I wanted 80%", which the persisted
  // ratio deliberately cannot give.
  const handleHandleDoubleClick = useCallback(() => {
    toggleMaximize();
  }, [toggleMaximize]);

  // Wrap handleResize to manage resizing state with proper cleanup
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      // Drag state is owned here (it only suppresses CSS transitions); the
      // hook owns the geometry.
      setIsResizing(true);

      const cleanupResize = () => {
        setIsResizing(false);
        document.removeEventListener("mouseup", cleanupResize);
        window.removeEventListener("blur", cleanupResize);
        resizeCleanupRef.current = null;
      };
      document.addEventListener("mouseup", cleanupResize);
      window.addEventListener("blur", cleanupResize);
      resizeCleanupRef.current = cleanupResize;

      handleResize(e);
    },
    [handleResize]
  );

  // Unmount cleanup for resize wrapper listener
  useEffect(() => {
    return () => resizeCleanupRef.current?.();
  }, []);

  // Context menu state. `line` is the buffer row under the pointer, used by
  // "Copy Command Output" to pick which command's output to copy (WI-4.4).
  const [contextMenu, setContextMenu] = useState<
    { x: number; y: number; line?: number } | null
  >(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        line: resolveBufferLineFromEvent(getActiveTerminal()?.term, e),
      });
    },
    [getActiveTerminal],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Tab bar actions
  const handleClose = useCallback(() => {
    const store = useUIStore.getState();
    if (!store.terminal.activeSessionId) return;

    const isLast = store.terminal.sessions.length <= 1;
    store.terminalRemoveSession(store.terminal.activeSessionId);

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
  const isHorizontal = isHorizontalTerminalAxis(position);

  const panelStyle: React.CSSProperties = isHorizontal
    ? { width, display: visible ? "flex" : "none" }
    : { height, display: visible ? "flex" : "none" };

  const panelClassName = [
    "terminal-panel",
    `terminal-panel--${position}`,
    isResizing && "terminal-resizing",
  ]
    .filter(Boolean)
    .join(" ");

  const handleClassName = isHorizontal
    ? "terminal-resize-handle--vertical"
    : "terminal-resize-handle--horizontal";

  return (
    <div className={panelClassName} style={panelStyle} role="region" aria-label={t("terminal.ariaLabel")}>
      <div
        className={handleClassName}
        onMouseDown={handleResizeStart}
        onDoubleClick={handleHandleDoubleClick}
        title={t("terminal.maximizeHint")}
      />
      <div className={`terminal-body ${isHorizontal ? "terminal-body--column" : ""}`}>
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
        <TerminalTabBar
          onClose={handleClose}
          onRestart={handleRestart}
          orientation={isHorizontal ? "horizontal" : "vertical"}
          position={position}
        />
      </div>
      {contextMenu && active && (
        <TerminalContextMenu
          position={contextMenu}
          term={active.term}
          onResetDisplay={active.resetDisplay}
          getCommands={active.getCommands}
          clickLine={contextMenu.line}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
