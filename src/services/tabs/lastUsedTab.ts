/**
 * Resolve the `tab.lastUsed` target (WI-TNAV2.2).
 *
 * D13: the target is **the first MRU key that is neither the active key nor
 * unresolvable** — NOT literally `MRU[1]`. The two spellings agree only while
 * the active tab heads the visible-projected MRU, and they diverge in a state
 * reachable in production: `nextActiveAfterRemoval` picks the replacement by
 * RAW STRIP INDEX (`tabStoreHelpers.ts:184-193`) while `visibleWindowTabs`
 * filters by workspace instance, so with the rail on a close can leave MRU[0]
 * outside the visible projection. A literal `mru[1]` then stands still — the
 * dead key this exists to kill.
 *
 * D12: when no MRU key resolves to a visible target other than the current one,
 * the command NO-OPS. It never falls back positionally: in a window whose
 * second tab arrived by a background MCP open, a positional fallback lands the
 * user on a document they never saw, which is exactly what D5 forbids.
 *
 * @coordinates-with stores/tabMruStore.ts — the order
 * @coordinates-with services/tabs/visibleWindowTabs.ts — the projection
 * @module services/tabs/lastUsedTab
 */
import { useTabStore } from "@/stores/tabStore";
import { useTabMruStore, BROWSER_MRU_KEY, mruKeyOf } from "@/stores/tabMruStore";
import { visibleWindowTabs } from "@/services/tabs/visibleWindowTabs";

/**
 * The tab id an MRU key currently points at, or `null` if it resolves to
 * nothing visible. The browser workspace is one key covering many pages (D6),
 * so it resolves through `lastActiveBrowserPageId` — validated for liveness,
 * because that pointer survives its page being closed and a stale one would
 * make `Ctrl-Tab` a dead key while another page sits open.
 */
function resolveMruKey(windowLabel: string, key: string): string | null {
  const visible = visibleWindowTabs(windowLabel);
  if (key === BROWSER_MRU_KEY) {
    const remembered = useTabStore.getState().lastActiveBrowserPageId[windowLabel] ?? null;
    if (remembered && visible.some((t) => t.id === remembered)) return remembered;
    return visible.find((t) => t.kind === "browser")?.id ?? null;
  }
  return visible.some((t) => t.id === key) ? key : null;
}

/**
 * The window's MRU keys that resolve to a visible DOCUMENT tab, most recent
 * first. The browser workspace is one MRU key covering many pages (D6), so it
 * is excluded here rather than silently resolving to a page.
 */
export function mruDocumentIds(windowLabel: string): string[] {
  const documents = new Set(
    visibleWindowTabs(windowLabel)
      .filter((t) => t.kind === "document")
      .map((t) => t.id),
  );
  return useTabMruStore.getState().keys(windowLabel).filter((k) => documents.has(k));
}

/** The tab to activate, or `null` to do nothing (D12). */
export function lastUsedTabId(windowLabel: string): string | null {
  const activeId = useTabStore.getState().activeTabId[windowLabel] ?? null;
  const activeKey = activeId ? mruKeyOf(windowLabel, activeId) : null;

  for (const key of useTabMruStore.getState().keys(windowLabel)) {
    if (key === activeKey) continue;
    const target = resolveMruKey(windowLabel, key);
    if (target && target !== activeId) return target;
  }
  return null;
}
