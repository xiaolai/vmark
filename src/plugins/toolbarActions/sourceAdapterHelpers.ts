/**
 * Source Adapter Helpers
 *
 * Low-level helper functions for source mode toolbar actions.
 * Used by sourceAdapter.ts for text insertion and formatting.
 */

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { applyFormat, type FormatType } from "@/plugins/sourceContextDetection";
import { clearAllFormatting } from "@/plugins/sourceContextDetection/clearFormatting";
import { applyInlineFormatToSelections } from "@/plugins/sourceContextDetection/formatMultiSelection";
import { FORMAT_MARKERS, type WrapFormatType } from "@/plugins/sourceContextDetection/formatTypes";
import { findWordBoundaries } from "@/utils/wordSegmentation";

/**
 * Insert text at the current selection with optional cursor positioning.
 */
export function insertText(view: EditorView, text: string, cursorOffset?: number): void {
  const { from, to } = view.state.selection.main;
  const anchor = from;

  view.dispatch({
    changes: { from, to, insert: text },
    selection: {
      anchor: typeof cursorOffset === "number" ? anchor + cursorOffset : anchor + text.length,
    },
  });
  view.focus();
}

/**
 * Insert BLOCK-level markdown on its own line, below the line the cursor is on.
 *
 * `insertText` splices at the caret, which is right for inline content and
 * wrong for every block: with the cursor mid-sentence it produced
 * `The quick ---` (a paragraph ending in hyphens, not a thematic break),
 * `The quick > [!NOTE]` splitting the sentence, and tables and `<details>`
 * opening inside a paragraph. None of those mean what the user asked for.
 *
 * Inserting BELOW the current line rather than splitting it is the
 * non-destructive reading, and the one WYSIWYG already uses for alerts: the
 * sentence being typed stays intact. An empty line hosts the block directly
 * instead of leaving a stray blank above it.
 *
 * @param cursorOffset - caret position within the inserted block; defaults to
 *   its end.
 */
export function insertBlockText(view: EditorView, text: string, cursorOffset?: number): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.from);
  const onEmptyLine = line.text.trim() === "";

  // Opening a new line below is enough to give the block its own line — the
  // remainder of the document already begins with the next line break, so no
  // trailing newline is added here.
  const from = onEmptyLine ? line.from : line.to;
  const insert = onEmptyLine ? text : `\n${text}`;
  const blockStart = onEmptyLine ? from : from + 1;

  view.dispatch({
    changes: { from, to: onEmptyLine ? line.to : from, insert },
    selection: { anchor: blockStart + (typeof cursorOffset === "number" ? cursorOffset : text.length) },
  });
  view.focus();
}

/**
 * Replace the SELECTED LINES with a block that already contains their text.
 *
 * The selection-consuming builders (alerts, details, math and diagram fences)
 * fold the selection into the block they return, so the insertion has to take
 * the selection's place — inserting below would leave the original text behind
 * and duplicate it inside the block. Expanding to whole lines keeps the block
 * from starting mid-sentence.
 */
export function replaceLinesWithBlock(view: EditorView, text: string, cursorOffset?: number): void {
  const { state } = view;
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to);

  view.dispatch({
    changes: { from: first.from, to: last.to, insert: text },
    selection: { anchor: first.from + (typeof cursorOffset === "number" ? cursorOffset : text.length) },
  });
  view.focus();
}

/**
 * Put a line-level marker (`- `, `1. `, `- [ ] `) at the START of the current
 * line, after any existing indentation.
 *
 * Inserting it at the caret instead produced `The quick - brown fox`, and with a
 * range selection it replaced the selected word outright. A list marker is a
 * property of the line, not of the cursor position within it.
 *
 * The caret keeps its position in the text, shifting by the marker's width so it
 * stays on the same character the user was editing.
 */
export function prependLineMarker(view: EditorView, marker: string): boolean {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);

  // Go INSIDE any blockquote wrapper: the list belongs to the quoted content,
  // so `> text` becomes `> - text`. Writing the marker before the `>` produced
  // `- > text`, a list item containing a quote — the opposite nesting.
  const wrapper = /^\s*(?:>\s?)*\s*/.exec(line.text)?.[0] ?? "";
  const at = line.from + wrapper.length;

  // A heading run is REPLACED, not kept: a line cannot be a heading and a list
  // item at once, and WYSIWYG drops the heading when converting. Keeping it
  // produced `- ### text`, a bullet whose content is a heading.
  const headingRun = /^#{1,6}(?:\s+|$)/.exec(line.text.slice(wrapper.length))?.[0] ?? "";

  view.dispatch({
    changes: { from: at, to: at + headingRun.length, insert: marker },
    selection: { anchor: Math.max(at, from - headingRun.length) + marker.length },
  });
  view.focus();
  return true;
}

/**
 * Apply inline format to selection. Handles multi-selection.
 * When no selection, expands to word at cursor (matches WYSIWYG behavior).
 * Returns false if format not applicable.
 */
export function applyInlineFormat(view: EditorView, format: FormatType): boolean {
  const { selection } = view.state;
  if (selection.ranges.length > 1) {
    if (format === "footnote" || format === "image" || format === "link") return false;
    return applyInlineFormatToSelections(view, format);
  }

  const { from, to } = selection.main;

  // No selection: expand to word at cursor
  if (from === to) {
    // Skip formats that don't make sense for word-at-cursor
    if (format === "footnote" || format === "image" || format === "link") return false;

    const wordRange = findWordAtCursorSource(view, from);
    if (!wordRange) return false;

    // Apply format to word range, then restore cursor
    applyFormatToRange(view, format, wordRange.from, wordRange.to, from);
    return true;
  }

  applyFormat(view, format);
  return true;
}

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
 * Apply format to a specific range, then restore cursor to original position.
 * Handles both wrapping (add markers) and unwrapping (remove markers).
 */
function applyFormatToRange(
  view: EditorView,
  format: FormatType,
  wordFrom: number,
  wordTo: number,
  originalCursorPos: number
): void {
  const markers = FORMAT_MARKERS[format as WrapFormatType];
  /* v8 ignore next -- @preserve reason: caller ensures format is a valid WrapFormatType */
  if (!markers) return;

  const { prefix, suffix } = markers;
  const wordText = view.state.doc.sliceString(wordFrom, wordTo);

  // Calculate cursor offset within the word
  const cursorOffsetInWord = originalCursorPos - wordFrom;

  // Check if word is already wrapped with this format's markers
  const prefixStart = wordFrom - prefix.length;
  const suffixEnd = wordTo + suffix.length;
  const isAlreadyWrapped =
    prefixStart >= 0 &&
    suffixEnd <= view.state.doc.length &&
    view.state.doc.sliceString(prefixStart, wordFrom) === prefix &&
    view.state.doc.sliceString(wordTo, suffixEnd) === suffix;

  if (isAlreadyWrapped) {
    // Unwrap: remove the surrounding markers
    view.dispatch({
      changes: [
        { from: prefixStart, to: wordFrom, insert: "" },
        { from: wordTo, to: suffixEnd, insert: "" },
      ],
    });
    // Cursor position: shift left by prefix length
    const newCursorPos = prefixStart + cursorOffsetInWord;
    view.dispatch({
      selection: { anchor: newCursorPos },
    });
  } else {
    // Wrap: add markers around the word
    const wrapped = prefix + wordText + suffix;
    view.dispatch({
      changes: { from: wordFrom, to: wordTo, insert: wrapped },
    });
    // Cursor position: shift right by prefix length
    const newCursorPos = wordFrom + prefix.length + cursorOffsetInWord;
    view.dispatch({
      selection: { anchor: newCursorPos },
    });
  }

  view.focus();
}

/**
 * Clear formatting on the current selection. Multi-selection is handled
 * first; single selections strip markers in place.
 */
export function handleClearFormatting(view: EditorView): boolean {
  if (clearFormattingSelections(view)) return true;
  const { from, to } = view.state.selection.main;
  if (from === to) return false;
  const selectedText = view.state.doc.sliceString(from, to);
  const cleared = clearAllFormatting(selectedText);
  view.dispatch({
    changes: { from, to, insert: cleared },
    selection: { anchor: from, head: from + cleared.length },
  });
  view.focus();
  return true;
}

/**
 * Clear formatting across multiple selections.
 * Returns false if single selection or no text selected.
 */
export function clearFormattingSelections(view: EditorView): boolean {
  const { selection, doc } = view.state;
  if (selection.ranges.length <= 1) return false;
  const hasSelection = selection.ranges.some((range) => range.from !== range.to);
  if (!hasSelection) return false;

  const docText = doc.toString();
  const transaction = view.state.changeByRange((range) => {
    if (range.from === range.to) return { range };
    const selectedText = docText.slice(range.from, range.to);
    const cleared = clearAllFormatting(selectedText);
    return {
      changes: { from: range.from, to: range.to, insert: cleared },
      range: EditorSelection.range(range.from, range.from + cleared.length),
    };
  });

  view.dispatch(transaction);
  view.focus();
  return true;
}
