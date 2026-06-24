/**
 * Startup file open
 *
 * Purpose: Opens launch-argument / restored files into a freshly-created
 *   document window during WindowProvider bootstrap. Delegates the actual open
 *   to the shared {@link openFileInNewTabCore} (size routing, dedupe guard,
 *   close-during-read guard, ownership, recents, large-file source marking) so
 *   the startup path can't drift from the runtime open paths — while preserving
 *   the startup-only invariant that the window always ends up with at least one
 *   live document (a refused/failed open must not leave a blank, tabless
 *   window).
 *
 * @coordinates-with useFileOpen.ts — openFileInNewTabCore does the heavy lifting
 * @coordinates-with WindowContext.tsx — sole production caller (init effect)
 * @module contexts/startupFileOpen
 */

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { openFileInNewTabCore } from "@/hooks/useFileOpen";

/** Create a blank untitled tab so the window has a live document. */
function ensureBlankTab(windowLabel: string): void {
  const tabId = useTabStore.getState().createTab(windowLabel, null);
  useDocumentStore.getState().initDocument(tabId, "", null);
}

/**
 * Open one launch-arg/restored file into the window via the shared core, then
 * guarantee the window is non-empty.
 *
 * The shared core:
 *   - refuses oversized files (creating no tab),
 *   - dedupes to an existing tab for the same path (NOT overwriting its
 *     possibly-dirty content — the bug the old inline copy had),
 *   - applies file ownership / read-only conflict handling,
 *   - detaches the orphan tab on read failure.
 *
 * After it returns, if the window has no tabs at all (refused / cancelled with
 * nothing else open), add a blank untitled tab so the user never sees a blank,
 * tabless window.
 */
export async function loadStartupFileIntoTab(
  windowLabel: string,
  path: string,
): Promise<void> {
  await openFileInNewTabCore(windowLabel, path);
  if (useTabStore.getState().getTabsByWindow(windowLabel).length === 0) {
    ensureBlankTab(windowLabel);
  }
}

/** Create the fresh-start blank untitled tab (no file, no workspace context). */
export function createBlankStartupTab(windowLabel: string): void {
  ensureBlankTab(windowLabel);
}
