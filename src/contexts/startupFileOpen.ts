/**
 * Startup file open
 *
 * Purpose: Opens launch-argument / restored files into a freshly-created
 *   document window during WindowProvider bootstrap. Delegates the actual open
 *   to the shared {@link openFileInNewTabCore} (size routing, dedupe guard,
 *   close-during-read guard, ownership, recents, large-file source marking) so
 *   the startup path can't drift from the runtime open paths — while preserving
 *   the invariant that a window ASKED TO OPEN A FILE ends up with at least one
 *   live document (a refused/failed open must not leave it blank and tabless).
 *   That invariant is scoped to the file-open path: a launch window with no file
 *   at all is legitimately tabless and renders the WelcomeScreen (#1313).
 *
 * @coordinates-with useFileOpen.ts — openFileInNewTabCore does the heavy lifting
 * @coordinates-with WindowContext.tsx — sole production caller (init effect)
 * @module contexts/startupFileOpen
 */

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { openFileInNewTabCore } from "@/services/navigation/fileOpen";

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

/**
 * Create a blank untitled tab.
 *
 * The #1313 policy — that the LAUNCH window gets no tab and lands on the
 * WelcomeScreen, while an explicitly created `doc-*` window does get one —
 * belongs to the caller (`WindowContext`'s init), which is where the label is
 * known and where it is tested. Deliberately NOT re-encoded here: two copies of
 * one policy is how they drift, and this helper has no view of intent.
 */
export function createBlankStartupTab(windowLabel: string): void {
  ensureBlankTab(windowLabel);
}

/** Parse the `files` URL param (JSON string array) defensively. */
export function parseStartupFilesParam(filesParam: string | null): string[] | null {
  if (!filesParam) return null;
  try {
    const parsed = JSON.parse(filesParam);
    if (Array.isArray(parsed)) {
      // Non-empty: `files=[""]` would otherwise reach the open pipeline as a
      // path and attempt size-routing and a read on "".
      return parsed.filter((value): value is string => typeof value === "string" && value !== "");
    }
  } catch {
    // Malformed param — treated as absent.
  }
  return null;
}
