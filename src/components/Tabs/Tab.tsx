import { memo, useCallback, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { X, Pin, AlertTriangle, GitFork } from "lucide-react";
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
  onActivate: () => void;
  onClose: () => void;
  onContextMenu: (e: MouseEvent) => void;
  onPointerDown?: (e: PointerEvent) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}

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
    ? "File deleted from disk"
    : showDivergent
      ? "Local differs from disk"
      : undefined;

  const handleClose = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose]
  );

  const handleMiddleClick = useCallback(
    (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
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
        onClick={onActivate}
        onKeyDown={onKeyDown}
        onMouseDown={handleMiddleClick}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
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
            onClick={handleClose}
            aria-label={`Close ${tab.title}`}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </>
  );
});

export default Tab;
