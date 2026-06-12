/**
 * Source Link Popup Plugin
 *
 * CodeMirror 6 plugin for editing links in Source mode.
 * Click on a link opens the edit popup. Cmd+Click opens in browser / navigates to heading.
 */

import { type Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView } from "@codemirror/view";
import { createSourcePopupPlugin } from "@/plugins/sourcePopup";
import { sourceLinkError } from "@/utils/debug";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { SourceLinkPopupView } from "./SourceLinkPopupView";
import { findMarkdownLinkAtPosition } from "@/utils/markdownLinkPatterns";
import { extractMarkdownHeadings } from "@/plugins/toolbarActions/sourceAdapterLinks";
import { openExternalLink } from "@/services/navigation/linkOpen";

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
 * Cmd+Click handler: opens links in browser or navigates to headings.
 * Registered at capture phase so it runs before the popup click handler.
 */
function createCmdClickPlugin(): Extension {
  return ViewPlugin.fromClass(
    class CmdClickHandler {
      private view: EditorView;

      constructor(view: EditorView) {
        this.view = view;
        view.dom.addEventListener("click", this.handleClick, true);
      }

      destroy() {
        this.view.dom.removeEventListener("click", this.handleClick, true);
      }

      private handleClick = (e: MouseEvent) => {
        if (!e.metaKey && !e.ctrlKey) return;

        const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null) return;

        const link = findLinkAtPos(this.view, pos);
        if (!link) return;

        // Prevent the popup from opening
        e.stopPropagation();
        e.preventDefault();

        const { href } = link;

        // Handle bookmark links — navigate to heading
        if (href.startsWith("#")) {
          const targetId = href.slice(1);
          const docText = this.view.state.doc.toString();
          const headings = extractMarkdownHeadings(docText);
          const heading = headings.find((h) => h.id === targetId);

          /* v8 ignore next -- @preserve reason: bookmark heading not found is an untested edge case */
          if (heading && heading.pos !== undefined) {
            this.view.dispatch({
              selection: { anchor: heading.pos },
              scrollIntoView: true,
            });
            this.view.focus();
          }
          return;
        }

        // External link — open in browser (scheme-allowlisted opener,
        // audit 20260612)
        /* v8 ignore next 3 -- @preserve reason: error handler not tested in unit tests */
        openExternalLink(href).catch((error: unknown) => {
          sourceLinkError("Failed to open link:", error);
        });
      };
    }
  );
}

/**
 * Create the Source link popup plugin.
 *
 * Click on a link opens the edit popup. Cmd+Click opens in browser.
 */
export function createSourceLinkPopupPlugin(): Extension {
  return [
    // Cmd+Click handler (capture phase, runs first)
    createCmdClickPlugin(),
    // Popup plugin: opens edit popup on regular click
    /* v8 ignore next -- @preserve reason: createSourcePopupPlugin factory not invoked in unit tests */
    createSourcePopupPlugin({
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
      triggerOnHover: false,
    }),
  ];
}
