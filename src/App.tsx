import { Component, type ReactNode } from "react";
import { Routes, Route } from "react-router-dom";
import { Editor } from "@/components/Editor";
import { Sidebar } from "@/components/Sidebar";
import { StatusBar } from "@/components/StatusBar";
import { FindBar } from "@/components/FindBar";
import { TitleBar } from "@/components/TitleBar";
import { UniversalToolbar } from "@/components/Editor/UniversalToolbar";
import { TerminalPanel } from "@/components/Terminal";
import { SettingsPage } from "@/pages/Settings";
import { PrintPreviewPage } from "@/pages/PrintPreview";
import { WindowProvider, useIsDocumentWindow, useWindowLabel } from "@/contexts/WindowContext";

// Error Boundary to catch and display React errors
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error);
    console.error("[ErrorBoundary] Error info:", errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, fontFamily: "system-ui, sans-serif" }}>
          <h1 style={{ color: "#dc2626", marginBottom: 16 }}>Something went wrong</h1>
          <pre style={{
            padding: 16,
            background: "#fef2f2",
            borderRadius: 8,
            overflow: "auto",
            fontSize: 14,
          }}>
            {this.state.error?.message}
            {"\n\n"}
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { useSearchStore } from "@/stores/searchStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTerminalStore } from "@/stores/terminalStore";
import { useMenuEvents } from "@/hooks/useMenuEvents";
import { useExportMenuEvents } from "@/hooks/useExportMenuEvents";
import { useWorkspaceMenuEvents } from "@/hooks/useWorkspaceMenuEvents";
import { useWorkspaceBootstrap } from "@/hooks/useWorkspaceBootstrap";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useSearchCommands } from "@/hooks/useSearchCommands";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useTheme } from "@/hooks/useTheme";
import { useSettingsSync } from "@/hooks/useSettingsSync";
import { useRecentFilesSync } from "@/hooks/useRecentFilesSync";
import { useWindowClose } from "@/hooks/useWindowClose";
import { useWindowTitle } from "@/hooks/useWindowTitle";
import { useDisableContextMenu } from "@/hooks/useDisableContextMenu";
import { useViewShortcuts } from "@/hooks/useViewShortcuts";
import { useTabShortcuts } from "@/hooks/useTabShortcuts";
import { useReloadGuard } from "@/hooks/useReloadGuard";
import { useDragDropOpen } from "@/hooks/useDragDropOpen";
import { useExternalFileChanges } from "@/hooks/useExternalFileChanges";
import { useSidebarResize } from "@/hooks/useSidebarResize";
import { useUniversalToolbar } from "@/hooks/useUniversalToolbar";
import { useMcpAutoStart } from "@/hooks/useMcpAutoStart";
import { useMcpBridge } from "@/hooks/useMcpBridge";
import { useFileExplorerShortcuts } from "@/hooks/useFileExplorerShortcuts";

/** Height of the title bar area in pixels */
const TITLEBAR_HEIGHT = 40;

// Separate component for window lifecycle hooks to avoid conditional hook calls
function DocumentWindowHooks() {
  useWindowClose();
  useWindowTitle();
  useDragDropOpen(); // Open dropped markdown files
  useExternalFileChanges(); // Handle external file changes (auto-reload or prompt)
  return null;
}

// Main window specific hooks (only for "main" window, not doc-*)
function MainWindowHooks() {
  useMcpAutoStart(); // Auto-start MCP server if enabled
  useMcpBridge(); // Handle MCP bridge requests from AI assistants
  return null;
}

function MainLayout() {
  const focusModeEnabled = useEditorStore((state) => state.focusModeEnabled);
  const typewriterModeEnabled = useEditorStore(
    (state) => state.typewriterModeEnabled
  );
  const sidebarVisible = useUIStore((state) => state.sidebarVisible);
  const sidebarWidth = useUIStore((state) => state.sidebarWidth);
  const findBarOpen = useSearchStore((state) => state.isOpen);
  const terminalPosition = useSettingsStore((state) => state.terminal.position);
  const terminalVisible = useTerminalStore((state) => state.visible);
  const isDocumentWindow = useIsDocumentWindow();
  const windowLabel = useWindowLabel();
  const handleResizeStart = useSidebarResize();
  const sidebarOffset = sidebarVisible ? `${sidebarWidth}px` : "0px";
  const isTerminalRight = terminalPosition === "right" && terminalVisible;

  // Initialize hooks
  useWorkspaceBootstrap(); // Load config from disk on startup (must be first)
  useMenuEvents();
  useExportMenuEvents();
  useWorkspaceMenuEvents();
  useFileOperations();
  useSearchCommands();
  useSettingsSync(); // Sync settings across windows
  useTheme();
  useAutoSave(); // Auto-save when dirty
  useRecentFilesSync(); // Sync recent files to native menu
  useDisableContextMenu(); // Disable browser context menu
  useViewShortcuts(); // F7, F8, F9 shortcuts
  useTabShortcuts(); // Cmd+T, Cmd+W tab shortcuts
  useReloadGuard(); // Prevent reload when dirty
  useUniversalToolbar(); // Universal toolbar toggle (shortcut configurable)
  useFileExplorerShortcuts(); // Toggle hidden files

  const classNames = [
    "app-layout",
    focusModeEnabled && "focus-mode",
    typewriterModeEnabled && "typewriter-mode",
    findBarOpen && "find-bar-open",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classNames}
      style={{
        display: "flex",
        height: "100vh",
        overflow: "clip",
        position: "relative",
        ["--sidebar-offset" as string]: sidebarOffset,
      }}
    >
      {/* Window lifecycle hooks for document windows */}
      {isDocumentWindow && <DocumentWindowHooks />}
      {/* Main window specific hooks */}
      {windowLabel === "main" && <MainWindowHooks />}

      {/* Title bar with drag region and filename display */}
      <TitleBar />

      {sidebarVisible && (
        <aside
          style={{
            width: sidebarWidth,
            minWidth: sidebarWidth,
            height: "100%",
            flexShrink: 0,
            position: "relative",
          }}
        >
          <Sidebar />
          {/* Resize handle - positioned at right edge of sidebar */}
          <div
            className="sidebar-resize-handle"
            onMouseDown={handleResizeStart}
          />
        </aside>
      )}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "clip",
          minWidth: 0, // Prevent flex child from expanding beyond parent
        }}
      >
        {/* Spacer for title bar area */}
        <div style={{ height: TITLEBAR_HEIGHT, flexShrink: 0 }} />
        {/* Main content area - flex row when terminal is on right */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            marginBottom: TITLEBAR_HEIGHT,
            display: "flex",
            flexDirection: isTerminalRight ? "row" : "column",
          }}
        >
          {/* Editor + bottom bars container */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Editor area */}
            <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
              <Editor />
            </div>
            {/* Bottom bar container - StatusBar always present, FindBar/Toolbar overlay it */}
            <div style={{ position: "relative", flexShrink: 0 }}>
              <StatusBar />
              <UniversalToolbar />
              <FindBar />
            </div>
          </div>
          {/* Terminal panel - on right side when isTerminalRight, otherwise below in column */}
          {isTerminalRight && <TerminalPanel />}
        </div>
        {/* Terminal at bottom (outside the row layout) */}
        {!isTerminalRight && <TerminalPanel />}
      </div>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <WindowProvider>
        <Routes>
          <Route path="/" element={<MainLayout />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/print-preview" element={<PrintPreviewPage />} />
        </Routes>
      </WindowProvider>
    </ErrorBoundary>
  );
}

export default App;
