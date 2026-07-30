/**
 * Window-scoped browser-session persistence (WI-8.2 / plan D1).
 *
 * Purpose: browser pages are WINDOW-GLOBAL (never owned by a workspace
 * instance), so their session belongs to the window — not to any workspace
 * config. Only `persistPolicy: "restore-human"` pages persist; AI pages
 * (`transient-ai`) are session-transient by contract.
 *
 * Storage: localStorage, keyed by window label — the same per-machine tier
 * as the split layout. Records reuse the `PersistedBrowserTab` schema and
 * the SAME validation gate (`migratePersistedTabs` → canonical http(s) URLs
 * only, AI records dropped), so workspace-config and window-session browser
 * records cannot drift apart.
 *
 * Restore is once-per-window and NEVER steals activation.
 *
 * @coordinates-with services/workspaces/workspaceSession.ts — save on close
 * @coordinates-with services/persistence/sessionTabs.ts — shared schema/validation
 * @module services/persistence/windowBrowserSession
 */
import { workspaceError } from "@/utils/debug";
import { useTabStore, type Tab } from "@/stores/tabStore";
import { urlForPersistence } from "@/lib/browser/url";
import {
  migratePersistedTabs,
  SESSION_TABS_VERSION,
  type PersistedBrowserTab,
} from "./sessionTabs";

const KEY_PREFIX = "vmark-window-browser-session:";
const keyFor = (windowLabel: string) => `${KEY_PREFIX}${windowLabel}`;

const restoredWindows = new Set<string>();

/** Build the persisted records for the window's restore-human pages. */
export function browserSessionRecordsOf(tabs: readonly Tab[]): PersistedBrowserTab[] {
  return tabs
    .filter((tab) => tab.kind === "browser" && tab.persistPolicy === "restore-human")
    .map((tab) => {
      const rec: PersistedBrowserTab = {
        kind: "browser",
        url: urlForPersistence((tab as { url: string }).url),
        title: (tab as { title: string }).title,
      };
      const scrollY = (tab as { scrollY?: number }).scrollY;
      if (typeof scrollY === "number" && Number.isFinite(scrollY) && scrollY >= 0) {
        rec.scrollY = scrollY;
      }
      return rec;
    });
}

/** Serialize the window's restore-human browser pages (newest schema). */
export function saveWindowBrowserSession(windowLabel: string, tabs: readonly Tab[]): void {
  try {
    const records = browserSessionRecordsOf(tabs);
    if (records.length === 0) {
      localStorage.removeItem(keyFor(windowLabel));
      return;
    }
    localStorage.setItem(
      keyFor(windowLabel),
      JSON.stringify({ version: SESSION_TABS_VERSION, tabs: records }),
    );
  } catch (error) {
    workspaceError("Failed to save window browser session:", error);
  }
}

/** Load and VALIDATE the window's persisted browser records. */
export function loadWindowBrowserSession(windowLabel: string): PersistedBrowserTab[] {
  try {
    const raw = localStorage.getItem(keyFor(windowLabel));
    if (!raw) return [];
    const payload = JSON.parse(raw) as unknown;
    return migratePersistedTabs(payload, null, { browserSupported: true }).filter(
      (rec): rec is PersistedBrowserTab => rec.kind === "browser",
    );
  } catch (error) {
    workspaceError("Failed to load window browser session:", error);
    return [];
  }
}

/**
 * Recreate the window's persisted human browser pages ONCE, without stealing
 * activation and without duplicating already-open URLs.
 */
export function restoreWindowBrowserSession(windowLabel: string): number {
  if (restoredWindows.has(windowLabel)) return 0;
  restoredWindows.add(windowLabel);

  return restoreBrowserRecords(windowLabel, loadWindowBrowserSession(windowLabel));
}

/** Recreate validated browser records without stealing activation (WI-9.4). */
export function restoreBrowserRecords(
  windowLabel: string,
  records: readonly PersistedBrowserTab[],
): number {
  if (records.length === 0) return 0;

  const tabStore = useTabStore.getState();
  const prevActive = tabStore.activeTabId[windowLabel] ?? null;
  const openUrls = new Set(
    tabStore
      .getTabsByWindow(windowLabel)
      .filter((tab) => tab.kind === "browser")
      .map((tab) => (tab as { url: string }).url),
  );

  let restored = 0;
  for (const rec of records) {
    if (openUrls.has(rec.url)) continue; // no duplicates after hot exit + session
    useTabStore.getState().createBrowserPage(windowLabel, rec.url, rec.title, "human");
    restored++;
  }
  // Restore is background — the human's focused tab must not change.
  if (prevActive !== null) {
    useTabStore.getState().setActiveTab(windowLabel, prevActive);
  }
  return restored;
}

/** Test-only: allow a window to restore again. */
export function resetWindowBrowserSessionRestores(): void {
  restoredWindows.clear();
}
