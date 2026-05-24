/**
 * Source Math Actions
 *
 * Math-related toolbar actions for source mode.
 * Handles inline math ($...$) and block math ($$...$$, ```latex```) detection and insertion.
 *
 * @coordinates-with sourceAdapterLinks.ts — findWordAtCursorSource for word expansion
 * @coordinates-with codemirror/sourceMathPreview.ts — uses findInlineMathAtCursor, findBlockMathAtCursor
 * @module plugins/toolbarActions/sourceMathActions
 */

import type { EditorView } from "@codemirror/view";
import { findWordAtCursorSource } from "./sourceAdapterLinks";

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
        if (lineText[j] === "$" && lineText[j - 1] !== "\\") {
          // Empty `$$` is not inline math (remark-math agrees) — it is usually
          // a half-typed block-math delimiter. Skip it so the popup does not
          // open with an empty range that later writes back stale offsets.
          if (j === start + 1) {
            i = j + 1;
            break;
          }
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

  /* v8 ignore start -- @preserve reason: block math without closing delimiter not tested */
  if (!closeLine) return null;
  /* v8 ignore stop */

  // Verify cursor is actually inside the block (not on open/close line)
  /* v8 ignore next -- @preserve reason: cursor on open/close fence line of block math not tested */
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
 * - Cursor inside $...$ -> unwrap (remove delimiters)
 * - Has selection -> wrap in $...$, cursor after
 * - No selection, word at cursor -> wrap word in $...$, cursor after
 * - No selection, no word -> insert $$, cursor between
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

    // Explicit unwrap for cursor sitting between an empty `$$` pair.
    // findInlineMathAtCursor no longer treats this as math (it is a common
    // half-typed block-math delimiter), but an explicit toolbar / shortcut
    // invocation here should still toggle the pair off rather than inserting
    // another `$$`.
    const charBefore = from > 0 ? view.state.doc.sliceString(from - 1, from) : "";
    const charAfter = from < view.state.doc.length ? view.state.doc.sliceString(from, from + 1) : "";
    if (charBefore === "$" && charAfter === "$") {
      view.dispatch({
        changes: { from: from - 1, to: from + 1, insert: "" },
        selection: { anchor: from - 1 },
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
