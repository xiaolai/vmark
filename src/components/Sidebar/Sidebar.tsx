/**
 * Sidebar Component
 *
 * Navigation sidebar with Files, Outline, and History views.
 */

import { useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FolderTree, TableOfContents, History, FilePlus, FolderPlus, PanelLeftClose, Trash2 } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { deleteDocumentHistory } from "@/hooks/useHistoryRecovery";
import { emitHistoryCleared } from "@/utils/historyTypes";
import { useUIStore, type SidebarViewMode } from "@/stores/uiStore";
import { useDocumentFilePath } from "@/hooks/useDocumentState";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { OutlineView } from "./OutlineView";
import { HistoryView } from "./HistoryView";
import "./Sidebar.css";

// Constants
const TRAFFIC_LIGHTS_SPACER_PX = 28;

// View mode configuration - single source of truth (icon and next only; titles come from t())
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
  const viewMode = useUIStore((state) => state.sidebarViewMode);
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

  const handleToggleView = () => {
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
              onClick={() => fileExplorerRef.current?.createNewFile()}
              title={t("newFile")}
              aria-label={t("newFile")}
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
        {viewMode === "files" && <FileExplorer ref={fileExplorerRef} currentFilePath={filePath} />}
        {viewMode === "outline" && <OutlineView />}
        {viewMode === "history" && <HistoryView />}
      </div>

      <div className="sidebar-footer">
        <button
          className="sidebar-btn"
          onClick={() => useUIStore.getState().toggleSidebar()}
          title={t("closeSidebar")}
          aria-label={t("closeSidebar")}
          aria-expanded={true}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>
    </div>
  );
}

export default Sidebar;
