/**
 * Source Link Popup Plugin
 *
 * CodeMirror 6 plugin for editing links in Source mode.
 * Shows a popup when cursor is inside link markdown syntax.
 */

import type { EditorView } from "@codemirror/view";
import { createSourcePopupPlugin } from "@/plugins/sourcePopup";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { SourceLinkPopupView } from "./SourceLinkPopupView";
import { findMarkdownLinkAtPosition } from "@/utils/markdownLinkPatterns";

/**
 * Link range result from detection.
 */
interface LinkRange {
  from: number;
  to: number;
  href: string;
  text: string;
}

/**
 * Find link markdown at cursor position using shared utility.
 * Does NOT match image syntax ![...](...) or wiki-links [[...]]
 */
function findLinkAtPos(view: EditorView, pos: number): LinkRange | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const match = findMarkdownLinkAtPosition(line.text, line.from, pos);

  if (!match) return null;

  // Note: The shared utility uses `pos < to`, but this plugin historically used `pos <= to`.
  // For consistency with hover behavior, we check the boundary again with inclusive end.
  if (pos > match.to) return null;

  return {
    from: match.from,
    to: match.to,
    href: match.url,
    text: match.text,
  };
}

/**
 * Detect trigger for link popup.
 * Returns the link range if cursor is inside a link, null otherwise.
 */
function detectLinkTrigger(view: EditorView): { from: number; to: number } | null {
  const { from, to } = view.state.selection.main;
  if (from !== to) return null;
  const link = findLinkAtPos(view, from);
  if (!link) {
    return null;
  }
  return { from: link.from, to: link.to };
}

/**
 * Extract link data for the popup.
 */
function extractLinkData(
  view: EditorView,
  range: { from: number; to: number }
): { href: string; linkFrom: number; linkTo: number } {
  // Re-run detection to get full data
  const link = findLinkAtPos(view, range.from);
  if (!link) {
    return {
      href: "",
      linkFrom: range.from,
      linkTo: range.to,
    };
  }

  return {
    href: link.href,
    linkFrom: link.from,
    linkTo: link.to,
  };
}

/**
 * Create the Source link popup plugin.
 */
export function createSourceLinkPopupPlugin() {
  return createSourcePopupPlugin({
    store: useLinkPopupStore,
    createView: (view, store) => new SourceLinkPopupView(view, store),
    detectTrigger: detectLinkTrigger,
    detectTriggerAtPos: (view, pos) => {
      const link = findLinkAtPos(view, pos);
      if (!link) return null;
      return { from: link.from, to: link.to };
    },
    extractData: extractLinkData,
    triggerOnClick: true,
    triggerOnHover: true,
    hoverDelay: 300,
    hoverHideDelay: 100,
  });
}
