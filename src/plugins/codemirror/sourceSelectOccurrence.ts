/**
 * Source Mode Select Occurrence Commands
 *
 * Purpose: Custom Cmd+D (select next occurrence) and Cmd+Shift+L (select all occurrences)
 * for CodeMirror that match WYSIWYG multi-cursor behavior:
 *   - CJK-aware word boundary detection via Intl.Segmenter
 *   - Code fence boundary awareness (don't select across fences)
 *   - Wrap-around search with duplicate avoidance
 *
 * @coordinates-with sourceMultiCursorPlugin.ts — provides Alt+Click and Escape handling
 * @coordinates-with sourceAltClick.ts — code fence boundary detection for Alt+Click
 * @coordinates-with utils/wordSegmentation.ts — CJK word boundary detection (shared with WYSIWYG)
 * @module plugins/codemirror/sourceSelectOccurrence
 */

import type { EditorState, TransactionSpec } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import { findWordBoundaries } from "@/utils/wordSegmentation";

const FENCE_OPEN_PATTERN = /^(\s*)(```+)(\w*)?/;

/* ------------------------------------------------------------------ */
/*  Code fence boundary detection (position-based, no EditorView)     */
/* ------------------------------------------------------------------ */

interface FenceBounds {
  /** Document offset of the first character inside the fence (after opening line) */
  from: number;
  /** Document offset of the last character inside the fence (before closing line) */
  to: number;
}

/**
 * Get code fence bounds containing `pos`, or null if not inside a fence.
 * Works directly on EditorState.doc — no EditorView required.
 */
function getCodeFenceBounds(state: EditorState, pos: number): FenceBounds | null {
  const doc = state.doc;
  const cursorLine = doc.lineAt(pos);

  // Search backwards for opening fence
  let openLineNum: number | null = null;
  let fenceLength = 0;

  for (let lineNum = cursorLine.number; lineNum >= 1; lineNum--) {
    const line = doc.line(lineNum);
    const match = FENCE_OPEN_PATTERN.exec(line.text);
    if (match) {
      openLineNum = lineNum;
      fenceLength = match[2].length;
      break;
    }
  }

  if (openLineNum === null) return null;

  // Parity check: count all fence-like lines from the start of the document
  // up to (but not including) the found line. If the count is odd, the found
  // line is a closing fence, not an opening fence — so we're not inside a fence.
  let fenceCount = 0;
  for (let ln = 1; ln < openLineNum; ln++) {
    if (FENCE_OPEN_PATTERN.test(doc.line(ln).text)) fenceCount++;
  }
  if (fenceCount % 2 !== 0) return null;

  // If cursor is on the opening line itself, it's not "inside" the fence
  if (cursorLine.number === openLineNum) return null;

  // Search forwards for closing fence
  const closePattern = new RegExp(`^\\s*\`{${fenceLength},}\\s*$`);
  for (let lineNum = openLineNum + 1; lineNum <= doc.lines; lineNum++) {
    const line = doc.line(lineNum);
    if (closePattern.test(line.text)) {
      // Found closing fence
      const contentStart = doc.line(openLineNum + 1).from;
      const contentEnd = line.from - 1; // before the closing fence line

      // Cursor must be inside this range
      if (pos >= contentStart && pos <= line.to) {
        return { from: contentStart, to: contentEnd < contentStart ? contentStart : contentEnd };
      }
      return null; // Fence found but cursor is not inside it
    }
  }

  return null; // Unclosed fence
}

/* ------------------------------------------------------------------ */
/*  Word detection                                                     */
/* ------------------------------------------------------------------ */

/**
 * Get the word at a cursor position using CJK-aware word segmentation.
 */
function getWordAtPos(
  state: EditorState,
  pos: number,
): { from: number; to: number; text: string } | null {
  const line = state.doc.lineAt(pos);
  const offsetInLine = pos - line.from;
  const boundaries = findWordBoundaries(line.text, offsetInLine);
  if (!boundaries) return null;

  return {
    from: line.from + boundaries.start,
    to: line.from + boundaries.end,
    text: line.text.slice(boundaries.start, boundaries.end),
  };
}

/* ------------------------------------------------------------------ */
/*  Text search                                                        */
/* ------------------------------------------------------------------ */

/**
 * Find all occurrences of `searchText` in the document, optionally restricted
 * to positions outside code fences (or inside a specific fence).
 */
function findAllOccurrences(
  state: EditorState,
  searchText: string,
  bounds: FenceBounds | null,
): Array<{ from: number; to: number }> {
  const results: Array<{ from: number; to: number }> = [];
  if (!searchText) return results;

  const docText = state.doc.toString();
  let index = docText.indexOf(searchText);

  while (index !== -1) {
    const from = index;
    const to = index + searchText.length;

    if (bounds) {
      // Inside a fence — only match within fence bounds
      if (from >= bounds.from && to <= bounds.to + 1) {
        results.push({ from, to });
      }
    } else {
      // Outside fences — exclude matches inside any fence
      const matchFence = getCodeFenceBounds(state, from);
      if (!matchFence) {
        results.push({ from, to });
      }
    }

    index = docText.indexOf(searchText, index + 1);
  }

  return results;
}

/**
 * Check if a range already exists in the selection.
 */
function rangeExists(
  ranges: readonly { from: number; to: number }[],
  from: number,
  to: number,
): boolean {
  return ranges.some((r) => r.from === from && r.to === to);
}

/* ------------------------------------------------------------------ */
/*  Commands                                                           */
/* ------------------------------------------------------------------ */

/**
 * Select the next occurrence of the current word or selection.
 *
 * - Empty selection: selects word under cursor (CJK-aware)
 * - Existing selection: finds and adds next occurrence
 * - Wraps around once, stops if next would be a duplicate
 * - Respects code fence boundaries
 *
 * @returns TransactionSpec or null if no action
 */
export function selectNextOccurrenceSource(state: EditorState): TransactionSpec | null {
  const { selection } = state;
  const primary = selection.main;
  let searchText: string;
  let currentFrom: number;
  let currentTo: number;
  let selectingWord = false;

  // Determine search text
  if (primary.from === primary.to) {
    // Empty selection — get word under cursor
    const word = getWordAtPos(state, primary.from);
    if (!word) return null;
    searchText = word.text;
    currentFrom = word.from;
    currentTo = word.to;
    selectingWord = true;
  } else {
    searchText = state.doc.sliceString(primary.from, primary.to);
    // For multi-selection, use the last range's end for "search after" position
    const lastRange = selection.ranges[selection.ranges.length - 1];
    currentFrom = primary.from;
    currentTo = lastRange.to;
  }

  if (!searchText) return null;

  // Detect code fence bounds
  const bounds = getCodeFenceBounds(state, currentFrom);

  // Find all occurrences respecting fence boundaries
  const occurrences = findAllOccurrences(state, searchText, bounds);

  // Build list of existing ranges
  const existingRanges = selection.ranges.map((r) => ({ from: r.from, to: r.to }));

  // If selecting word from empty cursor, just select the word
  if (selectingWord && selection.ranges.length === 1 && primary.from === primary.to) {
    if (occurrences.length === 0) return null;
    return {
      selection: EditorSelection.create([
        EditorSelection.range(currentFrom, currentTo),
      ]),
    };
  }

  // Need at least 2 occurrences to add another
  if (occurrences.length <= 1) return null;

  // Find next unused occurrence after current position
  let nextOcc: { from: number; to: number } | null = null;

  // Look after current position
  for (const occ of occurrences) {
    if (occ.from > currentTo && !rangeExists(existingRanges, occ.from, occ.to)) {
      nextOcc = occ;
      break;
    }
  }

  // Wrap around: look before current position
  if (!nextOcc) {
    for (const occ of occurrences) {
      if (occ.from < currentFrom && !rangeExists(existingRanges, occ.from, occ.to)) {
        nextOcc = occ;
        break;
      }
    }
  }

  if (!nextOcc) return null;

  // Build new selection including all existing ranges + the new one
  const newRanges = [
    ...existingRanges,
    { from: nextOcc.from, to: nextOcc.to },
  ];

  // Sort by position and determine new primary index (the newly added range)
  newRanges.sort((a, b) => a.from - b.from);
  const newPrimaryIndex = newRanges.findIndex(
    (r) => r.from === nextOcc!.from && r.to === nextOcc!.to,
  );

  return {
    selection: EditorSelection.create(
      newRanges.map((r) => EditorSelection.range(r.from, r.to)),
      newPrimaryIndex,
    ),
  };
}

/**
 * Select all occurrences of the current word or selection.
 *
 * - Empty selection: selects word under cursor, then all occurrences
 * - Existing selection: selects all occurrences of selected text
 * - Respects code fence boundaries
 *
 * @returns TransactionSpec or null if no action
 */
export function selectAllOccurrencesSource(state: EditorState): TransactionSpec | null {
  const { selection } = state;
  const primary = selection.main;
  let searchText: string;
  let initialFrom: number;
  let initialTo: number;

  if (primary.from === primary.to) {
    // Empty selection — get word under cursor
    const word = getWordAtPos(state, primary.from);
    if (!word) return null;
    searchText = word.text;
    initialFrom = word.from;
    initialTo = word.to;
  } else {
    searchText = state.doc.sliceString(primary.from, primary.to);
    initialFrom = primary.from;
    initialTo = primary.to;
  }

  if (!searchText) return null;

  // Detect code fence bounds
  const bounds = getCodeFenceBounds(state, initialFrom);

  // Find all occurrences
  const occurrences = findAllOccurrences(state, searchText, bounds);
  if (occurrences.length === 0) return null;

  // If only one occurrence, select it
  if (occurrences.length === 1) {
    return {
      selection: EditorSelection.create([
        EditorSelection.range(occurrences[0].from, occurrences[0].to),
      ]),
    };
  }

  // Find primary index (the occurrence containing the original cursor/selection)
  let primaryIndex = 0;
  for (let i = 0; i < occurrences.length; i++) {
    if (occurrences[i].from === initialFrom && occurrences[i].to === initialTo) {
      primaryIndex = i;
      break;
    }
  }

  return {
    selection: EditorSelection.create(
      occurrences.map((occ) => EditorSelection.range(occ.from, occ.to)),
      primaryIndex,
    ),
  };
}
