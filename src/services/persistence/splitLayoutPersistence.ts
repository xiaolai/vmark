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
 * A layout is always side-by-side. Records written while the split still had a
 * stacked orientation (`orientation: "vertical"`) load like any other — the
 * field is dropped on parse, never carried into pane state (WI-FL3.10).
 *
 * @coordinates-with stores/paneStore.ts — split state
 * @coordinates-with services/workspaces/workspaceSession.ts — saves on window close
 * @coordinates-with services/navigation/restoreWorkspaceTabs.ts — restores on open
 * @module services/persistence/splitLayoutPersistence
 */
import { workspaceError } from "@/utils/debug";
import { createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { normalizeWorkspacePathForIdentity } from "@/utils/workspaceIdentityPaths";
import { getRuntimePlatform, type RuntimePlatform } from "@/utils/platform";
import { MAX_PANE_FRACTION, MIN_PANE_FRACTION } from "@/stores/paneStoreTypes";

export interface SplitLayoutConfig {
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

/** The identity two pane paths are compared by — the ROOT key's rule, per file. */
function paneFileIdentity(path: string, platform: RuntimePlatform): string {
  return normalizeWorkspacePathForIdentity(path, platform).platformIdentity;
}

/**
 * A well-typed record can still be malformed (audit #482): `1e999` parses to
 * Infinity, a fraction can sit outside the pane clamp, a pane path can be
 * blank, and one path can name both panes. Non-finite and blank/duplicate
 * paths are refused; an out-of-range fraction is clamped, as the store would.
 *
 * "Duplicate" is by platform IDENTITY, not by raw string (round 3). Alternate
 * spellings of one Windows file — `C:\Repo\a.md` and `c:/repo/a.md` — passed a
 * `===` compare and restored a split showing that document in both panes, the
 * A/A state D9 and `resolveWindowSplit` both refuse. POSIX stays byte-exact,
 * exactly as the root key is (WI-17.2), because case there names a real file.
 */
function parseLayout(raw: string | null, platform: RuntimePlatform): SplitLayoutConfig | null {
  if (!raw) return null;
  try {
    const { fraction, syncScroll, primaryPath, secondaryPath } = JSON.parse(
      raw,
    ) as Partial<SplitLayoutConfig>;
    if (typeof fraction !== "number" || !Number.isFinite(fraction)) return null;
    if (typeof syncScroll !== "boolean") return null;
    if (typeof primaryPath !== "string" || typeof secondaryPath !== "string") return null;
    if (!primaryPath.trim() || !secondaryPath.trim()) return null;
    if (paneFileIdentity(primaryPath, platform) === paneFileIdentity(secondaryPath, platform)) {
      return null;
    }
    // Rebuilt field by field, never `parsed` itself: a legacy record's
    // `orientation` (and any other stray key) must not travel into the store.
    return {
      fraction: Math.min(MAX_PANE_FRACTION, Math.max(MIN_PANE_FRACTION, fraction)),
      syncScroll,
      primaryPath,
      secondaryPath,
    };
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
    const stable = parseLayout(localStorage.getItem(key), platform);
    if (stable) return stable;

    // Fallback migration: a valid layout under the legacy raw-path key moves
    // to the stable key; malformed legacy values are left untouched (null).
    const legacyKey = legacyKeyFor(rootPath);
    if (legacyKey === key) return null;
    const legacy = parseLayout(localStorage.getItem(legacyKey), platform);
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
