/**
 * FileNode
 *
 * Purpose: Renders a single node (file or folder) in the file explorer tree.
 * Handles expand/collapse, active file highlighting, and inline rename editing.
 *
 * Key decisions:
 *   - Inline rename auto-selects the filename without extension on focus,
 *     so users can type a new name without manually deselecting ".md".
 *   - IME guard prevents Escape/Enter during CJK composition from
 *     triggering rename actions.
 *
 * @coordinates-with FileExplorer.tsx — used as the react-arborist node renderer
 * @module components/Sidebar/FileExplorer/FileNode
 */
import { ChevronRight, ChevronDown, Folder, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isImeKeyEvent } from "@/utils/imeGuard";
import type { NodeRendererProps } from "react-arborist";
import type { FileNode as FileNodeType } from "./types";

interface FileNodeProps extends NodeRendererProps<FileNodeType> {
  currentFilePath: string | null;
}

/** Renders a single file or folder node in the explorer tree with inline rename support. */
export function FileNode({ node, style, dragHandle, currentFilePath }: FileNodeProps) {
  const { t } = useTranslation("sidebar");
  const data = node.data;
  const isActive = data.id === currentFilePath;
  const isEditing = node.isEditing;

  return (
    <div
      ref={dragHandle}
      style={style}
      data-node-id={data.id}
      className={`file-node ${isActive ? "active" : ""} ${node.isSelected ? "selected" : ""}`}
    >
      <span className="file-node-indent" />

      {data.isFolder ? (
        // WI-2.1 (a11y) — folder expand/collapse chevron is a real button.
        // Keyboard users press Enter or Space to toggle; mouse click still
        // works. aria-expanded reflects the live folder state so screen
        // readers announce open/closed correctly.
        <button
          type="button"
          className="file-node-arrow"
          aria-label={
            node.isOpen ? t("collapseFolder") : t("expandFolder")
          }
          aria-expanded={node.isOpen}
          onClick={(e) => {
            e.stopPropagation();
            node.toggle();
          }}
          onKeyDown={(e) => {
            // <button> already handles Enter/Space natively, but stop
            // propagation so the parent's row-level keydown handlers
            // (react-arborist) don't double-trigger.
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
            }
          }}
        >
          {node.isOpen ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
        </button>
      ) : (
        <span className="file-node-arrow" />
      )}

      <span className="file-node-icon">
        {data.isFolder ? (
          <Folder size={14} />
        ) : (
          <FileText size={14} />
        )}
      </span>

      {isEditing ? (
        <input
          type="text"
          className="file-node-input"
          defaultValue={data.name}
          autoFocus
          onFocus={(e) => {
            // Select filename without extension
            const input = e.target;
            const dotIndex = input.value.lastIndexOf(".");
            if (dotIndex > 0) {
              input.setSelectionRange(0, dotIndex);
            } else {
              input.select();
            }
          }}
          onBlur={() => node.reset()}
          onKeyDown={(e) => {
            if (isImeKeyEvent(e)) return;
            if (e.key === "Escape") {
              node.reset();
            } else if (e.key === "Enter") {
              node.submit(e.currentTarget.value);
            }
          }}
        />
      ) : (
        <span className="file-node-name">{data.name}</span>
      )}
    </div>
  );
}
