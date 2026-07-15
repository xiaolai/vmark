/**
 * Pure helpers for tabStore's browser-tab actions (WI-1.1 / R1).
 *
 * Extracted from tabStore.ts so the store stays under its size baseline. No
 * store access — exercised via tabStore's `createBrowserTab`/`updateBrowserTab`
 * through `tabStore.browser.test.ts`.
 *
 * @coordinates-with tabStore.ts — sole caller
 * @module stores/tabStoreBrowser
 */

import { canonicalizeBrowserUrl } from "@/lib/browser/url";
import type {
  BrowserAutomationMode,
  BrowserPersistPolicy,
  Tab,
  BrowserTab,
} from "./tabStoreTypes";

/** Canonical URL for a browser tab; falls back to the raw string when the URL
 *  is not a navigable http(s) URL (about:blank, a scheme-less draft) so the tab
 *  still opens — origin enforcement happens at navigation time (WI-2.1). */
export function browserTabUrl(url: string): string {
  return canonicalizeBrowserUrl(url) ?? url;
}

/** The existing browser tab in `windowTabs` with this canonical url, if any. */
export function findBrowserTab(
  windowTabs: Tab[],
  canonicalUrl: string,
  automationMode: BrowserAutomationMode = "human",
): Tab | undefined {
  return windowTabs.find(
    (t) =>
      t.kind === "browser" &&
      t.url === canonicalUrl &&
      (t.automationMode ?? "human") === automationMode,
  );
}

/** Construct a new browser tab record. */
export function makeBrowserTab(
  id: string,
  canonicalUrl: string,
  title?: string,
  automationMode: BrowserAutomationMode = "human",
): BrowserTab {
  const persistPolicy: BrowserPersistPolicy = automationMode === "human" ? "restore-human" : "transient-ai";
  return {
    kind: "browser",
    id,
    url: canonicalUrl,
    title: title ?? canonicalUrl,
    isPinned: false,
    automationMode,
    persistPolicy,
  };
}

/** The mutable fields of a browser tab. `generation` is the driver's navigation
 *  generation for the committed page (WI-2.1). */
export type BrowserTabPatch = Partial<Pick<BrowserTab, "url" | "title" | "scrollY" | "generation">>;

/** The patch's defined fields, canonicalized and narrowed to what actually
 *  differs from `tab` — empty when the patch changes nothing. */
function changedFields(tab: BrowserTab, patch: BrowserTabPatch): BrowserTabPatch {
  const changed: BrowserTabPatch = {};
  // The stored url is the dedup key and must stay canonical, whatever a redirect
  // or a self-driven navigation reported.
  if (patch.url !== undefined) {
    const url = browserTabUrl(patch.url);
    if (url !== tab.url) changed.url = url;
  }
  if (patch.title !== undefined && patch.title !== tab.title) changed.title = patch.title;
  if (patch.scrollY !== undefined && patch.scrollY !== tab.scrollY) changed.scrollY = patch.scrollY;
  if (patch.generation !== undefined && patch.generation !== tab.generation) {
    changed.generation = patch.generation;
  }
  return changed;
}

/**
 * Apply a patch to the matching browser tab. Document tabs and unknown ids pass
 * through untouched (never converts a document tab into a browser tab).
 *
 * Returns the ORIGINAL `tabs` reference when nothing changes — an unknown id, a
 * document tab, an empty patch, or values that already match. Only the affected
 * window's array is cloned; every other window keeps its identity, so a nav event
 * for one browser tab does not re-render the tab strip of every window.
 */
export function patchBrowserTab(
  tabs: Record<string, Tab[]>,
  tabId: string,
  patch: BrowserTabPatch,
): Record<string, Tab[]> {
  for (const [windowLabel, windowTabs] of Object.entries(tabs)) {
    const index = windowTabs.findIndex((t) => t.id === tabId && t.kind === "browser");
    if (index === -1) continue;

    const tab = windowTabs[index] as BrowserTab;

    // A patch that reports an OLDER generation describes a page this tab has already
    // navigated away from — nav events cross the IPC boundary and can arrive out of order,
    // and a late `onLoaded` for the previous page carries its stale generation. The
    // generation only moves forward (Rust bumps it on every commit), so an older one means
    // the patch's url/title/scroll are all stale together. Reject it whole rather than let
    // it regress the tab. A generation-less patch (a scroll update) is not a navigation and
    // is unaffected. (Audit, High.)
    if (
      patch.generation !== undefined &&
      tab.generation !== undefined &&
      patch.generation < tab.generation
    ) {
      return tabs;
    }

    const changed = changedFields(tab, patch);
    if (Object.keys(changed).length === 0) return tabs; // nothing to do

    const nextWindow = [...windowTabs];
    nextWindow[index] = { ...tab, ...changed };
    return { ...tabs, [windowLabel]: nextWindow };
  }
  return tabs; // unknown id, or a document tab
}
