/**
 * Smart List Continuation Plugin for CodeMirror
 *
 * Handles Enter key in list items:
 * - At end of list item: insert new bullet with same indent
 * - On empty list item: remove bullet and exit list
 * - Supports unordered, ordered, and task lists
 */

import type { KeyBinding } from "@codemirror/view";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";

// Pattern matching for different list types
const TASK_PATTERN = /^(\s*)([-*+])\s\[([ xX])\]\s(.*)$/;
const UNORDERED_PATTERN = /^(\s*)([-*+])\s(.*)$/;
const ORDERED_PATTERN = /^(\s*)(\d+)([.)])\s(.*)$/;

interface ListMatch {
  indent: string;
  marker: string;
  content: string;
  isTask?: boolean;
  taskState?: string;
  orderNum?: number;
  orderSuffix?: string;
}

/**
 * Parse a line to extract list information.
 */
function parseListLine(text: string): ListMatch | null {
  // Check task list first (more specific)
  let match = text.match(TASK_PATTERN);
  if (match) {
    return {
      indent: match[1],
      marker: match[2],
      content: match[4],
      isTask: true,
      taskState: match[3],
    };
  }

  // Check ordered list
  match = text.match(ORDERED_PATTERN);
  if (match) {
    return {
      indent: match[1],
      marker: match[2] + match[3],
      content: match[4],
      orderNum: parseInt(match[2], 10),
      orderSuffix: match[3],
    };
  }

  // Check unordered list
  match = text.match(UNORDERED_PATTERN);
  if (match) {
    return {
      indent: match[1],
      marker: match[2],
      content: match[3],
    };
  }

  return null;
}

/**
 * Generate the next list marker based on current line.
 */
function getNextMarker(listMatch: ListMatch): string {
  const { indent, marker, isTask, orderNum, orderSuffix } = listMatch;

  if (isTask) {
    // Task lists always continue with unchecked
    return `${indent}${marker} [ ] `;
  }

  if (orderNum !== undefined && orderSuffix) {
    // Ordered lists increment the number
    return `${indent}${orderNum + 1}${orderSuffix} `;
  }

  // Unordered lists keep the same marker
  return `${indent}${marker} `;
}

/**
 * KeyBinding for smart list continuation.
 * Must be placed before defaultKeymap to intercept Enter.
 */
export const listContinuationKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Enter",
  run: (view) => {
    const { state } = view;
    const { from, to } = state.selection.main;

    // Only handle single cursor (not multi-select)
    if (from !== to) return false;

    const line = state.doc.lineAt(from);
    const listMatch = parseListLine(line.text);

    // Not in a list - let default handler take over
    if (!listMatch) return false;

    // Check if cursor is at end of line (or close to it)
    // Allow some flexibility - cursor can be anywhere after content
    const cursorInLine = from - line.from;
    const textBeforeCursor = line.text.slice(0, cursorInLine);

    // Re-parse with text before cursor to check if we're past the marker
    const beforeMatch = parseListLine(textBeforeCursor);
    if (!beforeMatch) {
      // Cursor is before the marker - let default handler work
      return false;
    }

    // Check if the list item content is empty (just marker, no text)
    if (listMatch.content.trim() === "") {
      // Empty list item - remove the bullet and just add newline
      const markerStart = line.from + listMatch.indent.length;
      const markerEnd = line.to;

      view.dispatch({
        changes: { from: markerStart, to: markerEnd, insert: "" },
        selection: { anchor: markerStart },
      });
      return true;
    }

    // Has content - insert new list item
    const nextMarker = getNextMarker(listMatch);

    view.dispatch({
      changes: { from, to: from, insert: "\n" + nextMarker },
      selection: { anchor: from + 1 + nextMarker.length },
    });

    return true;
  },
});
