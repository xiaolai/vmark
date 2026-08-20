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
import { openFileInNewTabCore, type OpenOutcome } from "@/services/navigation/fileOpen";
import { fileOpsWarn } from "@/utils/debug";

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
): Promise<OpenOutcome> {
  try {
    return await openFileInNewTabCore(windowLabel, path);
  } catch (error) {
    // A REJECTION (not a handled failure) — e.g. a native size dialog throwing.
    // Swallowed per path on purpose: this used to propagate out of the caller's
    // loop and abandon every remaining startup file, so one bad path lost the
    // rest of the user's launch arguments.
    fileOpsWarn(`Startup open threw for ${path}:`, error);
    return "failed";
  }
}

/**
 * Open every startup path, then decide ONCE whether the window needs a blank
 * tab — never per file.
 *
 * Three defects lived in the per-file version, all of them the same mistake:
 * inferring what happened from a tab COUNT taken after an await.
 *
 *   - a first path that failed created a blank tab, and a later path that
 *     succeeded then opened beside it, leaving the orphan the count was
 *     supposed to prevent;
 *   - `closed` — the user shutting the tab or window mid-read — looks
 *     identical to `failed` in a count, so the fallback resurrected a tab
 *     against a deliberate action, defeating the close-during-read guard in
 *     `openFileInNewTabCore`;
 *   - a rejection aborted the whole batch.
 *
 * Outcomes, not counts: the fallback fires only if nothing opened AND the user
 * did not close anything. `ensureBlankTab` is itself a no-op when the window
 * already has tabs, so the count check is a second line of defence, not the
 * decision.
 */
export async function loadStartupFilesIntoTabs(
  windowLabel: string,
  paths: readonly string[],
): Promise<void> {
  // Nothing was ASKED for, so there is nothing to fall back from. Without this
  // an empty workspace `lastOpenTabs` would reach the count check and force the
  // blank tab that workspace mode deliberately does not create.
  if (paths.length === 0) return;

  const outcomes: OpenOutcome[] = [];
  for (const path of paths) {
    outcomes.push(await loadStartupFileIntoTab(windowLabel, path));
  }
  const anyLanded = outcomes.some((o) => o === "opened" || o === "deduped");
  const userClosed = outcomes.includes("closed");
  if (anyLanded || userClosed) return;
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
