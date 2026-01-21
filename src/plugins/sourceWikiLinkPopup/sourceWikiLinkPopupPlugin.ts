/**
 * Source Wiki Link Popup Plugin
 *
 * CodeMirror 6 plugin for editing wiki links in Source mode.
 * Shows a popup when cursor is inside wiki link syntax ([[target]] or [[target|alias]]).
 */

import type { EditorView } from "@codemirror/view";
import { createSourcePopupPlugin } from "@/plugins/sourcePopup";
import { useWikiLinkPopupStore } from "@/stores/wikiLinkPopupStore";
import { SourceWikiLinkPopupView } from "./SourceWikiLinkPopupView";

/**
 * Wiki link range result from detection.
 */
interface WikiLinkRange {
  from: number;
  to: number;
  target: string;
  alias: string;
}

/**
 * Find wiki link markdown at cursor position.
 * Detects: [[target]] or [[target|alias]]
 */
function findWikiLinkAtPos(view: EditorView, pos: number): WikiLinkRange | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineText = line.text;
  const lineStart = line.from;

  // Regex to match wiki link syntax:
  // [[target]] or [[target|alias]]
  // Captures: [1] = target, [2] = alias (optional)
  const wikiLinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

  let match;
  while ((match = wikiLinkRegex.exec(lineText)) !== null) {
    const matchStart = lineStart + match.index;
    const matchEnd = matchStart + match[0].length;

    // Check if cursor is inside this wiki link markdown
    if (pos >= matchStart && pos <= matchEnd) {
      const target = match[1];
      const alias = match[2] || "";

      return {
        from: matchStart,
        to: matchEnd,
        target,
        alias,
      };
    }
  }

  return null;
}

/**
 * Detect trigger for wiki link popup.
 * Returns the wiki link range if cursor is inside a wiki link, null otherwise.
 */
function detectWikiLinkTrigger(view: EditorView): { from: number; to: number } | null {
  const { from, to } = view.state.selection.main;
  if (from !== to) return null;
  const wikiLink = findWikiLinkAtPos(view, from);
  if (!wikiLink) {
    return null;
  }
  return { from: wikiLink.from, to: wikiLink.to };
}

/**
 * Extract wiki link data for the popup.
 */
function extractWikiLinkData(
  view: EditorView,
  range: { from: number; to: number }
): { target: string; nodePos: number } {
  // Re-run detection to get full data
  const wikiLink = findWikiLinkAtPos(view, range.from);
  if (!wikiLink) {
    return {
      target: "",
      nodePos: range.from,
    };
  }

  return {
    target: wikiLink.target,
    nodePos: wikiLink.from,
  };
}

/**
 * Create the Source wiki link popup plugin.
 */
export function createSourceWikiLinkPopupPlugin() {
  return createSourcePopupPlugin({
    store: useWikiLinkPopupStore,
    createView: (view, store) => new SourceWikiLinkPopupView(view, store),
    detectTrigger: detectWikiLinkTrigger,
    detectTriggerAtPos: (view, pos) => {
      const wikiLink = findWikiLinkAtPos(view, pos);
      if (!wikiLink) return null;
      return { from: wikiLink.from, to: wikiLink.to };
    },
    extractData: extractWikiLinkData,
    openPopup: ({ anchorRect, data }) => {
      useWikiLinkPopupStore.getState().openPopup(anchorRect, data.target, data.nodePos);
    },
    triggerOnClick: true,
    triggerOnHover: true,
    hoverDelay: 300,
    hoverHideDelay: 100,
  });
}
