/**
 * Purpose: Build and rank Quick Open file items from recent, open, and workspace sources.
 * @coordinates-with fuzzyMatch.ts, quickOpenStore.ts, recentFilesStore, tabStore, workspaceStore
 */

import { useRecentFilesStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { getActiveWorkspaceScope } from "@/services/workspaces/activeWorkspaceScope";
import { fuzzyMatch, type FuzzyMatchResult } from "./fuzzyMatch";
import type { FileNode } from "@/components/Sidebar/FileExplorer/types";
import { getFileName } from "@/utils/pathUtils";
import { getRelativePath as getRelativePathFromRoot } from "@/utils/paths/paths";

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
  // Delegate to the shared, separator-normalizing helper so workspace files
  // rank/display relative on Windows too. The previous inline comparison only
  // recognized rootPath + "/", missing backslash separators, so a path like
  // `C:\project\file.md` displayed as its full absolute path on Windows.
  if (!rootPath) return path;
  return getRelativePathFromRoot(rootPath, path);
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
  const rootPath = getActiveWorkspaceScope(windowLabel).rootPath;
  const recentFiles = useRecentFilesStore.getState().files;
  const windowTabs = useTabStore.getState().getTabsByWindow(windowLabel);
  const openPathSet = new Set(
    windowTabs
      .filter((t: { filePath?: string | null }) => t.filePath)
      .map((t: { filePath?: string | null }) => t.filePath!),
  );

  const seen = new Set<string>();
  const items: QuickOpenItem[] = [];

  // Shared construction so the three source loops don't repeat the
  // seen/dedup/item-shape logic. Returns false if the path was already added.
  const addItem = (path: string, tier: QuickOpenTier, isOpenTab: boolean): void => {
    if (seen.has(path)) return;
    seen.add(path);
    items.push({
      path,
      filename: getFileName(path),
      relPath: getRelativePath(path, rootPath),
      tier,
      isOpenTab,
    });
  };

  // Tier 1: Recent files (highest priority in dedup)
  for (const rf of recentFiles) {
    addItem(rf.path, "recent", openPathSet.has(rf.path));
  }

  // Tier 2: Open tabs (deduped against recent)
  for (const path of openPathSet) {
    addItem(path, "open", true);
  }

  // Tier 3: Workspace files (deduped against recent + open)
  for (const path of workspaceFilePaths) {
    addItem(path, "workspace", openPathSet.has(path));
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

  // Narrowed item type: only matched items reach `scored`, so `match` is
  // guaranteed non-null here and we can sort on `match.score` directly
  // (no unreachable `?? 0` fallback).
  type ScoredItem = RankedItem & { match: FuzzyMatchResult };
  const scored: ScoredItem[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, item.filename, item.relPath);
    if (match) scored.push({ item, tier: item.tier, match });
  }

  scored.sort((a, b) => {
    const tierDiff = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return b.match.score - a.match.score;
  });

  return scored.slice(0, maxResults);
}
