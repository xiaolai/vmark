/**
 * Wiki Link Path Helpers
 *
 * Purpose: Pure conversions between wiki-link targets ([[target]]) and
 * workspace file paths. Extracted from WikiLinkPopupView so the view stays
 * focused on popup lifecycle.
 *
 * @coordinates-with WikiLinkPopupView.ts — open/browse actions resolve paths here
 * @coordinates-with sourceWikiLinkPopup/sourceWikiLinkActions.ts — source-mode open action resolves paths here
 * @coordinates-with sourceWikiLinkPopup/SourceWikiLinkPopupView.ts — source-mode browse action converts paths here
 * @module plugins/wikiLinkPopup/wikiLinkPaths
 */

/**
 * Resolve a wiki link target to a full file path.
 */
export function resolveWikiLinkPath(target: string, workspaceRoot: string | null): string | null {
  if (!target || !workspaceRoot) return null;

  // If target already looks like a path, use it directly
  if (target.includes("/") || target.endsWith(".md")) {
    const normalized = target.endsWith(".md") ? target : `${target}.md`;
    return `${workspaceRoot}/${normalized}`;
  }

  // Simple target name - assume it's in workspace root with .md extension
  return `${workspaceRoot}/${target}.md`;
}

/**
 * Convert an absolute file path to a wiki link target (workspace-relative, without .md).
 */
export function pathToWikiTarget(filePath: string, workspaceRoot: string | null): string {
  if (!workspaceRoot) return filePath;

  // Remove workspace root prefix. The prefix match must end at a path
  // separator boundary — otherwise a sibling like /workspace2/file.md would
  // wrongly match root /workspace and become "2/file".
  const root = workspaceRoot.endsWith("/") ? workspaceRoot.slice(0, -1) : workspaceRoot;
  let relative = filePath;
  if (filePath.startsWith(`${root}/`)) {
    relative = filePath.slice(root.length + 1);
  }

  // Remove .md extension
  if (relative.endsWith(".md")) {
    relative = relative.slice(0, -3);
  }

  return relative;
}
