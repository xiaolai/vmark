/**
 * WYSIWYG Adapter Links
 *
 * Link-related toolbar actions for WYSIWYG mode.
 * Handles wiki links, wiki embeds, bookmark links, and reference links.
 */

import { useHeadingPickerStore } from "@/stores/headingPickerStore";
import { useLinkReferenceDialogStore } from "@/stores/linkReferenceDialogStore";
import { extractHeadingsWithIds } from "@/utils/headingSlug";
import type { WysiwygToolbarContext } from "./types";

/**
 * Insert a wiki link node at the current selection.
 * Uses selected text as value or defaults to "page".
 */
export function insertWikiLink(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  const { state, dispatch } = view;
  const { from, to } = state.selection;
  const selectedText = from !== to ? state.doc.textBetween(from, to) : "";
  const wikiLinkType = state.schema.nodes.wikiLink;
  if (!wikiLinkType) return false;

  const node = wikiLinkType.create({
    value: selectedText || "page",
    alias: null,
  });

  dispatch(state.tr.replaceSelectionWith(node));
  view.focus();
  return true;
}

/**
 * Insert a wiki embed node at the current selection.
 * Uses selected text as value or defaults to "file".
 */
export function insertWikiEmbed(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  const { state, dispatch } = view;
  const { from, to } = state.selection;
  const selectedText = from !== to ? state.doc.textBetween(from, to) : "";
  const wikiEmbedType = state.schema.nodes.wikiEmbed;
  if (!wikiEmbedType) return false;

  const node = wikiEmbedType.create({
    value: selectedText || "file",
    alias: null,
  });

  dispatch(state.tr.replaceSelectionWith(node));
  view.focus();
  return true;
}

/**
 * Insert a bookmark link to a heading in the document.
 * Opens heading picker and inserts link mark with href="#heading-id".
 */
export function insertBookmarkLink(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  const { state } = view;
  const headings = extractHeadingsWithIds(state.doc);

  if (headings.length === 0) {
    return false;
  }

  // Capture selected text for link text fallback (not position-sensitive)
  const { from, to } = state.selection;
  const capturedSelectedText = from !== to ? state.doc.textBetween(from, to) : "";

  useHeadingPickerStore.getState().openPicker(headings, (id, text) => {
    // Re-read current state to get fresh positions (doc may have changed)
    const currentState = view.state;
    const linkMark = currentState.schema.marks.link;
    if (!linkMark) return;

    const { from: currentFrom, to: currentTo } = currentState.selection;
    const href = `#${id}`;
    const linkText = capturedSelectedText || text;

    // Create link with the heading's ID as href
    const tr = currentState.tr;
    if (currentFrom === currentTo) {
      // No selection - insert new text with link mark
      const textNode = currentState.schema.text(linkText, [linkMark.create({ href })]);
      tr.insert(currentFrom, textNode);
    } else {
      // Has selection - apply link mark to it
      tr.addMark(currentFrom, currentTo, linkMark.create({ href }));
    }

    view.dispatch(tr);
    view.focus();
  });

  return true;
}

/**
 * Insert a reference link with definition.
 * Opens dialog and inserts link_reference node at cursor, link_definition at doc end.
 */
export function insertReferenceLink(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  // Capture selected text for link text fallback (not position-sensitive)
  const { state } = view;
  const { from, to } = state.selection;
  const capturedSelectedText = from !== to ? state.doc.textBetween(from, to) : "";

  useLinkReferenceDialogStore.getState().openDialog(capturedSelectedText, (identifier, url, title) => {
    // Re-read current state to get fresh positions (doc may have changed)
    const currentState = view.state;
    const linkRefType = currentState.schema.nodes.link_reference;
    const linkDefType = currentState.schema.nodes.link_definition;

    if (!linkRefType || !linkDefType) return;

    const { from: currentFrom, to: currentTo } = currentState.selection;
    const tr = currentState.tr;
    const linkText = capturedSelectedText || identifier;

    // Create link reference node with the text
    const textNode = currentState.schema.text(linkText);
    const linkRefNode = linkRefType.create(
      { identifier, referenceType: "full" },
      textNode
    );

    // Insert the link reference at cursor
    if (currentFrom === currentTo) {
      tr.insert(currentFrom, linkRefNode);
    } else {
      tr.replaceWith(currentFrom, currentTo, linkRefNode);
    }

    // Find end of document to insert definition
    const docEnd = tr.doc.content.size;

    // Create link definition node
    const linkDefNode = linkDefType.create({
      identifier,
      url,
      title: title || null,
    });

    // Add newline and definition at end
    tr.insert(docEnd, linkDefNode);

    view.dispatch(tr);
    view.focus();
  });

  return true;
}
