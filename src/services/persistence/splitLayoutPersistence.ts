/**
 * Split-layout persistence (#1081 Phase 4, stable-root keying WI-17.2).
 *
 * The two-pane split is per-machine UI state (like window size), so it is
 * persisted in localStorage — NOT in the shared `.vmark` workspace config.
 * Both panes' file paths are stored so the layout restores deterministically
 * (the primary can't be inferred from whichever tab happens to be active
 * after restore).
 *
 * Keys use the workspace ROOT IDENTITY (`rootId`), not the raw path string,
 * so alternate spellings of one Windows root (`c:\repo` vs `C:\Repo`) share
 * one layout while macOS/Linux stay byte-exact. Legacy raw-path keys are
 * migrated on load and cleared on save.
 *
 * @coordinates-with stores/paneStore.ts — split state
 * @coordinates-with services/workspaces/workspaceSession.ts — saves on window close
 * @coordinates-with services/navigation/restoreWorkspaceTabs.ts — restores on open
 * @module services/persistence/splitLayoutPersistence
 */
import { workspaceError } from "@/utils/debug";
import { createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { getRuntimePlatform, type RuntimePlatform } from "@/utils/platform";

export interface SplitLayoutConfig {
  orientation: "horizontal" | "vertical";
  fraction: number;
  syncScroll: boolean;
  primaryPath: string;
  secondaryPath: string;
}

const KEY_PREFIX = "vmark-split-layout:";

/** Legacy raw-path key (pre-WI-17.2). Kept for migration only. */
const legacyKeyFor = (rootPath: string) =>
  `${KEY_PREFIX}${rootPath.replace(/[/\\]+$/, "")}`;

/** Stable identity key; falls back to the legacy key for invalid paths. */
function stableKeyFor(rootPath: string, platform: RuntimePlatform): string {
  const root = createWorkspaceRootIdentity(rootPath, { platform });
  if (!root.ok) return legacyKeyFor(rootPath);
  return `${KEY_PREFIX}id:${root.root.rootId}`;
}

function parseLayout(raw: string | null): SplitLayoutConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SplitLayoutConfig>;
    if (
      (parsed.orientation === "horizontal" || parsed.orientation === "vertical") &&
      typeof parsed.fraction === "number" &&
      typeof parsed.syncScroll === "boolean" &&
      typeof parsed.primaryPath === "string" &&
      typeof parsed.secondaryPath === "string"
    ) {
      return parsed as SplitLayoutConfig;
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist (or clear, when `layout` is null) the split layout for a workspace. */
export function saveSplitLayout(
  rootPath: string,
  layout: SplitLayoutConfig | null,
  platform: RuntimePlatform = getRuntimePlatform(),
): void {
  try {
    const key = stableKeyFor(rootPath, platform);
    if (layout) {
      localStorage.setItem(key, JSON.stringify(layout));
    } else {
      localStorage.removeItem(key);
    }
    // A stale legacy raw-path key must not shadow or resurrect old state.
    const legacyKey = legacyKeyFor(rootPath);
    if (legacyKey !== key) localStorage.removeItem(legacyKey);
  } catch (error) {
    workspaceError("Failed to save split layout:", error);
  }
}

/** Load the persisted split layout for a workspace, or null if none/invalid. */
export function loadSplitLayout(
  rootPath: string,
  platform: RuntimePlatform = getRuntimePlatform(),
): SplitLayoutConfig | null {
  try {
    const key = stableKeyFor(rootPath, platform);
    const stable = parseLayout(localStorage.getItem(key));
    if (stable) return stable;

    // Fallback migration: a valid layout under the legacy raw-path key moves
    // to the stable key; malformed legacy values are left untouched (null).
    const legacyKey = legacyKeyFor(rootPath);
    if (legacyKey === key) return null;
    const legacy = parseLayout(localStorage.getItem(legacyKey));
    if (legacy) {
      localStorage.setItem(key, JSON.stringify(legacy));
      localStorage.removeItem(legacyKey);
      return legacy;
    }
    return null;
  } catch (error) {
    workspaceError("Failed to load split layout:", error);
    return null;
  }
}
