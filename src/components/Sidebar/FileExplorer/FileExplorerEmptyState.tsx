/**
 * Empty/loading placeholder for the FileExplorer panel — extracted from
 * FileExplorer.tsx so the explorer stays within its size baseline.
 *
 * @coordinates-with FileExplorer.tsx — renders this for no-workspace/loading
 * @module components/Sidebar/FileExplorer/FileExplorerEmptyState
 */
import { Folder } from "lucide-react";

export function FileExplorerEmptyState({
  label,
  ariaLabel,
}: {
  label: string;
  ariaLabel: string;
}) {
  return (
    <div className="file-explorer" role="navigation" aria-label={ariaLabel}>
      <div className="file-explorer-empty">{label}</div>
    </div>
  );
}

/** Workspace-name header row shown above the tree in workspace mode. */
export function FileExplorerWorkspaceHeader({ name }: { name: string | null }) {
  if (!name) return null;
  return (
    <div className="file-explorer-workspace-header">
      <Folder size={14} />
      <span className="file-explorer-workspace-name">{name}</span>
    </div>
  );
}
