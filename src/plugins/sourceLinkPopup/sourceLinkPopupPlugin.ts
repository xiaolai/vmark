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
 * Find link markdown at cursor position.
 * Detects: [text](url) or [text](url "title")
 * Does NOT match image syntax ![...](...) or wiki-links [[...]]
 */
function findLinkAtPos(view: EditorView, pos: number): LinkRange | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineText = line.text;
  const lineStart = line.from;

  // Regex to match link syntax (not images):
  // - [text](url) or [text](url "title")
  // - Negative lookbehind for ! to exclude images
  // Note: JS doesn't have lookbehind in all environments, so we check the match index
  // Captures: [1] = text, [2] = url
  const linkRegex = /\[([^\]]*)\]\(([^)\s"]+)(?:\s+"[^"]*")?\)/g;

  let match;
  while ((match = linkRegex.exec(lineText)) !== null) {
    const matchStart = lineStart + match.index;
    const matchEnd = matchStart + match[0].length;

    // Skip if this is an image (preceded by !)
    if (match.index > 0 && lineText[match.index - 1] === "!") {
      continue;
    }

    // Check if cursor is inside this link markdown
    if (pos >= matchStart && pos <= matchEnd) {
      const text = match[1];
      const href = match[2];

      return {
        from: matchStart,
        to: matchEnd,
        href,
        text,
      };
    }
  }

  return null;
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
