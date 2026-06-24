import { useTabStore } from "@/stores/tabStore";
import { findExistingTabForPath } from "@/hooks/useReplaceableTab";
import { openFileInNewTabCore } from "@/hooks/useFileOpen";

/**
 * Open a drag-dropped file in a new tab.
 *
 * Delegates the entire open pipeline (size gate → progress indicator → read →
 * document init → ownership → recents → forced-source marking) to the shared
 * {@link openFileInNewTabCore}. The shared core creates the tab BEFORE the read
 * and carries the dedupe + close-during-read guards, so a concurrent open that
 * dedupes to an existing tab can no longer have its content overwritten by this
 * path (the bug the standalone copy had).
 */
export async function openDroppedFileInNewTab(
  windowLabel: string,
  path: string,
): Promise<void> {
  const existingTabId = findExistingTabForPath(windowLabel, path);
  if (existingTabId) {
    useTabStore.getState().setActiveTab(windowLabel, existingTabId);
    return;
  }

  await openFileInNewTabCore(windowLabel, path);
}
