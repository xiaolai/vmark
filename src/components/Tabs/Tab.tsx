/**
 * Tab
 *
 * Purpose: Individual tab pill in the status bar tab strip. Shows the document
 * title with visual indicators for dirty, pinned, missing (deleted from disk),
 * and divergent (local differs from disk) states.
 *
 * User interactions:
 *   - Click to activate (switch to this document)
 *   - Middle-click or click X to close
 *   - Right-click for context menu (handled by parent)
 *   - Pointer-down starts drag (handled by parent via onPointerDown)
 *
 * Key decisions:
 *   - Wrapped in React.memo to avoid re-rendering all tabs when only one
 *     tab's active state changes; dirty/missing/divergent are per-tab selectors.
 *   - Uses role="tab" with aria-selected for accessibility; roving tabindex
 *     plus Arrow/Home/End focus movement in tabKeyboard.ts (audit H27)
 *     (0 for active, -1 for others) enables keyboard navigation.
 *   - Close button is hidden for pinned tabs to prevent accidental closure.
 *   - CSS class composition uses cn() for conditional classes including
 *     drag state classes (dragging, reordering, invalid-drop, snapback).
 *
 * @coordinates-with StatusBar.tsx — renders Tab instances inside the tab strip
 * @coordinates-with TabContextMenu.tsx — right-click menu triggered via onContextMenu
 * @module components/Tabs/Tab
 */
import { memo, useCallback, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { X, Pin, AlertTriangle, GitFork } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { Tab as TabType } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

interface TabProps {
  tab: TabType;
  isActive: boolean;
  isDragTarget?: boolean;
  isReordering?: boolean;
  isInvalidDrop?: boolean;
  isSnapback?: boolean;
  showDropIndicator?: boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onContextMenu: (e: MouseEvent, tab: TabType) => void;
  onPointerDown?: (e: PointerEvent) => void;
  onKeyDown?: (tabId: string, e: KeyboardEvent) => void;
}

/** Renders an individual tab pill with dirty, pinned, missing, and divergent state indicators. */
export const Tab = memo(function Tab({
  tab,
  isActive,
  isDragTarget,
  isReordering,
  isInvalidDrop,
  isSnapback,
  showDropIndicator,
  onActivate,
  onClose,
  onContextMenu,
  onPointerDown,
  onKeyDown,
}: TabProps) {
  const { t } = useTranslation("common");
  // Get dirty, missing, and divergent state from document store
  const isDirty = useDocumentStore(
    (state) => state.documents[tab.id]?.isDirty ?? false
  );
  const isMissing = useDocumentStore(
    (state) => state.documents[tab.id]?.isMissing ?? false
  );
  const isDivergent = useDocumentStore(
    (state) => state.documents[tab.id]?.isDivergent ?? false
  );
  const showDivergent = isDivergent && !isMissing;

  const tooltip = isMissing
    ? t("fileDeleted")
    : showDivergent
      ? t("fileDivergent")
      : undefined;

  const handleActivate = useCallback(() => {
    onActivate(tab.id);
  }, [onActivate, tab.id]);

  const handleClose = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onClose(tab.id);
    },
    [onClose, tab.id]
  );

  const handleMiddleClick = useCallback(
    (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        onClose(tab.id);
      }
    },
    [onClose, tab.id]
  );

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      onContextMenu(e, tab);
    },
    [onContextMenu, tab]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      onKeyDown?.(tab.id, e);
    },
    [onKeyDown, tab.id]
  );

  return (
    <>
      {/* Drop indicator line before this tab */}
      {showDropIndicator && <div className="tab-drop-indicator" />}
      <div
        role="tab"
        aria-selected={isActive}
        data-tab-id={tab.id}
        className={cn(
          "tab-pill group",
          isActive && "active",
          isMissing && "tab-missing",
          showDivergent && "tab-divergent",
          isDragTarget && "tab--dragging",
          isReordering && "tab--reordering",
          isInvalidDrop && "tab--invalid-drop",
          isSnapback && "tab--snapback"
        )}
        tabIndex={isActive ? 0 : -1}
        onClick={handleActivate}
        onKeyDown={handleKeyDown}
        onMouseDown={handleMiddleClick}
        onPointerDown={onPointerDown}
        onContextMenu={handleContextMenu}
        title={tooltip}
      >
        {/* Pin indicator */}
        {tab.isPinned && (
          <Pin className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
        )}

        {/* Missing file indicator (warning icon) */}
        {isMissing && (
          <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
        )}

        {/* Divergent indicator (local differs from disk) */}
        {showDivergent && (
          <GitFork className="w-3 h-3 text-[var(--accent-primary)] flex-shrink-0" />
        )}

        {/* Dirty indicator (dot before title) */}
        {isDirty && !isMissing && (
          <span className="tab-dirty-dot" />
        )}

        {/* Tab title */}
        <span className="tab-title">{tab.title}</span>

        {/* Close button (shown on hover for non-pinned) */}
        {!tab.isPinned && (
          <button
            type="button"
            className="tab-close"
            data-tab-close
            onClick={handleClose}
            aria-label={t("closeTab", { title: tab.title })}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </>
  );
});
