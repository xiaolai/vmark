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
import type { Tab, BrowserTab } from "./tabStoreTypes";

/** Canonical URL for a browser tab; falls back to the raw string when the URL
 *  is not a navigable http(s) URL (about:blank, a scheme-less draft) so the tab
 *  still opens — origin enforcement happens at navigation time (WI-2.1). */
export function browserTabUrl(url: string): string {
  return canonicalizeBrowserUrl(url) ?? url;
}

/** The existing browser tab in `windowTabs` with this canonical url, if any. */
export function findBrowserTab(windowTabs: Tab[], canonicalUrl: string): Tab | undefined {
  return windowTabs.find((t) => t.kind === "browser" && t.url === canonicalUrl);
}

/** Construct a new browser tab record. */
export function makeBrowserTab(id: string, canonicalUrl: string, title?: string): BrowserTab {
  return { kind: "browser", id, url: canonicalUrl, title: title ?? canonicalUrl, isPinned: false };
}

/** Apply a url/title/scrollY patch to the matching browser tab across every
 *  window. Document tabs and unknown ids pass through untouched (never converts
 *  a document tab into a browser tab). */
export function patchBrowserTab(
  tabs: Record<string, Tab[]>,
  tabId: string,
  patch: { url?: string; title?: string; scrollY?: number; generation?: number },
): Record<string, Tab[]> {
  const next = { ...tabs };
  for (const windowLabel of Object.keys(next)) {
    next[windowLabel] = next[windowLabel].map((t) =>
      t.id === tabId && t.kind === "browser"
        ? {
            ...t,
            ...(patch.url !== undefined ? { url: patch.url } : {}),
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.scrollY !== undefined ? { scrollY: patch.scrollY } : {}),
            // The driver's navigation generation for the committed page (WI-2.1).
            ...(patch.generation !== undefined ? { generation: patch.generation } : {}),
          }
        : t,
    );
  }
  return next;
}
