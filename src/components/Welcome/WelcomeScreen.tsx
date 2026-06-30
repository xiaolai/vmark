/**
 * WelcomeScreen
 *
 * Purpose: Empty-state shown in the editor area when a window has no open
 *   document — the "empty-workspace window" that stays open after the last
 *   tab is closed (VSCode-style). Offers quick actions (New File, Open File,
 *   Open Folder) and a recent-files list. When a workspace is open, its
 *   sidebar/file tree remains visible alongside this screen.
 *
 * Key decisions:
 *   - Reuses existing services for every action — no new file/open logic here.
 *   - windowLabel comes from WindowContext so actions target the right window.
 *
 * @coordinates-with components/Editor/Editor.tsx — rendered when no active tab
 * @coordinates-with hooks/useFileOpen.ts — handleNew / handleOpen
 * @coordinates-with services/commands — workspace.openFolder / file.openRecent
 * @coordinates-with stores/workspaceStore.ts — useRecentFilesStore (recent list)
 * @module components/Welcome/WelcomeScreen
 */
import { useTranslation } from "react-i18next";
import { FilePlus, FileUp, FolderOpen, FileClock } from "lucide-react";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { handleNew, handleOpen } from "@/hooks/useFileOpen";
import { executeCommand } from "@/services/commands";
import { fileOpsError } from "@/utils/debug";
import "./welcome.css";

export function WelcomeScreen() {
  const { t } = useTranslation("common");
  const windowLabel = useWindowLabel();
  const recentFiles = useRecentFilesStore((s) => s.files);

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

  return (
    <div className="welcome-screen" role="region" aria-label={t("emptyState.title")}>
      <div className="welcome-screen__inner">
        <h1 className="welcome-screen__title">{t("emptyState.title")}</h1>

        <div className="welcome-screen__actions">
          <button
            type="button"
            className="welcome-action"
            onClick={() => handleNew(windowLabel)}
          >
            <FilePlus className="welcome-action__icon" aria-hidden="true" />
            <span>{t("emptyState.newFile")}</span>
          </button>
          <button type="button" className="welcome-action" onClick={onOpenFile}>
            <FileUp className="welcome-action__icon" aria-hidden="true" />
            <span>{t("emptyState.openFile")}</span>
          </button>
          <button type="button" className="welcome-action" onClick={onOpenFolder}>
            <FolderOpen className="welcome-action__icon" aria-hidden="true" />
            <span>{t("emptyState.openFolder")}</span>
          </button>
        </div>

        <div className="welcome-screen__recent">
          <h2 className="welcome-screen__recent-title">{t("emptyState.recentTitle")}</h2>
          {recentFiles.length === 0 ? (
            <p className="welcome-screen__empty">{t("emptyState.noRecent")}</p>
          ) : (
            <ul className="welcome-recent-list">
              {recentFiles.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    className="welcome-recent-item"
                    title={file.path}
                    onClick={() => onOpenRecent(file.path)}
                  >
                    <FileClock className="welcome-recent-item__icon" aria-hidden="true" />
                    <span className="welcome-recent-item__name">{file.name}</span>
                    <span className="welcome-recent-item__path">{file.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
