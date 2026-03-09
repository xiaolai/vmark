/**
 * Outline View Component
 *
 * Displays document heading structure as a tree.
 */

import { useState, useDeferredValue, useMemo, useRef } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { emit } from "@tauri-apps/api/event";
import { useUIStore } from "@/stores/uiStore";
import { useDocumentContent } from "@/hooks/useDocumentState";
import { perfStart, perfEnd } from "@/utils/perfLog";
import {
  extractHeadings,
  buildHeadingTree,
  getHeadingLinesKey,
  countTreeNodes,
  buildLimitedTree,
  type HeadingItem,
  type HeadingNode,
} from "./outlineUtils";

function OutlineItem({
  node,
  activeIndex,
  collapsedSet,
  onToggle,
  onClick,
}: {
  node: HeadingNode;
  activeIndex: number;
  collapsedSet: Set<number>;
  onToggle: (index: number) => void;
  onClick: (headingIndex: number) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsedSet.has(node.index);
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
            aria-label={isCollapsed ? "Expand section" : "Collapse section"}
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
        <span className="outline-text">{node.text}</span>
      </div>
      {hasChildren && !isCollapsed && (
        <ul className="outline-children" role="group">
          {node.children.map((child) => (
            <OutlineItem
              key={child.index}
              node={child}
              activeIndex={activeIndex}
              collapsedSet={collapsedSet}
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
const MAX_CONTENT_FOR_OUTLINE = 100000; // 100KB threshold
const MAX_OUTLINE_ITEMS = 100; // Limit total visible items

export function OutlineView() {
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
    const newHeadings = extractHeadings(deferredContent);
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

  // Count total nodes and build limited tree if needed
  const totalNodes = useMemo(() => countTreeNodes(tree), [tree]);
  const isTruncated = totalNodes > MAX_OUTLINE_ITEMS;

  const limitedTree = useMemo(() => {
    if (!isTruncated) return tree;
    return buildLimitedTree(tree, MAX_OUTLINE_ITEMS);
  }, [tree, isTruncated]);

  const activeIndex = activeHeadingIndex ?? -1;

  // Track collapsed state by heading text + level (preserves state across edits)
  // Using level:text as key to handle duplicate heading texts
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());

  // Convert key-based collapsed state to index-based for rendering
  const collapsedSet = useMemo(() => {
    const set = new Set<number>();
    headings.forEach((h, i) => {
      const key = `${h.level}:${h.text}`;
      if (collapsedKeys.has(key)) set.add(i);
    });
    return set;
  }, [headings, collapsedKeys]);

  const handleToggle = (index: number) => {
    const heading = headings[index];
    if (!heading) return;

    const key = `${heading.level}:${heading.text}`;
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
    // Emit event to scroll editor to this heading
    void emit("outline:scroll-to-heading", { headingIndex });
    // Update active heading immediately for responsive UI
    useUIStore.getState().setActiveHeadingLine(headingIndex);
  };

  // Skip outline for very large documents to prevent performance issues
  if (isTooLarge) {
    return (
      <div className="sidebar-view outline-view">
        <div className="sidebar-empty">Document too large for outline</div>
      </div>
    );
  }

  return (
    <div className="sidebar-view outline-view">
      {headings.length > 0 ? (
        <>
          <ul className="outline-tree" role="tree" aria-label="Document outline">
            {limitedTree.map((node) => (
              <OutlineItem
                key={node.index}
                node={node}
                activeIndex={activeIndex}
                collapsedSet={collapsedSet}
                onToggle={handleToggle}
                onClick={handleClick}
              />
            ))}
          </ul>
          {isTruncated && (
            <div className="outline-truncated">
              + {totalNodes - MAX_OUTLINE_ITEMS} more headings
            </div>
          )}
        </>
      ) : (
        <div className="sidebar-empty">No headings</div>
      )}
    </div>
  );
}
