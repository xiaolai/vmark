/**
 * Pure helpers for `paneStore` (#1081).
 *
 * Split out in WI-DSPL1.6, which pushed `paneStore.ts` past the 300-line limit
 * (it sat at exactly 300, so any addition failed the gate).
 *
 * Deliberately SIDE-EFFECT FREE, and that choice is the point. The obvious
 * extraction was `assertPaneTabInvariant` plus the `onTabActivated`
 * subscription — but those register at module load, and moving them would have
 * left nothing in production importing the module that registers them. Split
 * convergence would have stopped working while every test still passed, since
 * the tests import it directly. A pure function has no such failure mode.
 *
 * Mirrors the existing `tabStore` / `tabStoreHelpers` split.
 *
 * @coordinates-with stores/paneStore.ts — the only consumer
 * @module stores/paneStoreHelpers
 */
import {
  DEFAULT_SPLIT,
  MIN_PANE_FRACTION,
  MAX_PANE_FRACTION,
  type WindowSplit,
} from "@/stores/paneStoreTypes";

/** Clamp a pane fraction into the resize range, absorbing NaN. */
export function clampFraction(fraction: number): number {
  if (Number.isNaN(fraction)) return DEFAULT_SPLIT.fraction;
  return Math.min(MAX_PANE_FRACTION, Math.max(MIN_PANE_FRACTION, fraction));
}

/**
 * WI-10.1 — validate an incoming split against the window's live DOCUMENT tabs.
 * Both panes survive ⇒ the split; one ⇒ single pane on it; none ⇒ single pane on
 * the caller's fallback. A duplicate pane id is NOT a split (D9).
 */
export function resolveWindowSplit(
  split: WindowSplit | null,
  liveDocIds: ReadonlySet<string>,
  fallbackActiveTabId: string | null,
): WindowSplit {
  const validPane = (tabId: string | null): string | null =>
    tabId && liveDocIds.has(tabId) ? tabId : null;

  const primary = validPane(split?.primaryTabId ?? null);
  const secondary = validPane(split?.secondaryTabId ?? null);
  const bothValid =
    Boolean(split?.enabled) && primary !== null && secondary !== null && primary !== secondary;

  if (split && bothValid) {
    return { ...split, fraction: clampFraction(split.fraction), primaryTabId: primary, secondaryTabId: secondary };
  }
  // One survivor collapses to it; none uses the caller's fallback.
  const survivor = primary ?? secondary ?? validPane(fallbackActiveTabId);
  return { ...DEFAULT_SPLIT, primaryTabId: survivor };
}
