/**
 * Sidebar Component
 *
 * Navigation sidebar with Files, Outline, and History views.
 */

import { useRef, useCallback } from "react";
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

// View mode configuration - single source of truth
const VIEW_CONFIG: Record<SidebarViewMode, {
  icon: typeof FolderTree;
  title: string;
  next: SidebarViewMode;
}> = {
  files: { icon: FolderTree, title: "FILES", next: "outline" },
  outline: { icon: TableOfContents, title: "OUTLINE", next: "history" },
  history: { icon: History, title: "HISTORY", next: "files" },
};

export function Sidebar() {
  const viewMode = useUIStore((state) => state.sidebarViewMode);
  const filePath = useDocumentFilePath();
  const fileExplorerRef = useRef<FileExplorerHandle>(null);
  const isClearingRef = useRef(false);
  const config = VIEW_CONFIG[viewMode];
  const Icon = config.icon;
  const nextTitle = VIEW_CONFIG[config.next].title;

  const handleClearDocumentHistory = useCallback(async () => {
    if (!filePath || isClearingRef.current) return;
    isClearingRef.current = true;
    try {
      const confirmed = await ask(
        "Delete all history for this document? This cannot be undone.",
        { title: "Clear Document History", kind: "warning" }
      );
      if (confirmed) {
        await deleteDocumentHistory(filePath);
        emitHistoryCleared();
      }
    } finally {
      isClearingRef.current = false;
    }
  }, [filePath]);

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
          title={`Show ${nextTitle.charAt(0) + nextTitle.slice(1).toLowerCase()}`}
        >
          <Icon size={16} />
        </button>
        <span className="sidebar-title">{config.title}</span>
        {/* Action buttons - files view */}
        {viewMode === "files" && (
          <div className="sidebar-header-actions">
            <button
              className="sidebar-btn"
              onClick={() => fileExplorerRef.current?.createNewFile()}
              title="New File"
            >
              <FilePlus size={14} />
            </button>
            <button
              className="sidebar-btn"
              onClick={() => fileExplorerRef.current?.createNewFolder()}
              title="New Folder"
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
              title="Clear Document History"
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
          title="Close Sidebar"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>
    </div>
  );
}

export default Sidebar;
