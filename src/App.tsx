import { Component, lazy, Suspense, type ReactNode } from "react";
import { FeatureErrorBoundary } from "@/components/FeatureErrorBoundary";
import { useTranslation, withTranslation, type WithTranslation } from "react-i18next";
import { Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { CheckCircle, XCircle, Info, AlertTriangle, Loader2 } from "lucide-react";
import { Editor } from "@/components/Editor";
import { Sidebar } from "@/components/Sidebar";
import { SidebarResizeHandle } from "@/components/Sidebar/SidebarResizeHandle";
import { StatusBar } from "@/components/StatusBar";
import { FindBar } from "@/components/FindBar";
import { TitleBar } from "@/components/TitleBar";
import { UniversalToolbar } from "@/components/Editor/UniversalToolbar";
import { AppShell, EditorArea } from "@/shell";
import { GeniePicker } from "@/components/GeniePicker/GeniePicker";
import { ApprovalDialog } from "@/components/WorkflowApproval/ApprovalDialog";
import { QuickOpen } from "@/components/QuickOpen/QuickOpen";
import { ContentSearch } from "@/components/ContentSearch/ContentSearch";
import { CommandPalette } from "@/components/CommandPalette";
import { WindowProvider, useIsDocumentWindow, useWindowLabel } from "@/contexts/WindowContext";
import { useUIStore } from "@/stores/uiStore";
import { useTheme } from "@/hooks/useTheme";
import { useTerminalPosition } from "@/components/Terminal/useTerminalPosition";
import { useTabModeSync } from "@/hooks/useTabModeSync";
import {
  useWorkspaceLifecycle,
  useEditorLifecycle,
  DocumentWindowMount,
  MainWindowRunners,
} from "@/hooks/lifecycle";
import { cssVars } from "@/theme";
import { appError } from "@/utils/debug";

const TerminalPanel = lazy(() =>
  import("@/components/Terminal").then((m) => ({ default: m.TerminalPanel }))
);
// Lazy-load page routes so non-document windows don't evaluate stores they don't need.
// SettingsPage → aiProviderStore (credentials); must not evaluate in pdf-export window.
const SettingsPage = lazy(() => import("@/pages/Settings").then(m => ({ default: m.SettingsPage })));
const PdfExportPage = lazy(() => import("@/pages/PdfExportPage").then(m => ({ default: m.PdfExportPage })));

// Error Boundary to catch and display React errors
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundaryInner extends Component<
  { children: ReactNode } & WithTranslation<"dialog">,
  ErrorBoundaryState
> {
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
      const { t } = this.props;
      return (
        <div style={{ padding: 40, fontFamily: "system-ui, sans-serif" }}>
          <h1 style={{ color: "#dc2626", marginBottom: 16 }}>{t("errorBoundary.title")}</h1>
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

const ErrorBoundary = withTranslation("dialog")(ErrorBoundaryInner);

// ADR-014 sample migration — visual values come from the typed accessor
// in `@/theme`. Non-token literals (z-index, border width, viewport
// margins) stay literal per the ADR's "what stays literal" exemption.
const DROP_OVERLAY_BORDER_WIDTH = 3;
const DROP_OVERLAY_Z = 9998;
const DROP_OVERLAY_MARGIN = 8;
const DROP_LABEL_FONT_SIZE = 14;

function DropOverlay() {
  const { t } = useTranslation();
  const isDragging = useUIStore((state) => state.isDraggingFiles);
  if (!isDragging) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: cssVars.color.accent.bg,
        border: `${DROP_OVERLAY_BORDER_WIDTH}px dashed ${cssVars.color.accent.primary}`,
        borderRadius: cssVars.radius.lg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: DROP_OVERLAY_Z,
        pointerEvents: "none",
        margin: DROP_OVERLAY_MARGIN,
      }}
    >
      <div
        style={{
          padding: `${cssVars.space[4]} ${cssVars.space[6]}`,
          backgroundColor: cssVars.color.bg.primary,
          borderRadius: cssVars.radius.md,
          boxShadow: cssVars.shadow.popup,
          color: cssVars.color.text.primary,
          fontSize: DROP_LABEL_FONT_SIZE,
          fontWeight: 500,
        }}
      >
        {t("dropToOpen")}
      </div>
    </div>
  );
}

function MainLayout() {
  // Window context + store selectors. State reads only, not lifecycle hooks.
  const isDocumentWindow = useIsDocumentWindow();
  const windowLabel = useWindowLabel();
  const focusModeEnabled = useUIStore((state) => state.focusModeEnabled);
  const typewriterModeEnabled = useUIStore((state) => state.typewriterModeEnabled);
  const sidebarVisible = useUIStore((state) => state.sidebarVisible);
  const sidebarWidth = useUIStore((state) => state.sidebarWidth);
  const findBarOpen = useUIStore((state) => state.search.isOpen);
  const terminalPosition = useUIStore((state) => state.effectiveTerminalPosition);

  // T03 lifecycle composites — every per-document/per-window hook now
  // lives in src/hooks/lifecycle/. Adding a shortcut or sync hook
  // edits a composite, not App.tsx.
  useWorkspaceLifecycle();
  useEditorLifecycle();
  useTheme();
  useTerminalPosition();
  useTabModeSync();

  const className = [
    focusModeEnabled && "focus-mode",
    typewriterModeEnabled && "typewriter-mode",
    findBarOpen && "find-bar-open",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <AppShell
      className={className}
      chrome={<TitleBar />}
      sidebar={
        sidebarVisible ? (
          <>
            <Sidebar />
            <SidebarResizeHandle width={sidebarWidth} />
          </>
        ) : null
      }
      sidebarWidth={sidebarWidth}
      primary={
        <EditorArea
          editor={
            <FeatureErrorBoundary feature="Editor">
              <Editor />
            </FeatureErrorBoundary>
          }
          bottomBar={
            <>
              <StatusBar />
              <UniversalToolbar />
              <FindBar />
            </>
          }
          panel={
            <FeatureErrorBoundary feature="Terminal">
              <Suspense fallback={null}>
                <TerminalPanel />
              </Suspense>
            </FeatureErrorBoundary>
          }
          panelPosition={terminalPosition}
        />
      }
      overlays={
        <>
          {isDocumentWindow && <DocumentWindowMount />}
          {windowLabel === "main" && <MainWindowRunners />}

          <DropOverlay />
          <QuickOpen windowLabel={windowLabel} />
          <ContentSearch windowLabel={windowLabel} />
          <GeniePicker />
          <ApprovalDialog />
          <CommandPalette />
        </>
      }
    />
  );
}

function App() {
  return (
    <ErrorBoundary>
      <WindowProvider>
        <Routes>
          <Route path="/" element={<MainLayout />} />
          <Route
            path="/settings"
            element={
              <FeatureErrorBoundary feature="Settings">
                <Suspense fallback={null}>
                  <SettingsPage />
                </Suspense>
              </FeatureErrorBoundary>
            }
          />
          <Route
            path="/pdf-export"
            element={
              <FeatureErrorBoundary feature="PDF Export">
                <Suspense fallback={null}>
                  <PdfExportPage />
                </Suspense>
              </FeatureErrorBoundary>
            }
          />
        </Routes>
        <Toaster
          position="top-center"
          closeButton
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
