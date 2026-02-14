/**
 * WYSIWYG Adapter - Link Editor
 *
 * Purpose: Handles the "link" toolbar action — smart link insertion with
 * clipboard URL detection, wiki-link popup opening, and fallback to the
 * standard link popup editor.
 *
 * @coordinates-with wysiwygAdapter.ts — main dispatcher delegates link action here
 * @coordinates-with wysiwygAdapterLinks.ts — wiki link / bookmark link insertion
 * @coordinates-with linkPopupStore.ts — opens the link editing popup
 * @coordinates-with wikiLinkPopupStore.ts — opens the wiki link editing popup
 * @module plugins/toolbarActions/wysiwygAdapterLinkEditor
 */
import type { EditorView } from "@tiptap/pm/view";
import { expandedToggleMarkTiptap } from "@/plugins/editorPlugins.tiptap";
import { resolveLinkPopupPayload } from "@/plugins/formatToolbar/linkPopupUtils";
import { findWordAtCursor } from "@/plugins/syntaxReveal/marks";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { useWikiLinkPopupStore } from "@/stores/wikiLinkPopupStore";
import { readClipboardUrl } from "@/utils/clipboardUrl";
import { isViewConnected } from "./wysiwygAdapterUtils";
import type { WysiwygToolbarContext } from "./types";

/**
 * Apply a link mark with a specific href to a range.
 */
function applyLinkWithUrl(view: EditorView, from: number, to: number, url: string): void {
  const { state, dispatch } = view;
  const linkMark = state.schema.marks.link;
  if (!linkMark) return;

  const tr = state.tr.addMark(from, to, linkMark.create({ href: url }));
  dispatch(tr);
  view.focus();
}

/**
 * Insert a new text node with link mark when no selection exists.
 */
function insertLinkAtCursor(view: EditorView, url: string): void {
  const { state, dispatch } = view;
  const linkMark = state.schema.marks.link;
  if (!linkMark) return;

  const { from } = state.selection;
  const textNode = state.schema.text(url, [linkMark.create({ href: url })]);
  const tr = state.tr.insert(from, textNode);
  dispatch(tr);
  view.focus();
}

/**
 * Find wiki link node at the cursor position.
 * Returns { pos, node } if cursor is inside a wikiLink, null otherwise.
 */
function findWikiLinkAtCursor(view: EditorView): { pos: number; node: import("@tiptap/pm/model").Node } | null {
  const { state } = view;
  const { $from } = state.selection;

  // Check if cursor is inside a wikiLink node by walking up the tree
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "wikiLink") {
      return { pos: $from.before(d), node };
    }
  }

  return null;
}

/**
 * Smart link insertion with clipboard URL detection.
 * Returns true if handled, false to fall back to popup.
 */
async function trySmartLinkInsertion(view: EditorView, inLink: boolean): Promise<boolean> {
  // If already in a link, don't use clipboard - let user edit existing link
  if (inLink) return false;

  const clipboardUrl = await readClipboardUrl();
  if (!clipboardUrl) return false;

  // Verify view is still connected after async clipboard read
  if (!isViewConnected(view)) {
    console.warn("[wysiwygAdapter] View disconnected after clipboard read");
    return false;
  }

  // Get current selection (may have changed during async)
  const { from, to } = view.state.selection;

  // Has selection: apply link directly
  if (from !== to) {
    applyLinkWithUrl(view, from, to, clipboardUrl);
    return true;
  }

  // No selection: try word expansion
  const $from = view.state.selection.$from;
  const wordRange = findWordAtCursor($from);
  if (wordRange) {
    applyLinkWithUrl(view, wordRange.from, wordRange.to, clipboardUrl);
    return true;
  }

  // No selection, no word: insert URL as linked text
  insertLinkAtCursor(view, clipboardUrl);
  return true;
}

/**
 * Open the link editor for the current cursor position.
 * Handles wiki links, smart clipboard insertion, and standard link popup.
 */
export function openLinkEditor(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  // Check if cursor is inside a wiki link - if so, open wiki link popup
  const wikiLink = findWikiLinkAtCursor(view);
  if (wikiLink) {
    try {
      const coords = view.coordsAtPos(wikiLink.pos);
      const nodeSize = wikiLink.node.nodeSize;
      const endCoords = view.coordsAtPos(wikiLink.pos + nodeSize);

      useWikiLinkPopupStore.getState().openPopup(
        {
          top: coords.top,
          left: coords.left,
          bottom: coords.bottom,
          right: endCoords.right,
        },
        String(wikiLink.node.attrs.value ?? ""),
        wikiLink.pos
      );
      view.focus();
    } catch (error) {
      console.error("[wysiwygAdapter] Failed to open wiki link popup:", error);
    }
    return true;
  }

  const inLink = !!context.context?.inLink;

  // Try smart link insertion first (async, fires and forgets)
  void trySmartLinkInsertion(view, inLink).then((handled) => {
    if (handled) return;

    // Verify view is still connected before fallback
    if (!isViewConnected(view)) {
      console.warn("[wysiwygAdapter] View disconnected, skipping link popup");
      return;
    }

    // Fall back to popup or word expansion
    const selection = view.state.selection;
    const payload = resolveLinkPopupPayload(
      { from: selection.from, to: selection.to },
      context.context?.inLink ?? null
    );

    if (!payload) {
      expandedToggleMarkTiptap(view, "link");
      return;
    }

    try {
      const start = view.coordsAtPos(payload.linkFrom);
      const end = view.coordsAtPos(payload.linkTo);

      useLinkPopupStore.getState().openPopup({
        href: payload.href,
        linkFrom: payload.linkFrom,
        linkTo: payload.linkTo,
        anchorRect: {
          top: Math.min(start.top, end.top),
          left: Math.min(start.left, end.left),
          bottom: Math.max(start.bottom, end.bottom),
          right: Math.max(start.right, end.right),
        },
      });
      view.focus();
    } catch (error) {
      console.error("[wysiwygAdapter] Failed to open link popup:", error);
      expandedToggleMarkTiptap(view, "link");
    }
  });

  return true;
}
