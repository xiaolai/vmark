/**
 * Sidebar Component
 *
 * Navigation sidebar with Files, Outline, and History views.
 */

import { useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FolderTree, TableOfContents, History, FilePlus, FolderPlus, PanelLeftClose, Trash2, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { deleteDocumentHistory } from "@/hooks/useHistoryRecovery";
import { emitHistoryCleared } from "@/utils/historyTypes";
import { useUIStore, type SidebarViewMode } from "@/stores/uiStore";
import { useShortcutsStore, formatKeyForDisplay } from "@/stores/settingsStore";
import { tooltipWithShortcut } from "@/utils/tooltipWithShortcut";
import { useDocumentFilePath } from "@/hooks/useDocumentState";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { OutlineView } from "./OutlineView";
import { HistoryView } from "./HistoryView";
import "./Sidebar.css";
import { useSidebarContext } from "@/hooks/useSidebarContext";
import { BrowserHistoryView } from "@/components/Browser/BrowserHistoryView";
import { BookmarksView } from "@/components/Browser/BookmarksView";
import { BrowserGrantsList } from "@/components/Browser/BrowserGrantsList";
import { BrowserSessionsList } from "@/components/Browser/BrowserSessionsList";
import type { BrowserSidebarView } from "@/stores/uiStore/types";

// Constants
const TRAFFIC_LIGHTS_SPACER_PX = 28;

// View mode configuration - single source of truth (icon and next only; titles come from t())
/** The browser kind's own cycle. Its views are a separate union from the document ones,
 *  so it needs its own ring — reusing VIEW_CONFIG is what caused the bug. */
const BROWSER_VIEW_NEXT: Record<BrowserSidebarView, BrowserSidebarView> = {
  "browser-history": "bookmarks",
  bookmarks: "permissions",
  permissions: "browser-history",
};

const VIEW_CONFIG: Record<SidebarViewMode, {
  icon: typeof FolderTree;
  next: SidebarViewMode;
}> = {
  files: { icon: FolderTree, next: "outline" },
  outline: { icon: TableOfContents, next: "history" },
  history: { icon: History, next: "files" },
};

/** Navigation sidebar with switchable Files, Outline, and History views. */
export function Sidebar() {
  const { t } = useTranslation("sidebar");
  const sidebarShortcut = useShortcutsStore((state) => state.getShortcut("toggleSidebar"));
  const newFileShortcut = useShortcutsStore((state) => state.getShortcut("newFile"));
  const viewMode = useUIStore((state) => state.sidebarViewMode);
  const sidebar = useSidebarContext();
  // WI-2.3 — bind aria-expanded on the close-sidebar button to live state
  // instead of hardcoding `true`. The button only renders when the sidebar
  // is open, but binding to the store keeps maintainers honest if rendering
  // conditions change.
  const sidebarVisible = useUIStore((state) => state.sidebarVisible);
  const filePath = useDocumentFilePath();
  const fileExplorerRef = useRef<FileExplorerHandle>(null);
  const isClearingRef = useRef(false);
  const config = VIEW_CONFIG[viewMode];
  const Icon = config.icon;

  // Map view mode to translation keys
  const viewTitleKey: Record<SidebarViewMode, string> = {
    files: "viewFiles",
    outline: "viewOutline",
    history: "viewHistory",
  };
  const showNextKey: Record<SidebarViewMode, string> = {
    files: "showFiles",
    outline: "showOutline",
    history: "showHistory",
  };

  const currentTitle = t(viewTitleKey[viewMode]);
  const nextShowLabel = t(showNextKey[config.next]);

  const handleClearDocumentHistory = useCallback(async () => {
    if (!filePath || isClearingRef.current) return;
    isClearingRef.current = true;
    try {
      const confirmed = await ask(
        t("clearHistoryMessage"),
        { title: t("clearDocumentHistory"), kind: "warning" }
      );
      if (confirmed) {
        await deleteDocumentHistory(filePath);
        emitHistoryCleared();
      }
    } finally {
      isClearingRef.current = false;
    }
  }, [filePath, t]);

  // Cycle within the ACTIVE KIND's views (WI-S2.1). This used to always advance the
  // DOCUMENT view: with a browser tab open, the button silently rewrote the remembered
  // document sub-view (so returning to a document landed you somewhere you never chose)
  // and could never reach bookmarks at all. (Audit finding, High.)
  const handleToggleView = () => {
    if (sidebar.kind === "browser") {
      sidebar.setView(BROWSER_VIEW_NEXT[sidebar.view as BrowserSidebarView]);
      return;
    }
    const { sidebarViewMode, setSidebarViewMode } = useUIStore.getState();
    setSidebarViewMode(VIEW_CONFIG[sidebarViewMode].next);
  };

  return (
    <div className="sidebar" style={{ width: "100%", height: "100%" }}>
      {/* Spacer for traffic lights area */}
      <div style={{ height: TRAFFIC_LIGHTS_SPACER_PX, flexShrink: 0, padding: 0, margin: 0 }} />
      <div className="sidebar-header">
        <button
          className="sidebar-btn"
          onClick={handleToggleView}
          title={nextShowLabel}
          aria-label={nextShowLabel}
        >
          <Icon size={16} />
        </button>
        <span className="sidebar-title">{currentTitle}</span>
        {/* Action buttons - files view */}
        {viewMode === "files" && (
          <div className="sidebar-header-actions">
            <button
              className="sidebar-btn"
              onClick={() => fileExplorerRef.current?.expandAll()}
              title={t("expandAllFolders")}
              aria-label={t("expandAllFolders")}
            >
              <ChevronsUpDown size={14} />
            </button>
            <button
              className="sidebar-btn"
              onClick={() => fileExplorerRef.current?.collapseAll()}
              title={t("collapseAllFolders")}
              aria-label={t("collapseAllFolders")}
            >
              <ChevronsDownUp size={14} />
            </button>
            <button
              className="sidebar-btn"
              onClick={() => fileExplorerRef.current?.createNewFile()}
              title={tooltipWithShortcut(t("newFile"), formatKeyForDisplay(newFileShortcut))}
              aria-label={tooltipWithShortcut(t("newFile"), formatKeyForDisplay(newFileShortcut))}
            >
              <FilePlus size={14} />
            </button>
            <button
              className="sidebar-btn"
              onClick={() => fileExplorerRef.current?.createNewFolder()}
              title={t("newFolder")}
              aria-label={t("newFolder")}
            >
              <FolderPlus size={14} />
            </button>
          </div>
        )}
        {/* Action buttons - history view */}
        {viewMode === "history" && filePath && (
          <div className="sidebar-header-actions">
            <button
              className="sidebar-btn"
              onClick={handleClearDocumentHistory}
              title={t("clearDocumentHistory")}
              aria-label={t("clearDocumentHistory")}
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="sidebar-content">
        {/* The sidebar follows the active tab's KIND (ADR-2, WI-S2.1): a browser tab gets
            browser views, a document tab gets file views, and neither needs a manual
            switch. Each kind remembers its own sub-view, so glancing at a browser and
            coming back does not cost you the file tree you had open (WI-S2.3). */}
        {sidebar.kind === "browser" ? (
          <>
            {sidebar.view === "browser-history" && <BrowserHistoryView />}
            {sidebar.view === "bookmarks" && <BookmarksView />}
            {/* Site permissions live HERE, in the document window, not in Settings.
                Settings opens as a separate Tauri window with its own JS context and
                therefore its own Zustand store — the grants list rendered there read an
                empty array and its Revoke button mutated a store nobody was listening to.
                A permission model whose revocation silently does nothing is worse than
                none, because it tells you that you revoked. (Audit finding, High.) */}
            {sidebar.view === "permissions" && (
              <>
                <BrowserGrantsList />
                {/* Saved sessions + named profiles live alongside site permissions —
                    both are AI browser authority the user manages here (WI-P6.4/P6.5). */}
                <BrowserSessionsList />
              </>
            )}
          </>
        ) : (
          <>
            {viewMode === "files" && <FileExplorer ref={fileExplorerRef} currentFilePath={filePath} />}
            {viewMode === "outline" && <OutlineView />}
            {viewMode === "history" && <HistoryView />}
          </>
        )}
      </div>

      <div className="sidebar-footer">
        <button
          className="sidebar-btn"
          onClick={() => useUIStore.getState().toggleSidebar()}
          title={tooltipWithShortcut(t("closeSidebar"), formatKeyForDisplay(sidebarShortcut))}
          aria-label={tooltipWithShortcut(t("closeSidebar"), formatKeyForDisplay(sidebarShortcut))}
          aria-expanded={sidebarVisible}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>
    </div>
  );
}
