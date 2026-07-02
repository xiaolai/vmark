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
 * @coordinates-with SourceEditor.tsx — calls this after focus/cursor restore
 * @coordinates-with hooks/lintNavigation.ts — pending lint-scroll source
 * @coordinates-with hooks/contentSearchNavigation.ts — pending search-nav source
 * @module components/Editor/sourcePendingNav
 */

import { EditorView } from "@codemirror/view";
import { consumePendingLintScroll } from "@/hooks/lintNavigation";
import {
  consumePendingContentSearchNav,
  openFindBarWithQuery,
} from "@/hooks/contentSearchNavigation";

/** Delay before pre-filling the FindBar, letting the scroll settle first. */
const FIND_BAR_DELAY_MS = 100;

/**
 * Consume any pending lint-scroll and content-search navigation for `tabId`,
 * scrolling/selecting in `view`. Call after the editor has been focused and
 * its cursor restored (both the mount and the hidden→visible paths).
 */
export function consumeSourcePendingNav(
  view: EditorView,
  tabId: string | undefined,
): void {
  if (!tabId) return;

  // Pending lint scroll (set when switching to Source mode for a sourceOnly diagnostic)
  const pendingOffset = consumePendingLintScroll(tabId);
  if (pendingOffset !== undefined) {
    view.dispatch({
      effects: EditorView.scrollIntoView(
        Math.min(pendingOffset, view.state.doc.length),
      ),
    });
  }

  // Pending content search nav (set when opening a file from Find in Files)
  const pendingNav = consumePendingContentSearchNav(tabId);
  if (pendingNav) {
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
}
