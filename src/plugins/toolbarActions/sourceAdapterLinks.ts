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
import { readClipboardUrl } from "@/utils/clipboardUrl";
import { findWordBoundaries } from "@/utils/wordSegmentation";
import { insertText } from "./sourceAdapterHelpers";

/**
 * Find word boundaries at cursor position in CodeMirror.
 * Returns document positions for the word containing the cursor.
 */
function findWordAtCursorSource(
  view: EditorView,
  pos: number
): { from: number; to: number } | null {
  const line = view.state.doc.lineAt(pos);
  const lineText = line.text;
  const offsetInLine = pos - line.from;

  const boundaries = findWordBoundaries(lineText, offsetInLine);
  if (!boundaries) return null;

  return {
    from: line.from + boundaries.start,
    to: line.from + boundaries.end,
  };
}

/**
 * Insert a link with a known URL, wrapping the text from `from` to `to`.
 * Places cursor at the end of the link.
 */
function insertLinkWithUrl(
  view: EditorView,
  from: number,
  to: number,
  url: string
): void {
  const linkText = view.state.doc.sliceString(from, to);
  const markdown = `[${linkText}](${url})`;

  view.dispatch({
    changes: { from, to, insert: markdown },
    selection: { anchor: from + markdown.length },
  });
  view.focus();
}

/**
 * Insert a link template with cursor positioned in the URL part.
 * Used when no clipboard URL is available.
 */
function insertLinkTemplate(
  view: EditorView,
  from: number,
  to: number
): void {
  const linkText = view.state.doc.sliceString(from, to);
  const template = `[${linkText}](url)`;
  // Position cursor at start of "url"
  const cursorPos = from + linkText.length + 3; // After "[text]("

  view.dispatch({
    changes: { from, to, insert: template },
    selection: { anchor: cursorPos, head: cursorPos + 3 }, // Select "url"
  });
  view.focus();
}

/**
 * Insert a markdown hyperlink with smart clipboard URL detection.
 *
 * Behavior:
 * - Has selection + clipboard URL → [selection](clipboard_url)
 * - Has selection, no URL → [selection](url) with cursor in url
 * - No selection, word at cursor + clipboard URL → [word](clipboard_url)
 * - No selection, word at cursor, no URL → [word](url) with cursor in url
 * - No selection, no word + clipboard URL → [](clipboard_url) with cursor in text
 * - No selection, no word, no URL → [](url) with cursor in text
 */
export async function insertLink(view: EditorView): Promise<boolean> {
  const clipboardUrl = await readClipboardUrl();
  const { from, to } = view.state.selection.main;

  // Case 1: Has selection
  if (from !== to) {
    if (clipboardUrl) {
      insertLinkWithUrl(view, from, to, clipboardUrl);
    } else {
      // Use existing format behavior: wrap and position cursor in URL
      applyFormat(view, "link");
    }
    return true;
  }

  // Case 2: No selection - try word expansion
  const wordRange = findWordAtCursorSource(view, from);
  if (wordRange) {
    if (clipboardUrl) {
      insertLinkWithUrl(view, wordRange.from, wordRange.to, clipboardUrl);
    } else {
      insertLinkTemplate(view, wordRange.from, wordRange.to);
    }
    return true;
  }

  // Case 3: No selection, no word at cursor
  if (clipboardUrl) {
    // Insert [](clipboardUrl) with cursor in text position
    const text = `[](${clipboardUrl})`;
    const cursorOffset = 1; // After "["
    insertText(view, text, cursorOffset);
  } else {
    // Insert [](url) with cursor in text position
    const text = "[](url)";
    const cursorOffset = 1; // After "["
    insertText(view, text, cursorOffset);
  }
  return true;
}

/**
 * Synchronous version of insertLink for use in keymap handlers.
 * Fires the async insertLink and returns true immediately.
 */
export function insertLinkSync(view: EditorView): boolean {
  void insertLink(view);
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

/**
 * Find inline math ($...$) range around cursor position.
 * Returns the range including delimiters, or null if not inside math.
 */
function findInlineMathAtCursor(view: EditorView, pos: number): { from: number; to: number; content: string } | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineText = line.text;
  const lineStart = line.from;

  // Find all $...$ pairs in the line (including empty $$)
  let i = 0;
  while (i < lineText.length) {
    if (lineText[i] === "$") {
      const start = i;
      // Find closing $ (not escaped)
      let j = i + 1;
      while (j < lineText.length) {
        if (lineText[j] === "$" && (j === start + 1 || lineText[j - 1] !== "\\")) {
          // Found a pair from start to j
          const mathFrom = lineStart + start;
          const mathTo = lineStart + j + 1;
          // Check if cursor is inside this range
          if (pos >= mathFrom && pos <= mathTo) {
            return {
              from: mathFrom,
              to: mathTo,
              content: lineText.slice(start + 1, j),
            };
          }
          i = j + 1;
          break;
        }
        j++;
      }
      if (j >= lineText.length) {
        // No closing $ found
        i++;
      }
    } else {
      i++;
    }
  }
  return null;
}

/**
 * Insert or toggle inline math with word expansion.
 *
 * Behavior:
 * - Cursor inside $...$ → unwrap (remove delimiters)
 * - Has selection → wrap in $...$, cursor after
 * - No selection, word at cursor → wrap word in $...$, cursor after
 * - No selection, no word → insert $$, cursor between
 */
export function insertInlineMath(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;

  // Check if cursor is inside inline math - toggle off (unwrap)
  if (from === to) {
    const mathRange = findInlineMathAtCursor(view, from);
    if (mathRange) {
      // Unwrap: replace $content$ with content
      view.dispatch({
        changes: { from: mathRange.from, to: mathRange.to, insert: mathRange.content },
        selection: { anchor: mathRange.from + mathRange.content.length },
      });
      view.focus();
      return true;
    }
  }

  // Case 1: Has selection - wrap in $...$
  if (from !== to) {
    const selectedText = view.state.doc.sliceString(from, to);
    const math = `$${selectedText}$`;
    view.dispatch({
      changes: { from, to, insert: math },
      selection: { anchor: from + math.length },
    });
    view.focus();
    return true;
  }

  // Case 2: No selection - try word expansion
  const wordRange = findWordAtCursorSource(view, from);
  if (wordRange) {
    const wordText = view.state.doc.sliceString(wordRange.from, wordRange.to);
    const math = `$${wordText}$`;
    view.dispatch({
      changes: { from: wordRange.from, to: wordRange.to, insert: math },
      selection: { anchor: wordRange.from + math.length },
    });
    view.focus();
    return true;
  }

  // Case 3: No selection, no word - insert $$ with cursor between
  view.dispatch({
    changes: { from, to, insert: "$$" },
    selection: { anchor: from + 1 }, // cursor between the two $
  });
  view.focus();
  return true;
}
