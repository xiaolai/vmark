/**
 * Source Adapter Links
 *
 * Link-related toolbar actions for source mode.
 * Handles hyperlinks, wiki links, bookmark links, and reference links.
 */

import type { EditorView } from "@codemirror/view";
import { applyFormat } from "@/plugins/sourceFormatPopup";
import { useHeadingPickerStore } from "@/stores/headingPickerStore";
import { useLinkReferenceDialogStore } from "@/stores/linkReferenceDialogStore";
import { generateSlug, makeUniqueSlug, type HeadingWithId } from "@/utils/headingSlug";
import { insertText } from "./sourceAdapterHelpers";

/**
 * Insert a markdown hyperlink. Wraps selection or inserts template.
 */
export function insertLink(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  if (from !== to) {
    applyFormat(view, "link");
    return true;
  }

  const text = "[](url)";
  const cursorOffset = 3; // inside url
  insertText(view, text, cursorOffset);
  return true;
}

/**
 * Insert wiki-style syntax with optional prefix/suffix.
 * Used for [[wiki links]] and ![[embeds]].
 */
export function insertWikiSyntax(
  view: EditorView,
  prefix: string,
  suffix: string,
  defaultValue: string
): boolean {
  const { from, to } = view.state.selection.main;
  const selectedText = from !== to ? view.state.doc.sliceString(from, to) : "";
  const value = selectedText || defaultValue;
  const text = `${prefix}${value}${suffix}`;
  const cursorOffset = prefix.length + value.length; // position after value, before suffix
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + cursorOffset },
  });
  view.focus();
  return true;
}

/**
 * Extract headings from markdown text with generated IDs.
 * Used for bookmark link picker.
 */
export function extractMarkdownHeadings(text: string): HeadingWithId[] {
  const headings: HeadingWithId[] = [];
  const usedSlugs = new Set<string>();
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  let match;

  while ((match = headingRegex.exec(text)) !== null) {
    const level = match[1].length;
    const headingText = match[2].trim();
    const baseSlug = generateSlug(headingText);
    const id = makeUniqueSlug(baseSlug, usedSlugs);

    if (id) {
      usedSlugs.add(id);
      headings.push({ level, text: headingText, id, pos: match.index });
    }
  }

  return headings;
}

/**
 * Insert a bookmark link to a heading in the document.
 * Opens heading picker and inserts [text](#heading-id) on selection.
 */
export function insertSourceBookmarkLink(view: EditorView): boolean {
  const docText = view.state.doc.toString();
  const headings = extractMarkdownHeadings(docText);

  if (headings.length === 0) {
    return false;
  }

  // Capture selected text for link text fallback (not position-sensitive)
  const { from, to } = view.state.selection.main;
  const capturedSelectedText = from !== to ? view.state.doc.sliceString(from, to) : "";

  useHeadingPickerStore.getState().openPicker(headings, (id, text) => {
    // Re-read current state to get fresh positions (doc may have changed)
    const { from: currentFrom, to: currentTo } = view.state.selection.main;
    const linkText = capturedSelectedText || text;
    const markdown = `[${linkText}](#${id})`;

    view.dispatch({
      changes: { from: currentFrom, to: currentTo, insert: markdown },
      selection: { anchor: currentFrom + markdown.length },
    });
    view.focus();
  });

  return true;
}

/**
 * Insert a reference link with definition.
 * Opens dialog and inserts [text][ref] at cursor, [ref]: url at doc end.
 */
export function insertSourceReferenceLink(view: EditorView): boolean {
  // Capture selected text for link text fallback (not position-sensitive)
  const { from, to } = view.state.selection.main;
  const capturedSelectedText = from !== to ? view.state.doc.sliceString(from, to) : "";

  useLinkReferenceDialogStore.getState().openDialog(capturedSelectedText, (identifier, url, title) => {
    // Re-read current state to get fresh positions (doc may have changed)
    const { from: currentFrom, to: currentTo } = view.state.selection.main;
    const linkText = capturedSelectedText || identifier;
    const reference = `[${linkText}][${identifier}]`;
    const definition = title
      ? `[${identifier}]: ${url} "${title}"`
      : `[${identifier}]: ${url}`;

    // Insert reference at cursor, definition at end of document
    const docLength = view.state.doc.length;
    const needsNewline = docLength > 0 && view.state.doc.sliceString(docLength - 1) !== "\n";

    view.dispatch({
      changes: [
        { from: currentFrom, to: currentTo, insert: reference },
        { from: docLength, insert: `${needsNewline ? "\n" : ""}\n${definition}` },
      ],
      selection: { anchor: currentFrom + reference.length },
    });
    view.focus();
  });

  return true;
}
