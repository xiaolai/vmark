/**
 * Source Editor Pending Navigation
 *
 * Purpose: Consumes deferred navigation targets for the CodeMirror source
 * editor — a pending lint scroll (set when switching to Source mode for a
 * sourceOnly diagnostic) and a pending content-search jump (set when opening
 * a file from Find in Files or a terminal file link). Extracted from
 * SourceEditor.tsx, which needed the identical block in both its mount and
 * hidden→visible paths.
 *
 * Returns whether it consumed anything, because a consumed jump OWNS the
 * viewport and the caller must then skip its own restore (#1249).
 *
 * @coordinates-with SourceEditor.tsx — calls this after focus/cursor restore
 * @coordinates-with services/lint/lintNavigation.ts — pending lint-scroll source
 * @coordinates-with services/navigation/contentSearchNavigation.ts — pending search-nav source
 * @module components/Editor/sourcePendingNav
 */

import { EditorView } from "@codemirror/view";
import { consumePendingLintScroll } from "@/services/lint/lintNavigation";
import {
  consumePendingContentSearchNav,
  openFindBarWithQuery,
} from "@/services/navigation/contentSearchNavigation";

/** Delay before pre-filling the FindBar, letting the scroll settle first. */
const FIND_BAR_DELAY_MS = 100;

/**
 * Consume any pending lint-scroll and content-search navigation for `tabId`,
 * scrolling/selecting in `view`. Call after the editor has been focused.
 *
 * Returns TRUE when a navigation was consumed, i.e. when this jump now owns the
 * viewport. The caller must then skip its own cursor/scroll restore: the
 * reading-position restore watches the container for up to ~1.5s while late
 * content settles, so a restore started alongside a jump would drag the reader
 * off the line they asked for (the WYSIWYG side has always been ordered this
 * way — see `consumeWysiwygPendingNav`).
 */
export function consumeSourcePendingNav(
  view: EditorView,
  tabId: string | undefined,
): boolean {
  if (!tabId) return false;
  let consumed = false;

  // Pending lint scroll (set when switching to Source mode for a sourceOnly diagnostic)
  const pendingOffset = consumePendingLintScroll(tabId);
  if (pendingOffset !== undefined) {
    consumed = true;
    view.dispatch({
      effects: EditorView.scrollIntoView(
        Math.min(pendingOffset, view.state.doc.length),
      ),
    });
  }

  // Pending content search nav (set when opening a file from Find in Files)
  const pendingNav = consumePendingContentSearchNav(tabId);
  if (pendingNav) {
    consumed = true;
    const line = Math.min(pendingNav.line, view.state.doc.lines);
    const lineInfo = view.state.doc.line(line);
    view.dispatch({
      selection: { anchor: lineInfo.from },
      effects: EditorView.scrollIntoView(lineInfo.from),
    });
    // Pre-fill the FindBar only when there is a query — a file-link line jump
    // passes an empty query and just scrolls.
    if (pendingNav.query) {
      setTimeout(() => openFindBarWithQuery(pendingNav.query), FIND_BAR_DELAY_MS);
    }
  }

  return consumed;
}
