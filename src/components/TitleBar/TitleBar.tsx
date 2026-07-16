/**
 * TitleBar
 *
 * Purpose: macOS-style title bar that displays the current document's filename
 * and supports inline rename via double-click.
 *
 * User interactions:
 *   - Double-click the filename to enter rename mode (or open save dialog
 *     for unsaved documents)
 *   - Type a new name and press Enter to confirm, Escape to cancel
 *   - Click away (blur) to cancel
 *
 * Key decisions:
 *   - The entire title bar is a Tauri drag region (data-tauri-drag-region)
 *     for window dragging, except when in rename mode.
 *   - Filename is shown without the .md extension for cleaner display;
 *     the extension is auto-appended during rename.
 *   - Visibility is controlled by a user setting (showFilenameInTitlebar);
 *     when off, renders an empty draggable bar.
 *   - Dirty, missing, and unsaved states have distinct visual indicators.
 *   - IME composition is respected — Enter/Escape during composition are ignored.
 *   - Root element is a `banner` ARIA landmark (labelled `aria.appTitleBar`).
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
import { getFileNameWithoutExtension } from "@/utils/pathUtils";
import "./title-bar.css";

interface TitleBarProps {
  /** Browser navigation replaces the filename while preserving the drag region. */
  browserChrome?: ReactNode;
}

/** macOS-style title bar displaying the document filename with inline rename on double-click. */
export function TitleBar({ browserChrome }: TitleBarProps = {}) {
  const { t } = useTranslation("common");
  const filePath = useDocumentFilePath();
  const isDirty = useDocumentIsDirty();
  const isMissing = useDocumentIsMissing();
  const activeTabId = useActiveTabId();
  const { renameFile, isRenaming } = useTitleBarRename();
  const showFilename = useSettingsStore((state) => state.appearance.showFilenameInTitlebar ?? false);

  // Get active tab's title for unsaved documents.
  // Selector returns a primitive (string | null) so React only re-renders on title change.
  const tabTitle = useTabStore((state) =>
    activeTabId ? state.findTabById(activeTabId)?.title ?? null : null
  );

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Get display filename: use file path (without extension) if saved, otherwise use tab title
  const displayName = filePath
    ? getFileNameWithoutExtension(filePath)
    : tabTitle ?? t("untitled");
  const isUnsaved = !filePath;

  // Start editing on double-click
  const handleDoubleClick = useCallback(() => {
    if (isUnsaved) {
      // For unsaved files, open save dialog
      // Include windowLabel payload — the listener filters by it
      const windowLabel = getCurrentWindowLabel();
      emitTo(windowLabel, "menu:save", windowLabel).catch(() => {/* event emission is best-effort */});
      return;
    }

    // Set initial value to filename without extension
    setEditValue(displayName);
    setIsEditing(true);
  }, [displayName, isUnsaved]);

  // Browser chrome replaces the filename UI on the same instance. Abandon any
  // in-progress rename the moment browser mode takes over so stale edit state
  // can't resurface — and rename the wrong file — when we return to a document.
  // Adjust-state-during-render (a stable boolean, not the re-created element)
  // per React's "you might not need an effect".
  const [wasBrowserChrome, setWasBrowserChrome] = useState(false);
  const isBrowserChrome = Boolean(browserChrome);
  if (isBrowserChrome !== wasBrowserChrome) {
    setWasBrowserChrome(isBrowserChrome);
    if (isBrowserChrome && isEditing) setIsEditing(false);
  }

  // Focus and select input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Handle rename confirmation
  const handleConfirm = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed || !filePath) {
      setIsEditing(false);
      return;
    }

    // No change if same as current name
    if (trimmed === displayName) {
      setIsEditing(false);
      return;
    }

    const success = await renameFile(filePath, trimmed);
    if (success) {
      setIsEditing(false);
    }
    // Keep editing if rename failed
  }, [editValue, filePath, displayName, renameFile]);

  // Handle key events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsEditing(false);
      }
    },
    [handleConfirm]
  );

  // Handle blur
  const handleBlur = useCallback(() => {
    // Cancel on blur for simplicity
    setIsEditing(false);
  }, []);

  if (browserChrome) {
    return (
      <div
        className="title-bar title-bar--browser"
        role="banner"
        aria-label={t("aria.appTitleBar")}
        data-tauri-drag-region
      >
        <div className="title-bar-browser" data-tauri-drag-region>
          <div className="title-bar-browser-leading" data-tauri-drag-region />
          {browserChrome}
        </div>
      </div>
    );
  }

  // Don't show filename when setting is off
  if (!showFilename) {
    return (
      <div className="title-bar" role="banner" aria-label={t("aria.appTitleBar")} data-tauri-drag-region>
        <div className="title-bar-content" data-tauri-drag-region />
      </div>
    );
  }

  // Remove drag region during edit to prevent interference with text selection/caret
  const dragRegion = isEditing ? {} : { "data-tauri-drag-region": true };

  return (
    <div className="title-bar" role="banner" aria-label={t("aria.appTitleBar")} {...dragRegion}>
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
    </div>
  );
}
