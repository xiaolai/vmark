/**
 * Source Adapter Links
 *
 * Link-related toolbar actions for source mode.
 * Handles hyperlinks, wiki links, and bookmark links.
 */

import type { EditorView } from "@codemirror/view";
import { applyFormat } from "@/plugins/sourceContextDetection";
import { getAnchorRectFromRange } from "@/plugins/sourcePopup/sourcePopupUtils";
import { useHeadingPickerStore } from "@/stores/headingPickerStore";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { generateSlug, makeUniqueSlug, type HeadingWithId } from "@/utils/headingSlug";
import { getBoundaryRects, getViewportBounds } from "@/utils/popupPosition";
import { readClipboardUrl } from "@/utils/clipboardUrl";
import { findWordBoundaries } from "@/utils/wordSegmentation";
import { insertText } from "./sourceAdapterHelpers";

/**
 * Find word boundaries at cursor position in CodeMirror.
 * Returns document positions for the word containing the cursor.
 */
export function findWordAtCursorSource(
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
 * Link range result from detection.
 */
interface LinkRange {
  from: number;
  to: number;
  href: string;
  text: string;
}

/**
 * Find markdown link at cursor position.
 * Detects: [text](url) or [text](url "title")
 * Does NOT match image syntax ![...](...) or wiki-links [[...]]
 */
function findLinkAtCursor(view: EditorView, pos: number): LinkRange | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineText = line.text;
  const lineStart = line.from;

  // Regex to match link syntax (not images):
  // - [text](url) or [text](url "title")
  // - [text](<url with spaces>) or [text](<url> "title")
  // Captures: [1] = text, [2] = angle bracket url, [3] = url
  const linkRegex = /\[([^\]]*)\]\((?:<([^>]+)>|([^)\s"]+))(?:\s+"[^"]*")?\)/g;

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
      const href = match[2] || match[3];

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
 * Show the link popup for an existing link at cursor position.
 * Returns true if popup was shown, false if not inside a link.
 */
function showLinkPopupForExistingLink(view: EditorView): boolean {
  const { from } = view.state.selection.main;
  const link = findLinkAtCursor(view, from);

  if (!link) {
    return false;
  }

  // Get anchor rect for popup positioning
  const anchorRect = getAnchorRectFromRange(view, link.from, link.to);
  if (!anchorRect) {
    return false;
  }

  // Open the link popup
  useLinkPopupStore.getState().openPopup({
    href: link.href,
    linkFrom: link.from,
    linkTo: link.to,
    anchorRect,
  });

  return true;
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
 * - Cursor inside existing link → show popup for editing
 * - Has selection + clipboard URL → [selection](clipboard_url)
 * - Has selection, no URL → [selection](url) with cursor in url
 * - No selection, word at cursor + clipboard URL → [word](clipboard_url)
 * - No selection, word at cursor, no URL → [word](url) with cursor in url
 * - No selection, no word + clipboard URL → [](clipboard_url) with cursor in text
 * - No selection, no word, no URL → [](url) with cursor in text
 */
export async function insertLink(view: EditorView): Promise<boolean> {
  const { from, to } = view.state.selection.main;

  // Case 0: Cursor inside existing link - show popup for editing
  if (from === to && showLinkPopupForExistingLink(view)) {
    return true;
  }

  const clipboardUrl = await readClipboardUrl();

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

  // Get anchor rect from selection for popup positioning
  const coords = view.coordsAtPos(from);
  const anchorRect = coords ? {
    top: coords.top,
    bottom: coords.bottom,
    left: coords.left,
    right: coords.left + 10, // Minimal width for cursor position
  } : undefined;

  // Get container bounds for proper popup positioning
  const containerEl = view.dom.closest(".editor-container") as HTMLElement;
  const containerBounds = containerEl
    ? getBoundaryRects(view.dom as HTMLElement, containerEl)
    : getViewportBounds();

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
  }, { anchorRect, containerBounds });

  return true;
}

/**
 * Find inline math ($...$) range around cursor position.
 * Returns the range including delimiters, or null if not inside math.
 */
export function findInlineMathAtCursor(view: EditorView, pos: number): { from: number; to: number; content: string } | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineText = line.text;
  const lineStart = line.from;

  // Skip if line is just $$ (block math delimiter)
  if (lineText.trim() === "$$") {
    return null;
  }

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
 * Block math range result.
 */
export interface BlockMathRange {
  from: number;
  to: number;
  content: string;
  type: "dollarBlock" | "latexFence";
}

/**
 * Find block math at cursor position.
 * Detects:
 * - $$....$$ blocks (multi-line dollar blocks)
 * - ```latex ... ``` blocks (fenced code blocks)
 *
 * Returns null if:
 * - Not inside a block math
 * - Cursor is on a delimiter-only line (just $$ or ```latex or ```)
 */
export function findBlockMathAtCursor(view: EditorView, pos: number): BlockMathRange | null {
  const doc = view.state.doc;
  const totalLines = doc.lines;
  const cursorLine = doc.lineAt(pos);
  const cursorLineNum = cursorLine.number;
  const cursorLineText = cursorLine.text;

  // Check if cursor is on a delimiter-only line
  const trimmedLine = cursorLineText.trim();
  if (trimmedLine === "$$" || trimmedLine === "```latex" || trimmedLine === "```") {
    return null;
  }

  // Search backwards for opening delimiter
  let openLine: { num: number; type: "dollarBlock" | "latexFence" } | null = null;
  for (let lineNum = cursorLineNum; lineNum >= 1; lineNum--) {
    const line = doc.line(lineNum);
    const text = line.text.trim();

    if (text === "$$") {
      openLine = { num: lineNum, type: "dollarBlock" };
      break;
    }
    if (text === "```latex" || text === "```math") {
      openLine = { num: lineNum, type: "latexFence" };
      break;
    }
    // Stop if we hit another fence that's not latex/math (likely a different code block)
    if (text.startsWith("```") && text !== "```latex" && text !== "```math") {
      break;
    }
  }

  if (!openLine) return null;

  // Search forwards for closing delimiter
  const closeDelimiter = openLine.type === "dollarBlock" ? "$$" : "```";
  let closeLine: number | null = null;
  for (let lineNum = cursorLineNum; lineNum <= totalLines; lineNum++) {
    const line = doc.line(lineNum);
    const text = line.text.trim();

    if (text === closeDelimiter && lineNum > openLine.num) {
      closeLine = lineNum;
      break;
    }
    // For fenced blocks, also check if we hit another opening fence
    if (openLine.type === "latexFence" && text.startsWith("```") && text !== "```" && lineNum > openLine.num) {
      break;
    }
  }

  if (!closeLine) return null;

  // Verify cursor is actually inside the block (not on open/close line)
  if (cursorLineNum <= openLine.num || cursorLineNum >= closeLine) {
    return null;
  }

  // Extract content (lines between delimiters)
  const contentLines: string[] = [];
  for (let lineNum = openLine.num + 1; lineNum < closeLine; lineNum++) {
    contentLines.push(doc.line(lineNum).text);
  }
  const content = contentLines.join("\n");

  // Calculate range (from start of open line to end of close line)
  const from = doc.line(openLine.num).from;
  const to = doc.line(closeLine).to;

  return {
    from,
    to,
    content,
    type: openLine.type,
  };
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
