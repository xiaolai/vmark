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
import { expandedToggleMark as expandedToggleMarkTiptap } from "@/plugins/editorPlugins/expandedToggleMark";
import { resolveLinkPopupPayload } from "@/plugins/formatToolbar/linkPopupUtils";
import { findMarkRange, findWordAtCursor } from "@/plugins/syntaxReveal/marks";
import type { LinkInfo } from "@/plugins/toolbarContext/types";
import { hostPopups } from "@/plugins/shared/hostPopups";
import { readClipboardUrl } from "@/services/editor/clipboardUrl";
import { wysiwygAdapterWarn, wysiwygAdapterError } from "@/utils/debug";
import { isViewConnected } from "./wysiwygAdapterUtils";
import type { WysiwygToolbarContext } from "./types";
import { errorMessage } from "@/utils/errorMessage";

/**
 * Apply a link mark with a specific href to a range.
 */
function applyLinkWithUrl(view: EditorView, from: number, to: number, url: string): void {
  const { state, dispatch } = view;
  const linkMark = state.schema.marks.link;
  /* v8 ignore next -- @preserve link mark is always registered in Tiptap schema; null branch is defensive */
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
  /* v8 ignore next -- @preserve link mark is always registered in Tiptap schema; null branch is defensive */
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
    wysiwygAdapterWarn("View disconnected after clipboard read");
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
/**
 * The link at the caret, derived from the LIVE view. The keyboard + native-menu
 * path runs through `runEditorAction`, which passes `context.context === null` —
 * so `context.context?.inLink` is unavailable there. Without it an existing link
 * under a collapsed caret would be misread as plain text: Mod-K would overwrite
 * it (clipboard) or toggle it off instead of opening its editor. Deriving the
 * link info from `view.state` makes the executor path match the toolbar path.
 * Only `href`/`from`/`to` are consumed downstream; the rest mirror the range.
 */
function getLinkInfoAtCursor(view: EditorView): LinkInfo | null {
  const linkType = view.state.schema.marks.link;
  if (!linkType) return null;
  const { $from } = view.state.selection;
  const linkMark = $from.marks().find((m) => m.type === linkType);
  if (!linkMark) return null;
  const range = findMarkRange($from.pos, linkMark, $from.start(), $from.parent);
  if (!range) return null;
  const href = String(linkMark.attrs.href ?? "");
  const text = view.state.doc.textBetween(range.from, range.to);
  return {
    href,
    text,
    from: range.from,
    to: range.to,
    contentFrom: range.from,
    contentTo: range.to,
  };
}

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

      hostPopups.openWikiLinkPopup({
        anchorRect: {
          top: coords.top,
          left: coords.left,
          bottom: coords.bottom,
          right: endCoords.right,
        },
        target: String(wikiLink.node.attrs.value ?? ""),
        nodePos: wikiLink.pos,
      });
      view.focus();
    } catch (error) {
      wysiwygAdapterError("Failed to open wiki link popup:", error);
    }
    return true;
  }

  // Toolbar path supplies the LinkInfo; the executor/keyboard path passes null,
  // so derive it from the live view. Only need truthiness for the clipboard gate.
  const linkInfo = context.context?.inLink ?? getLinkInfoAtCursor(view);
  const inLink = !!linkInfo;

  // Try smart link insertion first (async, fires and forgets)
  void trySmartLinkInsertion(view, inLink).then((handled) => {
    if (handled) return;

    // Verify view is still connected before fallback
    if (!isViewConnected(view)) {
      wysiwygAdapterWarn("View disconnected, skipping link popup");
      return;
    }

    // Fall back to popup or word expansion
    const selection = view.state.selection;
    const payload = resolveLinkPopupPayload(
      { from: selection.from, to: selection.to },
      context.context?.inLink ?? linkInfo
    );

    if (!payload) {
      expandedToggleMarkTiptap(view, "link");
      return;
    }

    try {
      const start = view.coordsAtPos(payload.linkFrom);
      const end = view.coordsAtPos(payload.linkTo);

      hostPopups.openLinkPopup({
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
      wysiwygAdapterError("Failed to open link popup:", error);
      expandedToggleMarkTiptap(view, "link");
    }
  /* v8 ignore start -- @preserve reason: .catch() callback only fires on unexpected promise rejections; not triggered in tests */
  }).catch((error) => {
    wysiwygAdapterWarn("Link insertion failed:", errorMessage(error));
  });
  /* v8 ignore stop */

  return true;
}
