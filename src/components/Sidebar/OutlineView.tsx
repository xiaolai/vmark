/**
 * Outline View Component
 *
 * Displays document heading structure as a tree with a substring filter.
 */

import { useState, useDeferredValue, useMemo, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, ChevronDown, Search, X } from "lucide-react";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import { useUIStore } from "@/stores/uiStore";
import { useDocumentContent } from "@/hooks/useDocumentState";
import { perfStart, perfEnd } from "@/utils/perfLog";
import {
  extractHeadings,
  buildHeadingTree,
  filterHeadingTree,
  getHeadingLinesKey,
  type HeadingItem,
  type HeadingNode,
} from "./outlineUtils";

function OutlineItem({
  node,
  activeIndex,
  collapsedSet,
  forceExpand,
  onToggle,
  onClick,
}: {
  node: HeadingNode;
  activeIndex: number;
  collapsedSet: Set<number>;
  forceExpand: boolean;
  onToggle: (index: number) => void;
  onClick: (headingIndex: number) => void;
}) {
  const { t } = useTranslation("sidebar");
  const hasChildren = node.children.length > 0;
  // Filter results override collapsed state so matches stay visible.
  const isCollapsed = !forceExpand && collapsedSet.has(node.index);
  const isActive = node.index === activeIndex;

  return (
    <li className="outline-tree-item">
      <div
        role="treeitem"
        tabIndex={0}
        aria-selected={isActive}
        aria-expanded={hasChildren ? !isCollapsed : undefined}
        className={`outline-item outline-level-${node.level} ${isActive ? "active" : ""}`}
        onClick={() => onClick(node.index)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick(node.index);
          }
        }}
      >
        {hasChildren ? (
          <button
            className="outline-toggle"
            aria-label={isCollapsed ? t("outline.expandSection") : t("outline.collapseSection")}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.index);
            }}
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        ) : (
          <span className="outline-toggle-spacer" />
        )}
        <span className="outline-text" title={node.text}>
          {node.text}
        </span>
      </div>
      {hasChildren && !isCollapsed && (
        <ul className="outline-children" role="group">
          {node.children.map((child) => (
            <OutlineItem
              key={child.index}
              node={child}
              activeIndex={activeIndex}
              collapsedSet={collapsedSet}
              forceExpand={forceExpand}
              onToggle={onToggle}
              onClick={onClick}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// Size thresholds for performance
const MAX_CONTENT_FOR_OUTLINE = 500000; // ~500KB — allows outlines for large real-world documents
const MAX_HEADING_COUNT = 1000; // Safety cap for heading count

/** Renders the document heading structure as a collapsible tree in the sidebar. */
export function OutlineView() {
  const { t } = useTranslation("sidebar");
  const content = useDocumentContent();
  const deferredContent = useDeferredValue(content);
  const activeHeadingIndex = useUIStore((state) => state.activeHeadingLine);

  // Check if document is too large (used after hooks)
  const isTooLarge = deferredContent.length > MAX_CONTENT_FOR_OUTLINE;

  // Create a stable key based only on heading lines.
  // This prevents re-extraction when typing in non-heading content.
  const headingLinesKey = useMemo(
    () => (isTooLarge ? "" : getHeadingLinesKey(deferredContent)),
    [deferredContent, isTooLarge]
  );

  // Cache previous headings to maintain referential stability
  const prevHeadingsRef = useRef<HeadingItem[]>([]);
  const prevKeyRef = useRef<string>("");

  // Only re-extract headings when heading lines actually change
  const headings = useMemo(() => {
    if (isTooLarge) return [];
    if (headingLinesKey === prevKeyRef.current) {
      return prevHeadingsRef.current;
    }
    perfStart("OutlineView:extractHeadings");
    const extracted = extractHeadings(deferredContent);
    const newHeadings = extracted.length > MAX_HEADING_COUNT ? extracted.slice(0, MAX_HEADING_COUNT) : extracted;
    perfEnd("OutlineView:extractHeadings", { count: newHeadings.length });
    prevHeadingsRef.current = newHeadings;
    prevKeyRef.current = headingLinesKey;
    return newHeadings;
  }, [headingLinesKey, deferredContent, isTooLarge]);

  const tree = useMemo(() => {
    if (isTooLarge) return [];
    perfStart("OutlineView:buildHeadingTree");
    const result = buildHeadingTree(headings);
    perfEnd("OutlineView:buildHeadingTree", { rootNodes: result.length });
    return result;
  }, [headings, isTooLarge]);

  // Filter state — defer to keep typing responsive on large outlines.
  const [filterQuery, setFilterQuery] = useState("");
  const deferredFilterQuery = useDeferredValue(filterQuery);
  const isFilterActive = deferredFilterQuery.trim().length > 0;

  const visibleTree = useMemo(
    () => filterHeadingTree(tree, deferredFilterQuery),
    [tree, deferredFilterQuery]
  );

  const activeIndex = activeHeadingIndex ?? -1;

  // Track collapsed state by heading identity (level:line:text).
  // Including line number prevents duplicate headings from collapsing together.
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());

  // Convert key-based collapsed state to index-based for rendering
  const collapsedSet = useMemo(() => {
    const set = new Set<number>();
    headings.forEach((h, i) => {
      const key = `${h.level}:${h.line}:${h.text}`;
      if (collapsedKeys.has(key)) set.add(i);
    });
    return set;
  }, [headings, collapsedKeys]);

  const handleToggle = (index: number) => {
    const heading = headings[index];
    if (!heading) return;

    const key = `${heading.level}:${heading.line}:${heading.text}`;
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleClick = (headingIndex: number) => {
    // Emit to current window only — prevents cross-window scroll in multi-window mode
    emitTo(getCurrentWindowLabel(), "outline:scroll-to-heading", { headingIndex }).catch(() => {/* event emission is best-effort */});
    // Update active heading immediately for responsive UI
    useUIStore.getState().setActiveHeadingLine(headingIndex);
  };

  const handleFilterKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && filterQuery.length > 0) {
      e.preventDefault();
      setFilterQuery("");
    }
  }, [filterQuery]);

  // Skip outline for very large documents to prevent performance issues
  if (isTooLarge) {
    return (
      <div className="sidebar-view outline-view">
        <div className="sidebar-empty">{t("outline.tooLarge")}</div>
      </div>
    );
  }

  // No headings at all → don't show the filter input.
  if (headings.length === 0) {
    return (
      <div className="sidebar-view outline-view">
        <div className="sidebar-empty">{t("outline.noHeadings")}</div>
      </div>
    );
  }

  return (
    <div className="sidebar-view outline-view">
      <div className="outline-filter">
        <Search size={12} className="outline-filter-icon" aria-hidden="true" />
        <input
          type="text"
          className="outline-filter-input"
          placeholder={t("outline.filterPlaceholder")}
          aria-label={t("outline.filterPlaceholder")}
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          onKeyDown={handleFilterKeyDown}
        />
        {filterQuery.length > 0 && (
          <button
            type="button"
            className="outline-filter-clear"
            aria-label={t("outline.clearFilter")}
            onClick={() => setFilterQuery("")}
          >
            <X size={12} />
          </button>
        )}
      </div>
      {visibleTree.length > 0 ? (
        <ul className="outline-tree" role="tree" aria-label={t("outline.documentOutline")}>
          {visibleTree.map((node) => (
            <OutlineItem
              key={node.index}
              node={node}
              activeIndex={activeIndex}
              collapsedSet={collapsedSet}
              forceExpand={isFilterActive}
              onToggle={handleToggle}
              onClick={handleClick}
            />
          ))}
        </ul>
      ) : (
        <div className="sidebar-empty">{t("outline.noMatches")}</div>
      )}
    </div>
  );
}
