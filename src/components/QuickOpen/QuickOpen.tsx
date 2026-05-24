/**
 * Quick Open
 *
 * Spotlight-style centered overlay for quickly opening files.
 * Opens via Cmd+O, supports keyboard navigation, fuzzy search,
 * and a pinned "Browse..." row at the bottom.
 *
 * Follows the GeniePicker pattern: portal to document.body,
 * click-outside via setTimeout(0), IME guard, and data-index
 * scroll tracking.
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
import { useWorkspace } from "@/workspace";
import { useFileTree } from "@/components/Sidebar/FileExplorer/useFileTree";
import { openFileInNewTabCore, handleOpen } from "@/hooks/useFileOpen";
import {
  buildQuickOpenItems,
  filterAndRankItems,
  flattenFileTree,
} from "./useQuickOpenItems";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useImeComposition } from "@/hooks/useImeComposition";
import "./QuickOpen.css";

const EMPTY_FOLDERS: string[] = [];

// Inline SVG icons to avoid import complexity
function FileIcon() {
  return (
    <svg className="quick-open-item-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M4 1h5l4 4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" />
      <path d="M9 1v4h4" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg className="quick-open-item-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M2 3h4l2 2h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function renderHighlighted(text: string, indices: number[] | undefined): React.ReactNode {
  if (!indices || indices.length === 0) return text;
  const indexSet = new Set(indices);
  return Array.from(text).map((char, i) =>
    indexSet.has(i) ? (
      <span key={i} className="quick-open-match">{char}</span>
    ) : (
      <span key={i}>{char}</span>
    )
  );
}

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

  // Workspace file tree — only load while Quick Open is open (perf: avoids idle watcher).
  // Use the ADR-008 workspace facade for the common reads; fall back to
  // useWorkspaceStore only for the field-derived `excludeFolders` value.
  const { rootPath, isWorkspaceMode, config } = useWorkspace();
  const excludeFolders = config?.excludeFolders ?? EMPTY_FOLDERS;
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

  // Clamp selectedIndex when ranked list shrinks (e.g. after typing narrows results)
  useEffect(() => {
    /* v8 ignore next 2 -- @preserve reason: clamp fires only when totalCount shrinks below selectedIndex; effect timing makes it unreliable in jsdom */
    if (selectedIndex >= totalCount) {
      setSelectedIndex(Math.max(0, totalCount - 1));
    }
  }, [selectedIndex, totalCount]);

  // Reset state on open — bump revision to rebuild items from fresh store state
  // Save previous focus for restoration on close
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

  const handleClose = useCallback(() => {
    useQuickOpenStore.getState().close();
  }, []);

  const handleSelectItem = useCallback(
    async (path: string) => {
      handleClose();
      // openFileInNewTabCore handles errors internally (detaches orphaned tab, shows toast).
      // No try/catch needed — stale file errors are handled within the core function.
      await openFileInNewTabCore(windowLabel, path);
    },
    [windowLabel, handleClose]
  );

  const handleBrowse = useCallback(() => {
    handleClose();
    handleOpen(windowLabel);
  }, [windowLabel, handleClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      /* v8 ignore next -- @preserve reason: IME composition guard not reachable in jsdom */
      if (isImeKeyEvent(e.nativeEvent) || ime.isComposing()) return;

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

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, handleClose]);

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
          {rankedItems.length === 0 && filter && (
            <div className="quick-open-empty">{t("quickOpen.noFiles")}</div>
          )}

          {rankedItems.map((ranked, index) => (
            <div
              key={ranked.item.path}
              className={`quick-open-item${index === selectedIndex ? " quick-open-item--selected" : ""}`}
              data-index={index}
              role="option"
              id={`quick-open-item-${index}`}
              aria-selected={index === selectedIndex}
              onClick={() => handleSelectItem(ranked.item.path)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <FileIcon />
              <span className="quick-open-item-name">
                {renderHighlighted(ranked.item.filename, ranked.match?.indices)}
              </span>
              {/* v8 ignore next -- @preserve reason: isOpenTab depends on tab state not set in QuickOpen tests */
              ranked.item.isOpenTab && <span className="quick-open-tab-dot" />}
              {ranked.item.relPath !== ranked.item.filename && (
                <span className="quick-open-item-path">
                  {renderHighlighted(ranked.item.relPath, ranked.match?.pathIndices)}
                </span>
              )}
            </div>
          ))}

          {/* Separator before Browse */}
          {rankedItems.length > 0 && <div className="quick-open-separator" />}

          {/* Browse row — always pinned at bottom */}
          <div
            className={`quick-open-item${selectedIndex === rankedItems.length ? " quick-open-item--selected" : ""}`}
            data-index={rankedItems.length}
            role="option"
            id={`quick-open-item-${rankedItems.length}`}
            aria-selected={selectedIndex === rankedItems.length}
            onClick={handleBrowse}
            onMouseEnter={() => setSelectedIndex(rankedItems.length)}
          >
            <FolderIcon />
            <span className="quick-open-item-name">{t("quickOpen.browse")}</span>
          </div>
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
