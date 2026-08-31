/**
 * WelcomeScreen
 *
 * Purpose: Empty-state shown in the editor area when a window has no open
 *   document — the "empty-workspace window" that stays open after the last
 *   tab is closed (VSCode-style). Offers quick actions (New File, Open File,
 *   Open Folder) and the recent files / recent workspaces lists. When a
 *   workspace is open, its sidebar/file tree remains visible alongside this
 *   screen.
 *
 * Key decisions:
 *   - Reuses existing services for every action — no new file/open logic here.
 *   - windowLabel comes from WindowContext so actions target the right window.
 *   - A recent list is rendered only when it HAS entries, and the one
 *     empty-state line covers both (#1331). Two headings over two empty lists
 *     is the state a fresh install is in, and it reads as broken rather than
 *     new.
 *
 * @coordinates-with components/Editor/Editor.tsx — rendered when no active tab
 * @coordinates-with services/navigation/fileOpen.ts — handleNew / handleOpen
 * @coordinates-with services/commands — workspace.openFolder / file.openRecent /
 *   workspace.openRecent
 * @coordinates-with stores/recentsStore.ts — useRecentFilesStore /
 *   useRecentWorkspacesStore
 * @module components/Welcome/WelcomeScreen
 */
import { useTranslation } from "react-i18next";
import { FilePlus, FileUp, FolderOpen, FileClock, FolderClock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useRecentFilesStore, useRecentWorkspacesStore } from "@/stores/workspaceStore";
import { handleNew, handleOpen } from "@/services/navigation/fileOpen";
import { executeCommand } from "@/services/commands";
import { fileOpsError } from "@/utils/debug";
import "./welcome.css";

/**
 * One titled MRU list. Rendered only when `entries` is non-empty.
 *
 * Declares the shape it needs rather than importing the store's entry type:
 * the two lists are the same machine (`createRecentsStore`) and this component
 * reads only the path and the display name from either.
 */
function RecentSection({
  title,
  icon: Icon,
  entries,
  onSelect,
}: {
  title: string;
  icon: LucideIcon;
  entries: ReadonlyArray<{ path: string; name: string }>;
  onSelect: (path: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="welcome-screen__recent">
      <h2 className="welcome-screen__recent-title">{title}</h2>
      <ul className="welcome-recent-list">
        {entries.map((entry) => (
          <li key={entry.path}>
            <button
              type="button"
              className="welcome-recent-item"
              title={entry.path}
              onClick={() => onSelect(entry.path)}
            >
              <Icon className="welcome-recent-item__icon" aria-hidden="true" />
              <span className="welcome-recent-item__name">{entry.name}</span>
              <span className="welcome-recent-item__path">{entry.path}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WelcomeScreen() {
  const { t } = useTranslation("common");
  const windowLabel = useWindowLabel();
  const recentFiles = useRecentFilesStore((s) => s.files);
  const recentWorkspaces = useRecentWorkspacesStore((s) => s.workspaces);

  // Action handlers swallow nothing silently: handleOpen self-handles its
  // errors, but executeCommand rejects if a command body throws, so we attach
  // a catch to avoid unhandled promise rejections with no user feedback.
  const onOpenFile = () => {
    handleOpen(windowLabel).catch((e) => fileOpsError("Welcome: open file failed:", e));
  };
  const onOpenFolder = () => {
    executeCommand("workspace.openFolder", undefined, { windowLabel }).catch((e) =>
      fileOpsError("Welcome: open folder failed:", e),
    );
  };
  const onOpenRecent = (path: string) => {
    executeCommand("file.openRecent", path, { windowLabel }).catch((e) =>
      fileOpsError("Welcome: open recent failed:", e),
    );
  };
  const onOpenRecentWorkspace = (path: string) => {
    executeCommand("workspace.openRecent", path, { windowLabel }).catch((e) =>
      fileOpsError("Welcome: open recent workspace failed:", e),
    );
  };

  const nothingRecent = recentFiles.length === 0 && recentWorkspaces.length === 0;

  return (
    <div className="welcome-screen" role="region" aria-label={t("emptyState.welcome")}>
      <div className="welcome-screen__inner">
        <h1 className="welcome-screen__title">{t("emptyState.title")}</h1>

        <div className="welcome-screen__actions">
          <button
            type="button"
            className="vm-btn vm-btn--pill welcome-action"
            onClick={() => handleNew(windowLabel)}
          >
            <FilePlus className="welcome-action__icon" aria-hidden="true" />
            <span>{t("emptyState.newFile")}</span>
          </button>
          <button type="button" className="vm-btn vm-btn--pill welcome-action" onClick={onOpenFile}>
            <FileUp className="welcome-action__icon" aria-hidden="true" />
            <span>{t("emptyState.openFile")}</span>
          </button>
          <button type="button" className="vm-btn vm-btn--pill welcome-action" onClick={onOpenFolder}>
            <FolderOpen className="welcome-action__icon" aria-hidden="true" />
            <span>{t("emptyState.openFolder")}</span>
          </button>
        </div>

        {nothingRecent ? (
          <p className="welcome-screen__empty">{t("emptyState.noRecent")}</p>
        ) : (
          <div className="welcome-screen__recents">
            <RecentSection
              title={t("emptyState.recentTitle")}
              icon={FileClock}
              entries={recentFiles}
              onSelect={onOpenRecent}
            />
            <RecentSection
              title={t("emptyState.recentWorkspacesTitle")}
              icon={FolderClock}
              entries={recentWorkspaces}
              onSelect={onOpenRecentWorkspace}
            />
          </div>
        )}
      </div>
    </div>
  );
}
