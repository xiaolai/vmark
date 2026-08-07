/**
 * TitleBar
 *
 * Purpose: macOS-style title bar. A thin shell that renders either the browser
 * chrome (when a browser workspace is active) or the DocumentTitleBar (filename
 * + inline rename). Splitting the two means the document rename hooks/state run
 * only for documents — they cannot leak into browser mode and resurface on a
 * stale return.
 *
 * Structure:
 *   - TitleBarBanner — the shared `banner` landmark + drag-region shell, so the
 *     landmark is defined once instead of copied per variant.
 *   - DocumentTitleBar — filename display + double-click inline rename.
 *   - TitleBar — the shell that picks a variant.
 *
 * Key decisions:
 *   - The entire title bar is a Tauri drag region (data-tauri-drag-region)
 *     except while renaming (so text selection/caret work).
 *   - Filename is shown as it is on disk, extension included, unless the user
 *     turns `general.showFileExtensions` off (#1224). Rename edits whatever is
 *     displayed, and says so: the original extension is re-attached only when
 *     the editor HID it. Otherwise deleting the suffix would be silently
 *     undone while the rename still reported success. The policy is SNAPSHOT
 *     when the editor opens, so a cross-window settings flip mid-rename cannot
 *     reinterpret text the user already typed.
 *   - IME composition is respected — Enter/Escape during composition are ignored.
 *
 * @coordinates-with useTitleBarRename.ts — performs the actual file rename via Tauri fs
 * @module components/TitleBar/TitleBar
 */
import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { useDocumentFilePath, useDocumentIsDirty, useDocumentIsMissing, useActiveTabId } from "@/hooks/useDocumentState";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTitleBarRename } from "./useTitleBarRename";
import { getFileName } from "@/utils/pathUtils";
import { formatFileDisplayName } from "@/utils/displayFileName";
import "./title-bar.css";

interface TitleBarProps {
  /** Browser navigation replaces the filename while preserving the drag region. */
  browserChrome?: ReactNode;
}

/** Shared `banner` landmark + drag-region shell for every title-bar variant. */
function TitleBarBanner({
  className,
  draggable = true,
  children,
}: {
  className?: string;
  draggable?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation("common");
  const drag = draggable ? { "data-tauri-drag-region": true } : {};
  return (
    <div
      className={["title-bar", className].filter(Boolean).join(" ")}
      role="banner"
      aria-label={t("aria.appTitleBar")}
      {...drag}
    >
      {children}
    </div>
  );
}

/**
 * The document title bar: filename display with double-click inline rename.
 * Mounted only for document tabs, so its editing state never survives a switch
 * to browser mode.
 */
function DocumentTitleBar() {
  const { t } = useTranslation("common");
  const filePath = useDocumentFilePath();
  const isDirty = useDocumentIsDirty();
  const isMissing = useDocumentIsMissing();
  const activeTabId = useActiveTabId();
  const { renameFile, isRenaming } = useTitleBarRename();
  const showFilename = useSettingsStore((state) => state.appearance.showFilenameInTitlebar ?? false);
  const showExtensions = useSettingsStore((state) => state.general.showFileExtensions ?? true);

  // Active tab's title for unsaved documents. Selector returns a primitive so
  // React only re-renders on title change.
  const tabTitle = useTabStore((state) =>
    activeTabId ? state.findTabById(activeTabId)?.title ?? null : null
  );

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // What the editor OPENED with. Settings sync across windows, so reading the
  // live values at confirm time lets a flip mid-rename change the meaning of
  // text the user already typed: `notes.md` → `notes` starts as "drop the
  // extension" and silently becomes "no change".
  const editOpenedWith = useRef<{ name: string; showExtensions: boolean } | null>(null);

  // #1224 — the name as it is on disk by default. This value is also what the
  // inline rename editor prefills, so you edit exactly what you see.
  const displayName = filePath
    ? formatFileDisplayName(getFileName(filePath), showExtensions)
    : formatFileDisplayName(tabTitle ?? t("untitled"), showExtensions);
  const isUnsaved = !filePath;

  const handleDoubleClick = useCallback(() => {
    if (isUnsaved) {
      // For unsaved files, open the save dialog (the listener filters by label).
      const windowLabel = getCurrentWindowLabel();
      emitTo(windowLabel, "menu:save", windowLabel).catch(() => {/* event emission is best-effort */});
      return;
    }
    editOpenedWith.current = { name: displayName, showExtensions };
    setEditValue(displayName);
    setIsEditing(true);
  }, [displayName, isUnsaved, showExtensions]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleConfirm = useCallback(async () => {
    const opened = editOpenedWith.current ?? { name: displayName, showExtensions };
    const trimmed = editValue.trim();
    if (!trimmed || !filePath) { setIsEditing(false); return; }
    if (trimmed === opened.name) { setIsEditing(false); return; }
    const success = await renameFile(filePath, trimmed, {
      preserveExtension: !opened.showExtensions,
    });
    if (success) setIsEditing(false);
    // Keep editing if rename failed.
  }, [editValue, filePath, displayName, renameFile, showExtensions]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") { e.preventDefault(); handleConfirm(); }
    else if (e.key === "Escape") { e.preventDefault(); setIsEditing(false); }
  }, [handleConfirm]);

  const handleBlur = useCallback(() => setIsEditing(false), []);

  if (!showFilename) {
    return (
      <TitleBarBanner>
        <div className="title-bar-content" data-tauri-drag-region />
      </TitleBarBanner>
    );
  }

  // Drop the drag region during edit to avoid interfering with text selection.
  const dragRegion = isEditing ? {} : { "data-tauri-drag-region": true };
  return (
    <TitleBarBanner draggable={!isEditing}>
      <div className="title-bar-content" {...dragRegion}>
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            className="title-bar-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            disabled={isRenaming}
          />
        ) : (
          <span
            className={`title-bar-filename ${isUnsaved ? "unsaved" : ""} ${isMissing ? "missing" : ""}`}
            onDoubleClick={handleDoubleClick}
            title={isMissing ? t("fileDeleted") : undefined}
          >
            {isDirty && <span className="dirty-indicator">•</span>}
            {isMissing && <span className="missing-indicator">⚠</span>}
            {displayName}
          </span>
        )}
      </div>
    </TitleBarBanner>
  );
}

/** macOS-style title bar: browser chrome when provided, otherwise the document title bar. */
export function TitleBar({ browserChrome }: TitleBarProps = {}) {
  if (browserChrome) {
    return (
      <TitleBarBanner className="title-bar--browser">
        <div className="title-bar-browser" data-tauri-drag-region>
          <div className="title-bar-browser-leading" data-tauri-drag-region />
          {browserChrome}
        </div>
      </TitleBarBanner>
    );
  }
  return <DocumentTitleBar />;
}
