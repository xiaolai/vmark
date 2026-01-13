import { ChevronRight, ChevronDown, Folder, FileText } from "lucide-react";
import { isImeKeyEvent } from "@/utils/imeGuard";
import type { NodeRendererProps } from "react-arborist";
import type { FileNode as FileNodeType } from "./types";

interface FileNodeProps extends NodeRendererProps<FileNodeType> {
  currentFilePath: string | null;
}

export function FileNode({ node, style, dragHandle, currentFilePath }: FileNodeProps) {
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
        <span
          className="file-node-arrow"
          onClick={(e) => {
            e.stopPropagation();
            node.toggle();
          }}
        >
          {node.isOpen ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
        </span>
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
