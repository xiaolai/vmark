/**
 * Sidebar Component
 *
 * Purpose: navigation sidebar. Follows the ACTIVE TAB'S KIND (ADR-2, WI-S2.1):
 * a document tab gets Files / Outline / History, a browser tab gets Browsing
 * History / Bookmarks / Site Permissions.
 *
 * Key decisions:
 *   - Header and content read the SAME kind. They used to disagree: the
 *     content followed `sidebar.kind` while the header rendered from the
 *     remembered document view, so a browser tab could be titled "FILES" and
 *     carry the whole file toolbar — including a control that writes workspace
 *     config — above a list of visited pages.
 *   - Every icon button is a `SidebarActionButton`, so `title` and
 *     `aria-label` are one string by construction rather than two hand-kept
 *     copies of the same expression.
 *
 * @coordinates-with useSidebarContext.ts — resolves the active kind + sub-view
 * @coordinates-with SidebarActionButton.tsx — the one header/footer button
 * @module components/Sidebar/Sidebar
 */

import { useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FolderTree, TableOfContents, History, FilePlus, FolderPlus, PanelLeftClose, Trash2, ChevronsDownUp, ChevronsUpDown, Files, Bookmark, ShieldCheck } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { deleteDocumentHistory } from "@/services/history/historyRecovery";
import { emitHistoryCleared } from "@/utils/historyTypes";
import { useUIStore, type SidebarViewMode } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { toggleShowAllFiles } from "@/services/workspaces/workspaceConfig";
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
import { useWindowLabel } from "@/contexts/WindowContext";
import { useSidebarInstanceSync } from "./useSidebarInstanceSync";
import { SidebarActionButton } from "./SidebarActionButton";

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

/** Header chrome for the browser kind. The header used to read VIEW_CONFIG
 *  unconditionally, so a browser tab could be titled "FILES" and carry the
 *  whole file toolbar — including a control that writes workspace config —
 *  above a list of visited pages. (Audit finding, High.) */
const BROWSER_VIEW_CHROME: Record<BrowserSidebarView, {
  icon: typeof FolderTree;
  titleKey: string;
  showKey: string;
}> = {
  "browser-history": { icon: History, titleKey: "viewBrowserHistory", showKey: "showBrowserHistory" },
  bookmarks: { icon: Bookmark, titleKey: "viewBookmarks", showKey: "showBookmarks" },
  permissions: { icon: ShieldCheck, titleKey: "viewPermissions", showKey: "showPermissions" },
};

/** Navigation sidebar with switchable Files, Outline, and History views. */
export function Sidebar() {
  const { t } = useTranslation("sidebar");
  // WI-9.1 (D2): sidebar width/view-mode follow the active workspace instance.
  useSidebarInstanceSync(useWindowLabel());
  const sidebarShortcut = useShortcutsStore((state) => state.getShortcut("toggleSidebar"));
  const newFileShortcut = useShortcutsStore((state) => state.getShortcut("newFile"));
  const allFilesShortcut = useShortcutsStore((state) => state.getShortcut("toggleAllFiles"));
  // #1224: a folder of unsupported file types renders as empty folders. The
  // header owns the way out, because Settings is not where a confused user looks.
  const showAllFiles = useWorkspaceStore((state) => state.config?.showAllFiles ?? false);
  const isWorkspaceMode = useWorkspaceStore((state) => state.isWorkspaceMode);
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
  // The header follows the ACTIVE KIND, exactly as the content does.
  const isBrowser = sidebar.kind === "browser";
  const config = VIEW_CONFIG[viewMode];
  const browserView = sidebar.view as BrowserSidebarView;
  const browserChrome = BROWSER_VIEW_CHROME[browserView];
  const Icon = isBrowser ? browserChrome.icon : config.icon;

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

  const currentTitle = isBrowser ? t(browserChrome.titleKey) : t(viewTitleKey[viewMode]);
  const nextShowLabel = isBrowser
    ? t(BROWSER_VIEW_CHROME[BROWSER_VIEW_NEXT[browserView]].showKey)
    : t(showNextKey[config.next]);

  const handleClearDocumentHistory = useCallback(async () => {
    if (!filePath || isClearingRef.current) return;
    isClearingRef.current = true;
    try {
      const confirmed = await ask(
        t("clearHistoryMessage"),
        { title: t("clearDocumentHistory"), kind: "warning" }
      );
      // The service catches its own failures, so awaiting it proved nothing:
      // the UI announced a successful clear over history that was still there.
      if (confirmed && (await deleteDocumentHistory(filePath))) {
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
      {/* Spacer for the macOS traffic lights; collapses to nothing where the OS
          draws its own title bar (shellChrome.ts publishes the inset). */}
      <div className="sidebar-traffic-lights-spacer" />
      <div className="sidebar-header">
        <SidebarActionButton
          label={nextShowLabel}
          icon={Icon}
          onClick={handleToggleView}
          size={16}
        />
        <span className="sidebar-title">{currentTitle}</span>
        {/* Action buttons - files view */}
        {!isBrowser && viewMode === "files" && (
          <div className="sidebar-header-actions">
            <SidebarActionButton
              label={t("expandAllFolders")}
              icon={ChevronsUpDown}
              onClick={() => fileExplorerRef.current?.expandAll()}
            />
            <SidebarActionButton
              label={t("collapseAllFolders")}
              icon={ChevronsDownUp}
              onClick={() => fileExplorerRef.current?.collapseAll()}
            />
            <SidebarActionButton
              label={t("showAllFiles")}
              icon={Files}
              shortcut={allFilesShortcut}
              onClick={() => void toggleShowAllFiles()}
              pressed={showAllFiles}
              disabled={!isWorkspaceMode}
            />
            <SidebarActionButton
              label={t("newFile")}
              icon={FilePlus}
              shortcut={newFileShortcut}
              onClick={() => fileExplorerRef.current?.createNewFile()}
            />
            <SidebarActionButton
              label={t("newFolder")}
              icon={FolderPlus}
              onClick={() => fileExplorerRef.current?.createNewFolder()}
            />
          </div>
        )}
        {/* Action buttons - history view */}
        {!isBrowser && viewMode === "history" && filePath && (
          <div className="sidebar-header-actions">
            <SidebarActionButton
              label={t("clearDocumentHistory")}
              icon={Trash2}
              onClick={() => void handleClearDocumentHistory()}
            />
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
