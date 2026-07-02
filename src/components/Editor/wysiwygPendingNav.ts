/**
 * WYSIWYG Pending Navigation
 *
 * Purpose: Consumes a deferred content-search jump (Find in Files / terminal
 * file links) for the Tiptap editor — walks block nodes to map the 1-indexed
 * source line to an approximate document position. Extracted from
 * TiptapEditor.tsx so BOTH the deferred onCreate initialization and the
 * hidden→visible transition consume it: the visibility effect alone dropped
 * the initial navigation because it ran before editor initialization and
 * never re-fired.
 *
 * Key decisions:
 *   - Returns true when navigation was consumed; callers skip their own
 *     focus/cursor restore in that case so the RAF-deferred restore can't
 *     clobber the jump's selection.
 *   - Leaves the pending entry in place when the view isn't ready, so a later
 *     consumer (deferred init, visibility transition, Source mode) still
 *     sees it.
 *
 * @coordinates-with TiptapEditor.tsx — deferred init + visibility transition
 * @coordinates-with hooks/contentSearchNavigation.ts — pending search-nav source
 * @module components/Editor/wysiwygPendingNav
 */

import type { EditorView } from "@tiptap/pm/view";
import { Selection } from "@tiptap/pm/state";
import {
  consumePendingContentSearchNav,
  openFindBarWithQuery,
} from "@/hooks/contentSearchNavigation";
import { contentSearchLog } from "@/utils/debug";

/** Delay before pre-filling the FindBar, letting the scroll settle first. */
const FIND_BAR_DELAY_MS = 100;

/**
 * Consume pending content-search navigation for `tabId`, selecting and
 * scrolling in `view`. Returns true when a pending navigation was consumed.
 */
export function consumeWysiwygPendingNav(
  view: EditorView | null | undefined,
  tabId: string | null | undefined,
): boolean {
  if (!view || !tabId) return false;
  const pendingNav = consumePendingContentSearchNav(tabId);
  if (!pendingNav) return false;

  contentSearchLog("WYSIWYG nav to line", pendingNav.line);
  // Walk the document to find the Nth textblock (lines map roughly to blocks)
  let blockCount = 0;
  let targetPos = 0;
  view.state.doc.descendants((node, pos) => {
    if (node.isBlock && node.isTextblock) {
      blockCount++;
      if (blockCount === pendingNav.line) {
        targetPos = pos;
        return false; // stop walking
      }
    }
    return true;
  });
  if (targetPos > 0) {
    view.dispatch(
      view.state.tr
        .setSelection(Selection.near(view.state.doc.resolve(targetPos)))
        .scrollIntoView(),
    );
  }
  view.focus();

  // Pre-fill the FindBar after a brief delay to let the scroll settle — only
  // when there's a query (a file-link line jump just scrolls).
  if (pendingNav.query) {
    setTimeout(() => openFindBarWithQuery(pendingNav.query), FIND_BAR_DELAY_MS);
  }
  return true;
}
