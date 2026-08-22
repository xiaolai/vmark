/**
 * Purpose: Build and rank Quick Open file items from recent, open, and workspace sources.
 * @coordinates-with fuzzyMatch.ts, quickOpenStore.ts, recentFilesStore, tabStore, workspaceStore
 */

import { useRecentFilesStore } from "@/stores/workspaceStore";
import { tabFilePath } from "@/stores/tabStore";
import { useTabMruStore } from "@/stores/tabMruStore";
import { visibleWindowTabs } from "@/services/tabs/visibleWindowTabs";
import { getActiveWorkspaceScope } from "@/services/workspaces/activeWorkspaceScope";
import { fuzzyMatch, type FuzzyMatchResult } from "./fuzzyMatch";
import type { FileNode } from "@/components/Sidebar/FileExplorer/types";
import { getFileName } from "@/utils/pathUtils";
import { getRelativePath as getRelativePathFromRoot } from "@/utils/paths/paths";

/** Tier indicating the source of a Quick Open item: recent file, open tab, or workspace tree. */
type QuickOpenTier = "recent" | "open" | "workspace";

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

// WI-TNAV2.4: `open` outranks `recent`. Ordering the open tier by MRU is a
// NO-OP without this, and the reason is subtle: recents were emitted first and
// won dedup (`addItem` lets the first tier claim a path), while ordinary file
// opening ADDS the path to recents (`loadFileIntoTab.ts:20`) — so almost every
// open file was labelled `recent` and never reached the open tier at all.
const TIER_ORDER: Record<QuickOpenTier, number> = { open: 0, recent: 1, workspace: 2 };

/**
 * The window's open paths, most-recently-used first, with any path the MRU does
 * not mention appended in tab order. Falling back rather than dropping matters:
 * the MRU is NOT persisted (D4), so it is empty at every cold start — an
 * implementation that emitted only MRU-known paths would hide every open tab on
 * the first Quick Open after launch.
 */
function openPathsInMruOrder(windowLabel: string, openPathSet: Set<string>): string[] {
  const byId = new Map<string, string>();
  for (const tab of visibleWindowTabs(windowLabel)) {
    const path = tabFilePath(tab);
    if (path && openPathSet.has(path)) byId.set(tab.id, path);
  }
  // A companion Set keeps membership O(1) while the array keeps the order —
  // `ordered.includes` made this quadratic on every keystroke-free rebuild.
  const ordered: string[] = [];
  const emitted = new Set<string>();
  const push = (path: string): void => {
    if (emitted.has(path)) return;
    emitted.add(path);
    ordered.push(path);
  };
  for (const key of useTabMruStore.getState().keys(windowLabel)) {
    const path = byId.get(key);
    if (path) push(path);
  }
  for (const path of openPathSet) push(path);
  return ordered;
}

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
  // WI-12.1: the open-tab tier lists only the VISIBLE projection (active
  // instance + browser); selecting a global recent still switches context
  // through ownership-aware activation (WI-12.2).
  const windowTabs = visibleWindowTabs(windowLabel);
  const openPathSet = new Set(
    windowTabs
      .map((t) => tabFilePath(t))
      .filter((p): p is string => Boolean(p)),
  );

  const seen = new Set<string>();
  const items: QuickOpenItem[] = [];

  // Shared construction so the three source loops don't repeat the
  // seen/dedup/item-shape logic. A path already added by an earlier (higher-
  // priority) tier is skipped, so the first tier to claim a path owns it.
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

  // Tier 1: Open tabs, in MRU order — they claim their paths before recents,
  // which is what makes the MRU ordering observable at all.
  for (const path of openPathsInMruOrder(windowLabel, openPathSet)) {
    addItem(path, "open", true);
  }

  // Tier 2: Recent files (deduped against open)
  for (const rf of recentFiles) {
    addItem(rf.path, "recent", openPathSet.has(rf.path));
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
  // Trim once and match on the trimmed query. Surrounding whitespace used to
  // reach fuzzyMatch verbatim, where a leading/trailing space is just another
  // character to find in the filename — so `" foo "` matched nothing at all.
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
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
    const match = fuzzyMatch(normalizedQuery, item.filename, item.relPath);
    if (match) scored.push({ item, tier: item.tier, match });
  }

  scored.sort((a, b) => {
    const tierDiff = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return b.match.score - a.match.score;
  });

  return scored.slice(0, maxResults);
}
