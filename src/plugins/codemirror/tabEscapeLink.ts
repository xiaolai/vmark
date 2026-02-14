/**
 * Tab Escape Link Navigation for CodeMirror
 *
 * Purpose: Handles Tab key navigation within markdown links — jumping from
 * [text] to (url) and from (url) to after the link, similar to form field tabbing.
 *
 * Key decisions:
 *   - Parses link boundaries by scanning backwards/forwards from cursor position
 *   - Handles nested brackets and parentheses in link text/URLs
 *   - Exports boundary detection functions for reuse by tabEscape.ts
 *
 * @coordinates-with tabEscape.ts — main Tab handler that delegates link navigation here
 * @module plugins/codemirror/tabEscapeLink
 */

import { EditorView } from "@codemirror/view";

export interface LinkBoundaries {
  /** Position after [ */
  textStart: number;
  /** Position before ] */
  textEnd: number;
  /** Position after ( */
  urlStart: number;
  /** Position before ) */
  urlEnd: number;
  /** Position after ) */
  linkEnd: number;
}

/**
 * Check if a character at position is escaped (preceded by odd number of backslashes).
 */
function isEscaped(text: string, pos: number): boolean {
  let backslashCount = 0;
  let i = pos - 1;
  while (i >= 0 && text[i] === "\\") {
    backslashCount++;
    i--;
  }
  return backslashCount % 2 === 1;
}

/**
 * Find matching closing bracket with balanced bracket counting.
 * Handles nested brackets and escaped brackets.
 *
 * @param text - Text to search
 * @param start - Position after opening bracket
 * @param openChar - Opening bracket character
 * @param closeChar - Closing bracket character
 * @returns Position of matching closing bracket, or -1 if not found
 */
function findMatchingBracket(
  text: string,
  start: number,
  openChar: string,
  closeChar: string
): number {
  let depth = 1;
  let i = start;

  while (i < text.length && depth > 0) {
    // Skip escaped characters
    if (isEscaped(text, i)) {
      i++;
      continue;
    }

    if (text[i] === openChar) {
      depth++;
    } else if (text[i] === closeChar) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }

    i++;
  }

  return -1; // No matching bracket found
}

/**
 * Find the boundaries of a markdown link at or around the given position.
 * Uses balanced bracket parsing to handle nested brackets and escaped characters.
 *
 * Supports:
 * - Nested brackets: `[text [nested]](url)`
 * - Escaped brackets: `[text \[bracket\]](url)`
 * - Nested parentheses in URL: `[text](url(params))`
 *
 * @param text - The line text to search in
 * @param posInLine - Cursor position within the line (0-indexed)
 * @returns Link boundaries or null if not in a link
 */
export function getLinkBoundaries(
  text: string,
  posInLine: number
): LinkBoundaries | null {
  // Find all potential link starts by looking for '[' characters
  for (let i = 0; i < text.length; i++) {
    // Skip escaped brackets
    if (isEscaped(text, i)) {
      continue;
    }

    if (text[i] !== "[") {
      continue;
    }

    const linkStart = i;

    // Find matching closing bracket for link text
    const textEnd = findMatchingBracket(text, i + 1, "[", "]");
    if (textEnd === -1) {
      continue; // No matching ], not a valid link
    }

    // Check if followed by (
    if (textEnd + 1 >= text.length || text[textEnd + 1] !== "(") {
      continue; // Not followed by (, not a valid link
    }

    // Find matching closing paren for URL
    const urlEnd = findMatchingBracket(text, textEnd + 2, "(", ")");
    if (urlEnd === -1) {
      continue; // No matching ), not a valid link
    }

    const linkEnd = urlEnd + 1;

    // Check if cursor is within this link
    if (posInLine >= linkStart && posInLine <= linkEnd) {
      return {
        textStart: linkStart + 1, // After [
        textEnd: textEnd, // Position of ]
        urlStart: textEnd + 2, // After (
        urlEnd: urlEnd, // Position of )
        linkEnd: linkEnd, // After )
      };
    }

    // If cursor is before this link, no point searching further
    if (posInLine < linkStart) {
      break;
    }
  }

  return null;
}

/**
 * Check if cursor position is inside the link text portion [text].
 */
export function isInLinkText(
  boundaries: LinkBoundaries,
  posInLine: number
): boolean {
  return posInLine >= boundaries.textStart && posInLine <= boundaries.textEnd;
}

/**
 * Check if cursor position is inside the link URL portion (url).
 */
export function isInLinkUrl(
  boundaries: LinkBoundaries,
  posInLine: number
): boolean {
  return posInLine >= boundaries.urlStart && posInLine <= boundaries.urlEnd;
}

/**
 * Handle Tab key to navigate within markdown links.
 *
 * - When cursor is in [text]: Tab jumps to (url)
 * - When cursor is in (url): Tab jumps after the link
 *
 * @returns true if handled, false to fall through to default Tab behavior
 */
export function tabNavigateLink(view: EditorView): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;

  // Only handle cursor, not selection
  if (from !== to) return false;

  // Get the current line
  const line = state.doc.lineAt(from);
  const posInLine = from - line.from;
  const lineText = line.text;

  // Check if cursor is in a link
  const boundaries = getLinkBoundaries(lineText, posInLine);
  if (!boundaries) return false;

  // Determine where to jump
  let targetPosInLine: number;

  if (isInLinkText(boundaries, posInLine)) {
    // In text portion: jump to URL start
    targetPosInLine = boundaries.urlStart;
  } else if (isInLinkUrl(boundaries, posInLine)) {
    // In URL portion: jump after the link
    targetPosInLine = boundaries.linkEnd;
  } else {
    // Between ] and ( or outside - shouldn't happen but handle gracefully
    return false;
  }

  // Calculate absolute position and move cursor
  const targetPos = line.from + targetPosInLine;

  view.dispatch({
    selection: { anchor: targetPos },
    scrollIntoView: true,
  });

  return true;
}
