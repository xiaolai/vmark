/**
 * Source Link Popup Plugin
 *
 * CodeMirror 6 plugin for editing links in Source mode.
 * Click on a link opens the edit popup. Cmd+Click opens the link — a heading,
 * a file in a tab, or a URL in the browser — through the shared `openLinkTarget`.
 */

import { type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { createSourcePopupPlugin } from "@/plugins/sourcePopup";
import { sourceLinkError } from "@/utils/debug";
import type { StoreApi } from "@/plugins/sourcePopup";
import type { LinkPopupState } from "@/plugins/shared/popupPorts";
import { SourceLinkPopupView } from "./SourceLinkPopupView";
import { findMarkdownLinkAtPosition } from "@/utils/markdownLinkPatterns";
import { extractMarkdownHeadings } from "@/plugins/toolbarActions/sourceAdapterLinks";
import { activeFilePathForCurrentWindow } from "@/plugins/shared/hostDocument";
import { openLinkTarget } from "@/services/navigation/linkOpen";

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
 * Extract link data for the popup. Only the pointer trigger calls this, so
 * the popup opens without focus: the user clicked into the markdown to edit
 * it, and the caret must stay there (#1448).
 */
function extractLinkData(
  view: EditorView,
  range: { from: number; to: number }
): { href: string; linkFrom: number; linkTo: number; autoFocus: false } {
  // Re-run detection to get full data
  const link = findLinkAtPos(view, range.from);
  if (!link) {
    return {
      href: "",
      linkFrom: range.from,
      linkTo: range.to,
      autoFocus: false,
    };
  }

  return {
    href: link.href,
    linkFrom: link.from,
    linkTo: link.to,
    autoFocus: false,
  };
}

/**
 * Cmd+Click handler: opens the link under the pointer via the shared
 * `openLinkTarget`. Registered at capture phase so it runs before the popup click
 * handler.
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

        // Fragment → heading, file path → tab, URL → allowlisted opener.
        openLinkTarget(link.href, activeFilePathForCurrentWindow(), this.navigateToHeading).catch(
          /* v8 ignore next -- @preserve reason: openLinkTarget never rejects; defensive */
          (error: unknown) => sourceLinkError("Failed to open link:", error),
        );
      };

      private navigateToHeading = (targetId: string): boolean => {
        const docText = this.view.state.doc.toString();
        const heading = extractMarkdownHeadings(docText).find((h) => h.id === targetId);
        /* v8 ignore next -- @preserve reason: bookmark heading not found is an untested edge case */
        if (!heading || heading.pos === undefined) return false;
        this.view.dispatch({
          selection: { anchor: heading.pos },
          scrollIntoView: true,
        });
        this.view.focus();
        return true;
      };
    }
  );
}

/**
 * Stale-range sync (WI-1 / D1: remap-when-mappable, close-when-destroyed),
 * plus close-when-the-caret-moves-to-another-link.
 *
 * While the popup is open, every doc change — the user typing in the markdown
 * under a click-opened popup (#1448), MCP/AI edits, external reloads — either
 * remaps the tracked `[linkFrom, linkTo)` through the transaction's change
 * mapping or closes the popup. The remap is accepted only when the mapped slice is
 * byte-identical to the pre-change slice — the same link, merely moved. A
 * parse-success check alone would accept a same-length replacement of the
 * whole link and let save rewrite the WRONG link.
 */
function createLinkRangeSyncExtension(store: StoreApi<LinkPopupState>): Extension {
  return EditorView.updateListener.of((update) => {
    const state = store.getState();
    if (!state.isOpen) return;
    if (!update.docChanged) {
      // The caret, left in the markdown by a click-opened popup, moved into a
      // DIFFERENT link: the popup's buttons would still act on the old one.
      // (Leaving links altogether is the popup plugin's delayed close.)
      const at = update.selectionSet ? detectLinkTrigger(update.view) : null;
      if (at && (at.from !== state.linkFrom || at.to !== state.linkTo)) state.closePopup?.();
      return;
    }

    const { linkFrom, linkTo } = state;
    const mappedFrom = update.changes.mapPos(linkFrom, 1);
    const mappedTo = update.changes.mapPos(linkTo, -1);
    const survivedVerbatim =
      mappedFrom < mappedTo &&
      update.state.doc.sliceString(mappedFrom, mappedTo) ===
        update.startState.doc.sliceString(linkFrom, linkTo);

    if (survivedVerbatim && state.setLinkRange) {
      state.setLinkRange(mappedFrom, mappedTo);
    } else {
      // Destroyed, edited in place, or the store cannot record a remap:
      // stale offsets must never survive a doc change (D1 invariant).
      state.closePopup?.();
    }
  });
}

/**
 * Create the Source link popup plugin.
 *
 * Click on a link opens the edit popup. Cmd+Click opens the link.
 */
export function createSourceLinkPopupPlugin(store: StoreApi<LinkPopupState>): Extension {
  return [
    // Cmd+Click handler (capture phase, runs first)
    createCmdClickPlugin(),
    // Doc-change guard: remap the tracked range or close (WI-1 / D1)
    createLinkRangeSyncExtension(store),
    // Popup plugin: opens edit popup on regular click
    /* v8 ignore next -- @preserve reason: createSourcePopupPlugin factory not invoked in unit tests */
    createSourcePopupPlugin({
      store,
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
