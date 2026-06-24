/**
 * QuickOpenList
 *
 * Purpose: Renders the ranked file rows and the pinned "Browse..." row for
 * QuickOpen. Split out of QuickOpen to keep that component focused on state
 * and keyboard wiring. Behavior preserved verbatim.
 *
 * @coordinates-with QuickOpen.tsx — parent overlay
 * @module components/QuickOpen/QuickOpenList
 */
import { useTranslation } from "react-i18next";
import {
  SpotlightFileIcon,
  SpotlightFolderIcon,
} from "@/components/spotlight/spotlightDialog";
import type { RankedItem } from "./useQuickOpenItems";

function FileIcon() {
  return <SpotlightFileIcon className="quick-open-item-icon" />;
}

function FolderIcon() {
  return <SpotlightFolderIcon className="quick-open-item-icon" />;
}

/** Render text with fuzzy-match indices highlighted. */
export function renderHighlighted(
  text: string,
  indices: number[] | undefined,
): React.ReactNode {
  if (!indices || indices.length === 0) return text;
  const indexSet = new Set(indices);
  return Array.from(text).map((char, i) =>
    indexSet.has(i) ? (
      <span key={i} className="quick-open-match">{char}</span>
    ) : (
      <span key={i}>{char}</span>
    ),
  );
}

interface QuickOpenListProps {
  rankedItems: RankedItem[];
  selectedIndex: number;
  filter: string;
  onSelectItem: (path: string) => void;
  onBrowse: () => void;
  onHoverIndex: (index: number) => void;
}

export function QuickOpenList({
  rankedItems,
  selectedIndex,
  filter,
  onSelectItem,
  onBrowse,
  onHoverIndex,
}: QuickOpenListProps) {
  const { t } = useTranslation("editor");
  return (
    <>
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
          onClick={() => onSelectItem(ranked.item.path)}
          onMouseEnter={() => onHoverIndex(index)}
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
        onClick={onBrowse}
        onMouseEnter={() => onHoverIndex(rankedItems.length)}
      >
        <FolderIcon />
        <span className="quick-open-item-name">{t("quickOpen.browse")}</span>
      </div>
    </>
  );
}
