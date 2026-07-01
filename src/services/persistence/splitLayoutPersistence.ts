/**
 * Split-layout persistence (#1081 Phase 4).
 *
 * The two-pane split is per-machine UI state (like window size), so it is
 * persisted in localStorage keyed by the workspace root path — NOT in the
 * shared `.vmark` workspace config. Only the secondary pane's file path is
 * stored; the primary pane is whatever document is active after restore.
 *
 * @coordinates-with stores/paneStore.ts — split state
 * @coordinates-with hooks/workspaceSession.ts — saves on window close
 * @coordinates-with services/navigation/restoreWorkspaceTabs.ts — restores on open
 * @module services/persistence/splitLayoutPersistence
 */
import { workspaceError } from "@/utils/debug";

export interface SplitLayoutConfig {
  orientation: "horizontal" | "vertical";
  fraction: number;
  syncScroll: boolean;
  secondaryPath: string;
}

const KEY_PREFIX = "vmark-split-layout:";

const keyFor = (rootPath: string) => `${KEY_PREFIX}${rootPath.replace(/[/\\]+$/, "")}`;

/** Persist (or clear, when `layout` is null) the split layout for a workspace. */
export function saveSplitLayout(rootPath: string, layout: SplitLayoutConfig | null): void {
  try {
    const key = keyFor(rootPath);
    if (layout) {
      localStorage.setItem(key, JSON.stringify(layout));
    } else {
      localStorage.removeItem(key);
    }
  } catch (error) {
    workspaceError("Failed to save split layout:", error);
  }
}

/** Load the persisted split layout for a workspace, or null if none/invalid. */
export function loadSplitLayout(rootPath: string): SplitLayoutConfig | null {
  try {
    const raw = localStorage.getItem(keyFor(rootPath));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SplitLayoutConfig>;
    if (
      (parsed.orientation === "horizontal" || parsed.orientation === "vertical") &&
      typeof parsed.fraction === "number" &&
      typeof parsed.syncScroll === "boolean" &&
      typeof parsed.secondaryPath === "string"
    ) {
      return parsed as SplitLayoutConfig;
    }
    return null;
  } catch (error) {
    workspaceError("Failed to load split layout:", error);
    return null;
  }
}
