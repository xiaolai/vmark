/**
 * Purpose: Build and rank Quick Open file items from recent, open, and workspace sources.
 * @coordinates-with fuzzyMatch.ts, quickOpenStore.ts, recentFilesStore, tabStore, workspaceStore
 */

import { useRecentFilesStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { fuzzyMatch, type FuzzyMatchResult } from "./fuzzyMatch";
import type { FileNode } from "@/components/Sidebar/FileExplorer/types";
import { getFileName } from "@/utils/pathUtils";

/** Tier indicating the source of a Quick Open item: recent file, open tab, or workspace tree. */
export type QuickOpenTier = "recent" | "open" | "workspace";

/** A file entry in the Quick Open list with its display metadata. */
export interface QuickOpenItem {
  path: string;
  filename: string;
  relPath: string;
  tier: QuickOpenTier;
  isOpenTab: boolean;
}

/** A Quick Open item paired with its fuzzy match result for ranked display. */
export interface RankedItem {
  item: QuickOpenItem;
  tier: QuickOpenTier;
  match: FuzzyMatchResult | null;
}

const TIER_ORDER: Record<QuickOpenTier, number> = { recent: 0, open: 1, workspace: 2 };

function getRelativePath(path: string, rootPath: string | null): string {
  if (rootPath && (path === rootPath || path.startsWith(rootPath + "/"))) {
    const rel = path.slice(rootPath.length);
    return rel.startsWith("/") ? rel.slice(1) : rel;
  }
  return path;
}

/** Recursively flatten a file tree into an array of file paths (excludes folders). */
export function flattenFileTree(nodes: FileNode[]): string[] {
  const paths: string[] = [];
  const walk = (items: FileNode[]) => {
    for (const node of items) {
      if (node.isFolder && node.children) walk(node.children);
      else if (!node.isFolder) paths.push(node.id);
    }
  };
  walk(nodes);
  return paths;
}

/** Build deduplicated Quick Open items from recent files, open tabs, and workspace paths. */
export function buildQuickOpenItems(
  windowLabel: string,
  workspaceFilePaths: string[],
): QuickOpenItem[] {
  const rootPath = useWorkspaceStore.getState().rootPath;
  const recentFiles = useRecentFilesStore.getState().files;
  const windowTabs = useTabStore.getState().getTabsByWindow(windowLabel);
  const openPathSet = new Set(
    windowTabs
      .filter((t: { filePath?: string | null }) => t.filePath)
      .map((t: { filePath?: string | null }) => t.filePath!),
  );

  const seen = new Set<string>();
  const items: QuickOpenItem[] = [];

  // Tier 1: Recent files (highest priority in dedup)
  for (const rf of recentFiles) {
    if (seen.has(rf.path)) continue;
    seen.add(rf.path);
    items.push({
      path: rf.path,
      filename: getFileName(rf.path),
      relPath: getRelativePath(rf.path, rootPath),
      tier: "recent",
      isOpenTab: openPathSet.has(rf.path),
    });
  }

  // Tier 2: Open tabs (deduped against recent)
  for (const path of openPathSet) {
    if (seen.has(path)) continue;
    seen.add(path);
    items.push({
      path,
      filename: getFileName(path),
      relPath: getRelativePath(path, rootPath),
      tier: "open",
      isOpenTab: true,
    });
  }

  // Tier 3: Workspace files (deduped against recent + open)
  for (const path of workspaceFilePaths) {
    if (seen.has(path)) continue;
    seen.add(path);
    items.push({
      path,
      filename: getFileName(path),
      relPath: getRelativePath(path, rootPath),
      tier: "workspace",
      isOpenTab: openPathSet.has(path),
    });
  }

  return items;
}

/** Filter items by fuzzy query and rank by tier priority then match score. */
export function filterAndRankItems(
  items: QuickOpenItem[],
  query: string,
  maxResults = 50,
): RankedItem[] {
  if (!query.trim()) {
    return items
      .filter((i) => i.tier !== "workspace")
      .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])
      .slice(0, maxResults)
      .map((item) => ({ item, tier: item.tier, match: null }));
  }

  const scored: RankedItem[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, item.filename, item.relPath);
    if (match) scored.push({ item, tier: item.tier, match });
  }

  scored.sort((a, b) => {
    const tierDiff = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    if (tierDiff !== 0) return tierDiff;
    /* v8 ignore next -- @preserve reason: match?.score nullish coalesce branch; match is always present when items are in scored array */
    return (b.match?.score ?? 0) - (a.match?.score ?? 0);
  });

  return scored.slice(0, maxResults);
}
