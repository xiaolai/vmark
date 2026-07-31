/**
 * Blockquote Actions for Source Mode
 *
 * Toggle blockquote formatting on lines:
 * - Add > prefix to unquoted lines
 * - Remove > prefix from quoted lines
 * - Supports multi-line selection
 */

import type { EditorView } from "@codemirror/view";
import { isBlockquoteLine } from "./blockquoteDetection";
import { selectionBlockSpan } from "@/plugins/shared/blockSpan";

// Pattern to extract blockquote parts (indent, content)
const BLOCKQUOTE_PATTERN = /^(\s*)>\s?(.*)$/;

/**
 * Toggle blockquote formatting on selected lines.
 *
 * If all lines are blockquotes → remove > prefix
 * If any line is not a blockquote → add > prefix to all
 */
export function toggleBlockquote(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;

  // Quoting reaches the whole top-level BLOCK, not just the selected lines.
  // Prefixing `> ` to one line of a list turns `- one` / `- two` / `- three`
  // into a list, then a quoted list, then another list — three structures where
  // there was one. WYSIWYG wraps the enclosing list as a unit; `blockSpan` is
  // the shared rule.
  const all = Array.from({ length: doc.lines }, (_, i) => doc.line(i + 1).text);
  const span = selectionBlockSpan(all, from, to, (offset) => doc.lineAt(offset).number);
  const startLine = doc.line(span.start + 1);
  const endLine = doc.line(span.end + 1);

  // Collect all lines in the block
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

  if (allAreBlockquotes) {
    // Remove blockquote prefix from all lines
    for (const line of lines) {
      const match = line.text.match(BLOCKQUOTE_PATTERN);
      /* v8 ignore next -- @preserve reason: allAreBlockquotes guarantees match always exists */
      if (match) {
        const newText = match[1] + match[2];
        changes.push({ from: line.from, to: line.to, insert: newText });
      }
    }
  } else {
    // Add blockquote prefix. `blockSpan` never widens across a blank line, so a
    // span is either one block of non-blank lines or a single blank line — and
    // that blank case used to filter down to nothing and dispatch NO edit, so
    // the button was silently dead on an empty line. It now opens an empty quote.
    const nonEmptyLines = lines.filter((l) => l.text.trim() !== "");

    if (nonEmptyLines.length === 0) {
      const only = lines[0];
      if (only) changes.push({ from: only.from, to: only.to, insert: "> " });
    } else {
      // Calculate the range to replace (from first non-empty to last non-empty)
      const firstLine = nonEmptyLines[0];
      const lastLine = nonEmptyLines[nonEmptyLines.length - 1];

      // Build compact blockquote content
      const quotedLines = nonEmptyLines.map((line) => {
        if (isBlockquoteLine(line.text)) {
          return line.text; // Already quoted
        }
        // The `>` goes at the very START of the line, BEFORE any indentation.
        // Writing it after the indent produced `  > - inner`, which is a quote
        // nested inside a list item — the opposite structure. `>   - inner`
        // keeps the indentation as list nesting inside the quote, which is what
        // quoting a nested list means.
        return `> ${line.text}`;
      });

      changes.push({
        from: firstLine.from,
        to: lastLine.to,
        insert: quotedLines.join("\n"),
      });
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
