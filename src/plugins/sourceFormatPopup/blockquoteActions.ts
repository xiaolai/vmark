/**
 * Blockquote Actions for Source Mode
 *
 * Toggle blockquote formatting on lines:
 * - Add > prefix to unquoted lines
 * - Remove > prefix from quoted lines
 * - Supports multi-line selection
 */

import type { EditorView } from "@codemirror/view";

// Pattern to detect blockquote lines
const BLOCKQUOTE_PATTERN = /^(\s*)>\s?(.*)$/;

/**
 * Check if a line is a blockquote.
 */
function isBlockquoteLine(text: string): boolean {
  return BLOCKQUOTE_PATTERN.test(text);
}

/**
 * Toggle blockquote formatting on selected lines.
 *
 * If all lines are blockquotes → remove > prefix
 * If any line is not a blockquote → add > prefix to all
 */
export function toggleBlockquote(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;

  const startLine = doc.lineAt(from);
  const endLine = doc.lineAt(to);

  // Collect all lines in selection
  const lines: { num: number; text: string; from: number; to: number }[] = [];
  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = doc.line(i);
    lines.push({
      num: i,
      text: line.text,
      from: line.from,
      to: line.to,
    });
  }

  // Check if ALL lines are already blockquotes
  const allAreBlockquotes = lines.every((l) => isBlockquoteLine(l.text));

  // Build changes
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const line of lines) {
    if (allAreBlockquotes) {
      // Remove blockquote prefix
      const match = line.text.match(BLOCKQUOTE_PATTERN);
      if (match) {
        const newText = match[1] + match[2];
        changes.push({ from: line.from, to: line.to, insert: newText });
      }
    } else {
      // Add blockquote prefix
      if (!isBlockquoteLine(line.text)) {
        // Preserve leading whitespace
        const leadingMatch = line.text.match(/^(\s*)/);
        const indent = leadingMatch ? leadingMatch[1] : "";
        const content = line.text.slice(indent.length);
        const newText = `${indent}> ${content}`;
        changes.push({ from: line.from, to: line.to, insert: newText });
      }
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
  }

  view.focus();
}

/**
 * Check if current line or selection contains blockquotes.
 */
export function hasBlockquote(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;

  const startLine = doc.lineAt(from);
  const endLine = doc.lineAt(to);

  // Check if all lines in selection are blockquotes
  for (let i = startLine.number; i <= endLine.number; i++) {
    if (!isBlockquoteLine(doc.line(i).text)) {
      return false;
    }
  }
  return true;
}
