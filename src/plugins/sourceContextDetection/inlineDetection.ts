/**
 * Inline Element Detection for Source Mode
 *
 * Detects if cursor is inside inline elements like links, images, math, footnotes.
 * Returns the range of the element for auto-selection.
 */

import type { EditorView } from "@codemirror/view";

export interface InlineElementInfo {
  type: "link" | "image" | "math" | "footnote";
  /** Start position of the element */
  from: number;
  /** End position of the element */
  to: number;
  /** Start position of selectable content (for auto-selection) */
  contentFrom: number;
  /** End position of selectable content */
  contentTo: number;
}

/**
 * Find link at cursor position: [text](url) or [text][ref]
 * Returns the text range for selection.
 */
function findLinkAtCursor(view: EditorView): InlineElementInfo | null {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  const lineText = line.text;
  const posInLine = from - line.from;

  // Match [text](url) or [text][ref] patterns
  // We need to find if cursor is within the text part [text]
  const linkRegex = /\[([^\]]*)\](\([^)]*\)|\[[^\]]*\])/g;
  let match;

  while ((match = linkRegex.exec(lineText)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    const textStart = matchStart + 1; // after [
    const textEnd = textStart + match[1].length; // before ]

    // Check if cursor is within the link (including brackets and URL)
    if (posInLine >= matchStart && posInLine <= matchEnd) {
      return {
        type: "link",
        from: line.from + matchStart,
        to: line.from + matchEnd,
        contentFrom: line.from + textStart,
        contentTo: line.from + textEnd,
      };
    }
  }

  return null;
}

/**
 * Find inline image at cursor position: ![alt](url)
 * Returns null for images (they have their own popup).
 */
function findImageAtCursor(view: EditorView): InlineElementInfo | null {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  const lineText = line.text;
  const posInLine = from - line.from;

  // Match ![alt](url) pattern
  const imageRegex = /!\[([^\]]*)\]\(([^)]*)\)/g;
  let match;

  while ((match = imageRegex.exec(lineText)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;

    // Check if cursor is within the image
    if (posInLine >= matchStart && posInLine <= matchEnd) {
      return {
        type: "image",
        from: line.from + matchStart,
        to: line.from + matchEnd,
        contentFrom: line.from + matchStart,
        contentTo: line.from + matchEnd,
      };
    }
  }

  return null;
}

/**
 * Find inline math at cursor position: $...$
 * Excludes block math ($$...$$).
 */
function findInlineMathAtCursor(view: EditorView): InlineElementInfo | null {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  const lineText = line.text;
  const posInLine = from - line.from;

  // Match $...$ but not $$...$$
  // Use a simple approach: find all single $ pairs
  let i = 0;
  while (i < lineText.length) {
    // Skip $$ (block math delimiter)
    if (lineText[i] === "$" && lineText[i + 1] === "$") {
      i += 2;
      continue;
    }

    if (lineText[i] === "$") {
      const start = i;
      i++;
      // Find closing $
      while (i < lineText.length) {
        if (lineText[i] === "$" && lineText[i - 1] !== "\\") {
          // Found closing $
          const end = i + 1;
          // Check if cursor is within this math span
          if (posInLine >= start && posInLine <= end) {
            return {
              type: "math",
              from: line.from + start,
              to: line.from + end,
              contentFrom: line.from + start + 1, // after $
              contentTo: line.from + end - 1, // before $
            };
          }
          break;
        }
        i++;
      }
    }
    i++;
  }

  return null;
}

/**
 * Find footnote reference at cursor position: [^n] or [^label]
 */
function findFootnoteAtCursor(view: EditorView): InlineElementInfo | null {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  const lineText = line.text;
  const posInLine = from - line.from;

  // Match [^n] or [^label] pattern (not at line start - that's a definition)
  const footnoteRegex = /\[\^([^\]]+)\]/g;
  let match;

  while ((match = footnoteRegex.exec(lineText)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;

    // Skip if at line start (footnote definition)
    if (matchStart === 0) continue;

    // Check if cursor is within the footnote reference
    if (posInLine >= matchStart && posInLine <= matchEnd) {
      return {
        type: "footnote",
        from: line.from + matchStart,
        to: line.from + matchEnd,
        contentFrom: line.from + matchStart, // select entire [^n]
        contentTo: line.from + matchEnd,
      };
    }
  }

  return null;
}

/**
 * Detect inline element at cursor position.
 * Returns info about the element type and its range.
 */
export function getInlineElementAtCursor(
  view: EditorView
): InlineElementInfo | null {
  // Check in priority order
  // 1. Image (has own popup, will be skipped)
  const image = findImageAtCursor(view);
  if (image) return image;

  // 2. Link
  const link = findLinkAtCursor(view);
  if (link) return link;

  // 3. Inline math
  const math = findInlineMathAtCursor(view);
  if (math) return math;

  // 4. Footnote
  const footnote = findFootnoteAtCursor(view);
  if (footnote) return footnote;

  return null;
}
