import { Component, lazy, Suspense, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { CheckCircle, XCircle, Info, AlertTriangle, Loader2 } from "lucide-react";
import { Editor } from "@/components/Editor";
import { Sidebar } from "@/components/Sidebar";
import { StatusBar } from "@/components/StatusBar";
import { FindBar } from "@/components/FindBar";
import { TitleBar } from "@/components/TitleBar";
import { UniversalToolbar } from "@/components/Editor/UniversalToolbar";
import { TerminalPanel } from "@/components/Terminal";

// Lazy-load page routes so non-document windows don't evaluate stores they don't need.
// SettingsPage → aiProviderStore (credentials); must not evaluate in pdf-export window.
const SettingsPage = lazy(() => import("@/pages/Settings").then(m => ({ default: m.SettingsPage })));
const PdfExportPage = lazy(() => import("@/pages/PdfExportPage").then(m => ({ default: m.PdfExportPage })));
import { WindowProvider, useIsDocumentWindow, useWindowLabel } from "@/contexts/WindowContext";
import { appError } from "@/utils/debug";

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
    appError("Caught error:", error);
    appError("Error info:", errorInfo);
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
import { useMenuEvents } from "@/hooks/useMenuEvents";
import { useViewMenuEvents } from "@/hooks/useViewMenuEvents";
import { useRecentFilesMenuEvents } from "@/hooks/useRecentFilesMenuEvents";
import { useExportMenuEvents } from "@/hooks/useExportMenuEvents";
import { useWorkspaceMenuEvents } from "@/hooks/useWorkspaceMenuEvents";
import { useWorkspaceBootstrap } from "@/hooks/useWorkspaceBootstrap";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useSearchCommands } from "@/hooks/useSearchCommands";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useTheme } from "@/hooks/useTheme";
import { useSettingsSync } from "@/hooks/useSettingsSync";
import { useConfirmQuitSync } from "@/hooks/useConfirmQuitSync";
import { useRecentFilesSync } from "@/hooks/useRecentFilesSync";
import { useRecentWorkspacesSync } from "@/hooks/useRecentWorkspacesSync";
import { useRecentWorkspacesMenuEvents } from "@/hooks/useRecentWorkspacesMenuEvents";
import { useWindowClose } from "@/hooks/useWindowClose";
import { useWindowTitle } from "@/hooks/useWindowTitle";
import { useDisableContextMenu } from "@/hooks/useDisableContextMenu";
import { useViewShortcuts } from "@/hooks/useViewShortcuts";
import { useTabShortcuts } from "@/hooks/useTabShortcuts";
import { useReloadGuard } from "@/hooks/useReloadGuard";
import { useDragDropOpen } from "@/hooks/useDragDropOpen";
import { useExternalFileChanges } from "@/hooks/useExternalFileChanges";
import { useWindowFileWatcher } from "@/hooks/useWindowFileWatcher";
import { useSidebarResize } from "@/hooks/useSidebarResize";
import { useUniversalToolbar } from "@/hooks/useUniversalToolbar";
import { useMcpAutoStart } from "@/hooks/useMcpAutoStart";
import { useMcpBridge } from "@/hooks/useMcpBridge";
import { useFileExplorerShortcuts } from "@/hooks/useFileExplorerShortcuts";
import { useImagePasteToast } from "@/hooks/useImagePasteToast";
import { useUpdateChecker } from "@/hooks/useUpdateChecker";
import { useUpdateBroadcast } from "@/hooks/useUpdateSync";
import { useFinderFileOpen } from "@/hooks/useFinderFileOpen";
import { useHotExitCapture } from "@/utils/hotExit/useHotExitCapture";
import { useHotExitRestore } from "@/utils/hotExit/useHotExitRestore";
import { useHotExitStartup } from "@/utils/hotExit/useHotExitStartup";
import { useGenieShortcuts } from "@/hooks/useGenieShortcuts";
import { useTerminalPosition } from "@/components/Terminal/useTerminalPosition";
import { useCrashRecoveryWriter } from "@/hooks/useCrashRecoveryWriter";
import { useCrashRecoveryStartup } from "@/hooks/useCrashRecoveryStartup";
import { useCrashRecoveryCleanup } from "@/hooks/useCrashRecoveryCleanup";
import { GeniePicker } from "@/components/GeniePicker/GeniePicker";
import { QuickOpen } from "@/components/QuickOpen/QuickOpen";
import { useQuickOpenShortcuts } from "@/hooks/useQuickOpenShortcuts";
import { ContentSearch } from "@/components/ContentSearch/ContentSearch";
import { useContentSearchShortcuts } from "@/components/ContentSearch/useContentSearchShortcuts";

/** Height of the title bar area in pixels */
const TITLEBAR_HEIGHT = 40;

/** Drop zone indicator when dragging markdown files */
function DropOverlay() {
  const isDragging = useUIStore((state) => state.isDraggingFiles);
  if (!isDragging) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "var(--accent-bg)",
        border: "3px dashed var(--accent-primary)",
        borderRadius: "var(--radius-lg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9998,
        pointerEvents: "none",
        margin: 8,
      }}
    >
      <div
        style={{
          padding: "16px 24px",
          backgroundColor: "var(--bg-color)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--popup-shadow)",
          color: "var(--text-color)",
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        Drop to open
      </div>
    </div>
  );
}

// Separate component for window lifecycle hooks to avoid conditional hook calls
function DocumentWindowHooks() {
  useWindowClose();
  useWindowTitle();
  useDragDropOpen(); // Open dropped markdown files
  useWindowFileWatcher(); // Start file watcher for this window
  useExternalFileChanges(); // Handle external file changes (auto-reload or prompt)
  useHotExitCapture(); // Respond to hot exit capture requests
  useHotExitRestore(); // Handle hot exit restore on restart
  useCrashRecoveryWriter(); // Periodically snapshot dirty docs for crash recovery
  useCrashRecoveryCleanup(); // Clean up recovery files on save/close/exit
  return null;
}

// Wrapper so useGenieShortcuts can be called conditionally via mount/unmount
function GenieShortcutsRunner() {
  useGenieShortcuts();
  return null;
}

function QuickOpenShortcutsRunner() {
  useQuickOpenShortcuts();
  return null;
}

function ContentSearchShortcutsRunner() {
  useContentSearchShortcuts();
  return null;
}

// Main window specific hooks (only for "main" window, not doc-*)
function MainWindowHooks() {
  useMcpAutoStart(); // Auto-start MCP server if enabled
  useMcpBridge(); // Handle MCP bridge requests from AI assistants
  useUpdateChecker(); // Check for updates on startup
  useUpdateBroadcast(); // Broadcast update state to other windows
  useHotExitStartup(); // Check for saved session and restore if present (MUST run before Finder)
  useCrashRecoveryStartup(); // Restore docs from crash recovery (waits for hot exit)
  useFinderFileOpen(); // Handle files opened from Finder (waits for hot exit to complete)
  return null;
}

function MainLayout() {
  const { t } = useTranslation();
  const focusModeEnabled = useEditorStore((state) => state.focusModeEnabled);
  const typewriterModeEnabled = useEditorStore(
    (state) => state.typewriterModeEnabled
  );
  const sidebarVisible = useUIStore((state) => state.sidebarVisible);
  const sidebarWidth = useUIStore((state) => state.sidebarWidth);
  const findBarOpen = useSearchStore((state) => state.isOpen);
  const isDocumentWindow = useIsDocumentWindow();
  const windowLabel = useWindowLabel();
  const handleResizeStart = useSidebarResize();
  const sidebarOffset = sidebarVisible ? `${sidebarWidth}px` : "0px";

  // Initialize hooks
  useWorkspaceBootstrap(); // Load config from disk on startup (must be first)
  useMenuEvents();
  useViewMenuEvents();
  useRecentFilesMenuEvents();
  useExportMenuEvents();
  useWorkspaceMenuEvents();
  useFileOperations();
  useSearchCommands();
  useSettingsSync(); // Sync settings across windows
  useConfirmQuitSync(); // Push confirmQuit setting to Rust
  useTheme();
  useAutoSave(); // Auto-save when dirty
  useRecentFilesSync(); // Sync recent files to native menu
  useRecentWorkspacesSync(); // Sync recent workspaces to native menu
  useRecentWorkspacesMenuEvents(); // Handle recent workspace menu events
  useDisableContextMenu(); // Disable browser context menu
  useViewShortcuts(); // F8, F9 view shortcuts
  useTabShortcuts(); // Cmd+T, Cmd+W tab shortcuts
  useReloadGuard(); // Prevent reload when dirty
  useUniversalToolbar(); // Universal toolbar toggle (shortcut configurable)
  useFileExplorerShortcuts(); // Toggle hidden files
  useImagePasteToast(); // Image paste confirmation toast
  useTerminalPosition(); // Auto-reposition terminal panel based on window shape

  const terminalPosition = useUIStore((state) => state.effectiveTerminalPosition);

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
        backgroundColor: "var(--bg-color)",
        ["--sidebar-offset" as string]: sidebarOffset,
      }}
    >
      {/* Window lifecycle hooks for document windows */}
      {isDocumentWindow && <DocumentWindowHooks />}
      {/* Main window specific hooks */}
      {windowLabel === "main" && <MainWindowHooks />}
      {/* AI Genies hooks */}
      <GenieShortcutsRunner />
      <QuickOpenShortcutsRunner />
      <ContentSearchShortcutsRunner />

      {/* Drop zone indicator for drag-and-drop */}
      <DropOverlay />
      <QuickOpen windowLabel={windowLabel} />
      <ContentSearch windowLabel={windowLabel} />
      <GeniePicker />

      {/* Title bar with drag region and filename display */}
      <TitleBar />

      {sidebarVisible && (
        <aside
          aria-label={t("aria.sidebar")}
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
        {/* Editor + Terminal container with dynamic flex direction */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: terminalPosition === "right" ? "row" : "column",
            minHeight: 0,
            minWidth: 0,
          }}
        >
          {/* Editor column: editor + bottom bars */}
          <div role="main" aria-label={t("aria.mainContent")} style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
            {/* Editor area */}
            <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
              <Editor />
            </div>
            {/* Bottom bar container - fixed 40px height, all bars overlay within */}
            <div style={{ position: "relative", height: 40, flexShrink: 0 }}>
              <StatusBar />
              <UniversalToolbar />
              <FindBar />
            </div>
          </div>
          {/* Terminal panel */}
          <TerminalPanel />
        </div>
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
          <Route path="/settings" element={<Suspense fallback={null}><SettingsPage /></Suspense>} />
          <Route path="/pdf-export" element={<Suspense fallback={null}><PdfExportPage /></Suspense>} />
        </Routes>
        <Toaster
          position="top-center"
          icons={{
            success: <CheckCircle size={16} />,
            error: <XCircle size={16} />,
            info: <Info size={16} />,
            warning: <AlertTriangle size={16} />,
            loading: <Loader2 size={16} className="animate-spin" />,
          }}
        />
      </WindowProvider>
    </ErrorBoundary>
  );
}

export default App;
