/**
 * Quick Open
 *
 * Spotlight-style centered overlay for quickly opening files.
 * Opens via Cmd+O, supports keyboard navigation, fuzzy search,
 * and a pinned "Browse..." row at the bottom.
 *
 * Follows the GeniePicker pattern: portal to document.body,
 * click-outside via useDismissOnOutsideOrEscape (deferred attach),
 * IME guard, and data-index scroll tracking.
 *
 * @coordinates-with quickOpenStore.ts, useQuickOpenItems.ts, fuzzyMatch.ts
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useQuickOpenStore } from "./quickOpenStore";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { useActiveWorkspaceScope } from "@/workspace";
import { useFileTree } from "@/components/Sidebar/FileExplorer/useFileTree";
import { openFileInNewTabCore, handleOpen } from "@/hooks/useFileOpen";
import {
  buildQuickOpenItems,
  filterAndRankItems,
  flattenFileTree,
} from "./useQuickOpenItems";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useImeComposition } from "@/hooks/useImeComposition";
import { useDismissOnOutsideOrEscape } from "@/hooks/useDismissOnOutsideOrEscape";
import { handleSpotlightTabTrap } from "@/components/spotlight/spotlightDialog";
import { QuickOpenList } from "./QuickOpenList";
import { quickOpenWarn } from "@/utils/debug";
import "./QuickOpen.css";

interface QuickOpenProps {
  windowLabel: string;
}

/** Spotlight-style centered overlay for quickly opening files via fuzzy search. */
export function QuickOpen({ windowLabel }: QuickOpenProps) {
  const { t } = useTranslation("editor");
  const isOpen = useQuickOpenStore((s) => s.isOpen);
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Revision counter — incremented on each open to force item rebuild
  const [revision, setRevision] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const ime = useImeComposition();

  // Only load the workspace tree while open; this avoids an idle watcher.
  const { rootPath, isWorkspaceMode, excludeFolders } =
    useActiveWorkspaceScope(windowLabel);
  const { tree } = useFileTree(isOpen ? rootPath : null, {
    excludeFolders,
    showHidden: false,
    showAllFiles: false,
    watchId: `quick-open-${windowLabel}`,
  });

  // Flatten workspace tree to file paths
  const workspacePaths = useMemo(() => flattenFileTree(tree), [tree]);

  // Build all items (recent + open tabs + workspace)
  // revision dep ensures fresh store reads on each open
  const allItems = useMemo(
    () => buildQuickOpenItems(windowLabel, workspacePaths),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision forces rebuild from store
    [windowLabel, workspacePaths, revision]
  );

  // Filter and rank
  const rankedItems = useMemo(
    () => filterAndRankItems(allItems, filter),
    [allItems, filter]
  );

  // Total count including Browse row
  const totalCount = rankedItems.length + 1; // +1 for Browse

  // Clamp selectedIndex when the ranked list shrinks (e.g. after typing narrows
  // results). Adjusted during render — React's recommended alternative to a
  // setState-in-effect, which would flash an out-of-range selection for a frame
  // and cost an extra render (#1063).
  if (selectedIndex >= totalCount) {
    setSelectedIndex(Math.max(0, totalCount - 1));
  }

  // Reset state on open — bump revision to rebuild items from fresh store state
  // Save previous focus for restoration on close. Legitimate setState-in-effect:
  // the resets are bound to the open/close transition and bundled with real side
  // effects (focus capture/restore, RAF focus, picker close), so they can't be
  // derived during render (#1063).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    /* v8 ignore next -- @preserve reason: false branch (close path) restores focus; jsdom focus tracking unreliable */
    if (isOpen) {
      useGeniePickerStore.getState().closePicker();
      previousFocusRef.current = document.activeElement;
      setFilter("");
      setSelectedIndex(0);
      setRevision((r) => r + 1);
      requestAnimationFrame(() => inputRef.current?.focus());
    /* v8 ignore start */
    } else if (previousFocusRef.current) {
      const el = previousFocusRef.current as HTMLElement;
      if (typeof el.focus === "function") el.focus();
      previousFocusRef.current = null;
    }
    /* v8 ignore stop */
  }, [isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleClose = useCallback(() => {
    useQuickOpenStore.getState().close();
  }, []);

  const handleSelectItem = useCallback(
    async (path: string) => {
      handleClose();
      // openFileInNewTabCore handles most errors internally (detaches orphaned
      // tab, shows toast). But pre-read routing/dialog steps (routeOpenBySize)
      // can still reject before that internal try/catch — callers ignore the
      // returned promise, so guard here to avoid an unhandled rejection.
      try {
        await openFileInNewTabCore(windowLabel, path);
      } catch (err) {
        quickOpenWarn("Failed to open file:", err);
      }
    },
    [windowLabel, handleClose]
  );

  const handleBrowse = useCallback(async () => {
    handleClose();
    // handleOpen drives a native file dialog + open; surface failures rather
    // than letting the floating promise become an unhandled rejection.
    try {
      await handleOpen(windowLabel);
    } catch (err) {
      quickOpenWarn("Failed to browse for file:", err);
    }
  }, [windowLabel, handleClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      /* v8 ignore next -- @preserve reason: IME composition guard not reachable in jsdom */
      if (isImeKeyEvent(e.nativeEvent) || ime.isComposing()) return;

      if (e.key === "Tab") {
        // Focus trap: cycle within the dialog (aria-modal semantics) so
        // keyboard focus can't leave the overlay while it stays open.
        handleSpotlightTabTrap(e, containerRef.current);
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % totalCount);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + totalCount) % totalCount);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (selectedIndex < rankedItems.length) {
          handleSelectItem(rankedItems[selectedIndex].item.path);
        } else {
          // Browse row
          handleBrowse();
        }
      }
    },
    [handleClose, totalCount, selectedIndex, rankedItems, handleSelectItem, handleBrowse, ime]
  );

  // Click outside to close. Escape is handled by the component's own
  // onKeyDown (preventDefault + state reset), so only the outside-click
  // half is delegated here. Deferred attach prevents the opening click
  // from immediately dismissing; bubble phase matches the original code.
  useDismissOnOutsideOrEscape(isOpen, containerRef, handleClose, {
    deferActivation: true,
    escape: false,
    capture: false,
  });

  // Scroll selected into view
  useEffect(() => {
    if (!listRef.current || selectedIndex < 0) return;
    const item = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    /* v8 ignore next -- @preserve reason: scrollIntoView requires real DOM; querySelector always returns null in jsdom */
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!isOpen) return null;

  const placeholder = isWorkspaceMode ? t("quickOpen.placeholder") : t("quickOpen.recentPlaceholder");

  return createPortal(
    <div className="quick-open-backdrop">
      <div
        ref={containerRef}
        className="quick-open"
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={t("quickOpen.ariaLabel")}
      >
        <div className="quick-open-header">
          <input
            ref={inputRef}
            className="quick-open-input"
            type="text"
            placeholder={placeholder}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSelectedIndex(0);
            }}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            role="combobox"
            aria-expanded={totalCount > 0}
            aria-controls="quick-open-list"
            aria-activedescendant={
              /* v8 ignore next -- @preserve reason: ternary false branch (totalCount=0) not exercised */
              totalCount > 0 ? `quick-open-item-${selectedIndex}` : undefined
            }
          />
        </div>

        <div className="quick-open-list" ref={listRef} id="quick-open-list" role="listbox">
          <QuickOpenList
            rankedItems={rankedItems}
            selectedIndex={selectedIndex}
            filter={filter}
            onSelectItem={handleSelectItem}
            onBrowse={handleBrowse}
            onHoverIndex={setSelectedIndex}
          />
        </div>

        <div className="quick-open-footer">
          <span className="quick-open-footer-hint">
            <kbd className="quick-open-kbd">&uarr;&darr;</kbd> {t("quickOpen.hintNavigate")}{" "}
            <kbd className="quick-open-kbd">Enter</kbd> {t("quickOpen.hintOpen")}{" "}
            <kbd className="quick-open-kbd">Esc</kbd> {t("quickOpen.hintClose")}
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
