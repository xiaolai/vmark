/**
 * Heading Detection for Source Mode
 *
 * Utilities to detect whether the cursor is on a markdown heading and to change
 * that heading's level.
 *
 * Key decisions:
 *   - A line is parsed into QUOTE wrapper + list marker + heading run + text, so
 *     a heading conversion knows what is already there. Stripping only the `#`
 *     run turned a list item into `# - text` (a heading whose text starts with a
 *     bullet) and a blockquote into `# > text` — a heading CONTAINING a literal
 *     `>`, with the quote destroyed.
 *   - A quote wrapper SURVIVES the conversion and the heading goes inside it,
 *     matching WYSIWYG. A list marker is REPLACED, because the line stops being
 *     a list item.
 *   - Detection understands quoted headings, so `> ## text` reports level 2
 *     instead of nothing.
 *
 * @coordinates-with toolbarActions/sourceBlockActions.ts — the toolbar path
 * @coordinates-with codemirror/sourceShortcutsHelpers.ts — the keyboard path
 * @module plugins/sourceContextDetection/headingDetection
 */

import type { EditorView } from "@codemirror/view";
export interface HeadingInfo {
  level: number; // 1-6, or 0 for paragraph
  lineStart: number;
  lineEnd: number;
}

/** Leading blockquote markers, e.g. `> ` or `> > `. */
const QUOTE_RE = /^\s*(?:>\s?)+/;
/** A bullet or ordered marker, optionally a task checkbox, with its indent. */
const LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
/** An ATX heading run. */
const HEADING_RE = /^(#{1,6})(?:\s+|$)/;

interface LineParts {
  /** Blockquote wrapper to preserve, already normalised with a trailing space. */
  quote: string;
  /** Heading level found inside the wrapper, or 0 for none. */
  level: number;
  /** The line's text, with quote, list marker and heading run removed. */
  text: string;
}

/**
 * Split a line into the parts a heading conversion needs to reason about.
 *
 * Peels in markdown's own order: quote wrapper, then list marker, then heading
 * run. Everything after that is the text.
 */
function splitLine(lineText: string): LineParts {
  let rest = lineText;

  const quoteMatch = QUOTE_RE.exec(rest);
  const quote = quoteMatch ? quoteMatch[0] : "";
  rest = rest.slice(quote.length);

  const listMatch = LIST_RE.exec(rest);
  if (listMatch) rest = rest.slice(listMatch[0].length);

  const headingMatch = HEADING_RE.exec(rest);
  const level = headingMatch ? headingMatch[1].length : 0;
  if (headingMatch) rest = rest.slice(headingMatch[0].length);

  // Normalise `>`/`>  ` to a single trailing space so rebuilt lines are stable.
  const normalisedQuote = quote ? `${quote.trimEnd()} ` : "";
  return { quote: normalisedQuote, level, text: rest };
}

/** Rebuild a line at the requested level, preserving any quote wrapper. */
function buildLine(parts: LineParts, level: number): string {
  const body = level > 0 ? `${"#".repeat(level)} ${parts.text}` : parts.text;
  return `${parts.quote}${body}`;
}

/**
 * Detect whether the current line is a heading and return its info.
 *
 * Sees through a blockquote wrapper, so `> ## text` is a level-2 heading rather
 * than an unrecognised line.
 */
export function getHeadingInfo(view: EditorView, pos?: number): HeadingInfo | null {
  const { state } = view;
  const from = typeof pos === "number" ? pos : state.selection.main.from;
  const line = state.doc.lineAt(from);
  const { level } = splitLine(line.text);

  if (level === 0) return null;
  return { level, lineStart: line.from, lineEnd: line.to };
}

/**
 * Change the heading level on the current line.
 * @param newLevel 0 = paragraph (remove heading), 1-6 = heading level
 */
export function setHeadingLevel(view: EditorView, info: HeadingInfo, newLevel: number): void {
  const line = view.state.doc.lineAt(info.lineStart);
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: buildLine(splitLine(line.text), newLevel) },
  });
  view.focus();
}

/**
 * Convert the current line to a heading.
 *
 * Replaces a list marker, because the line stops being a list item, and keeps a
 * blockquote wrapper, because the heading belongs inside the quote.
 *
 * @param level 1-6 = heading level
 */
export function convertToHeading(view: EditorView, level: number, pos?: number): void {
  if (level < 1 || level > 6) return;

  const from = typeof pos === "number" ? pos : view.state.selection.main.from;
  const line = view.state.doc.lineAt(from);
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: buildLine(splitLine(line.text), level) },
  });
  view.focus();
}
