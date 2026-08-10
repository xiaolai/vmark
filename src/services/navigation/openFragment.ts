/**
 * Purpose: land on a heading anchor after a cross-file link opens the file.
 *
 * `foo.md#heading` opened at the top of the document. The fragment was stripped
 * at the link layer ("the open-file event takes a plain path") and nothing
 * carried it further — while lint rule W04 validated the very anchor the app
 * then discarded. Same-document `#anchor` always worked, which is what made the
 * gap easy to miss.
 *
 * The hard part is TIMING, not navigation: `handleOpenFile` resolves before the
 * tab's editor has mounted, so there is nothing to scroll yet. Rather than poll
 * until a timeout — the shape that looks fine locally and flakes on a large
 * document — this reuses the retry owner the menu dispatcher already uses for
 * exactly this "editor not mounted yet" case. Retries are per-window, so a
 * window teardown cancels them, and they stop as soon as the heading is found.
 *
 * A missing heading is not an error. A link may point at an anchor that no
 * longer exists, and the file still opened; the document simply stays at the
 * top rather than reporting a failure the user cannot act on.
 *
 * @coordinates-with services/navigation/openFileEvent.ts — carries the fragment
 * @coordinates-with services/editor/editorActionOwner.ts — the retry timers
 * @coordinates-with services/editor/scrollPosition.ts — cancels a reading-position
 *   restore, whose watch window overlaps this one's retries (#1249)
 * @coordinates-with utils/headingSlug.ts — navigateToHeadingById
 * @module services/navigation/openFragment
 */

import { useEditorStore } from "@/stores/editorStore";
import { getEditorActionOwner } from "@/services/editor/editorActionOwner";
import { navigateToHeadingById } from "@/utils/headingSlug";
import { cancelEditorScrollRestore } from "@/services/editor/scrollPosition";
import { fileOpsError } from "@/utils/debug";

/**
 * How many times to re-check for a mounted editor.
 *
 * The owner's delay is 50 ms, so this spans roughly a second — long enough for
 * a large document to parse and mount, short enough that a genuinely absent
 * heading stops costing timers.
 */
const MAX_FRAGMENT_RETRIES = 20;

/** Try once. `false` means "not ready or not found", never "error". */
function tryNavigate(fragment: string): boolean {
  // The ACTIVE editor, not the tiptap slice: the fragment belongs to the
  // document that was just opened and activated, and reading the slice would
  // navigate whatever happened to be mounted last.
  const view = useEditorStore.getState().active.activeWysiwygEditor?.view;
  if (!view) return false;
  try {
    // This jump owns the viewport now. A reading-position restore (#1249) holds
    // the container for up to ~1.5s after a mount, which overlaps this retry
    // window, so the handoff is explicit rather than last-writer-wins.
    cancelEditorScrollRestore();
    return navigateToHeadingById(view, fragment);
  } catch (error) {
    fileOpsError("Fragment navigation failed:", error);
    return true; // stop retrying — the editor is there, the attempt threw
  }
}

/**
 * Navigate to `fragment` once the window's editor has the document mounted.
 *
 * Returns immediately; the work continues on the window's retry owner.
 */
export function navigateToFragmentWhenReady(windowLabel: string, fragment: string): void {
  if (!fragment) return;
  if (tryNavigate(fragment)) return;

  const owner = getEditorActionOwner(windowLabel);
  let attempts = 0;
  const retry = (): void => {
    attempts += 1;
    // A window teardown disposes the owner; a queued callback must not run
    // against a torn-down window's store.
    if (owner.isDisposed()) return;
    if (tryNavigate(fragment)) return;
    if (attempts < MAX_FRAGMENT_RETRIES) owner.scheduleRetry(retry);
  };
  owner.scheduleRetry(retry);
}
