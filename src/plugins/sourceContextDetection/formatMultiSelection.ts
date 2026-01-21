import { EditorSelection, type SelectionRange, type Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { FORMAT_MARKERS, type FormatType, type WrapFormatType } from "./formatTypes";
import { getOppositeFormat, isWrapped, unwrap, wrap } from "./formatUtils";
import { findWordBoundaries } from "@/utils/wordSegmentation";

type RangeFormatResult = {
  changes?: { from: number; to: number; insert: string } | Array<{ from: number; to: number; insert: string }>;
  range: SelectionRange;
};

function unwrapOppositeInRange(
  doc: string,
  format: FormatType,
  from: number,
  to: number,
  selectedText: string
): RangeFormatResult | null {
  const oppositeFormat = getOppositeFormat(format);
  if (!oppositeFormat) return null;

  const { prefix, suffix } = FORMAT_MARKERS[oppositeFormat];
  if (isWrapped(selectedText, prefix, suffix)) {
    const unwrapped = unwrap(selectedText, prefix, suffix);
    return {
      changes: { from, to, insert: unwrapped },
      range: EditorSelection.range(from, from + unwrapped.length),
    };
  }

  const prefixStart = from - prefix.length;
  const suffixEnd = to + suffix.length;
  if (prefixStart >= 0 && suffixEnd <= doc.length) {
    const textBefore = doc.slice(prefixStart, from);
    const textAfter = doc.slice(to, suffixEnd);
    if (textBefore === prefix && textAfter === suffix) {
      return {
        changes: [
          { from: prefixStart, to: from, insert: "" },
          { from: to, to: suffixEnd, insert: "" },
        ],
        range: EditorSelection.range(prefixStart, prefixStart + selectedText.length),
      };
    }
  }

  return null;
}

/**
 * Find word boundaries at cursor position within document.
 */
function findWordAtPosition(
  docText: Text,
  pos: number
): { from: number; to: number } | null {
  const line = docText.lineAt(pos);
  const offsetInLine = pos - line.from;
  const boundaries = findWordBoundaries(line.text, offsetInLine);
  if (!boundaries) return null;
  return {
    from: line.from + boundaries.start,
    to: line.from + boundaries.end,
  };
}

function formatRange(
  doc: string,
  docText: Text,
  range: SelectionRange,
  format: WrapFormatType
): RangeFormatResult {
  let { from, to } = range;
  const originalCursorPos = from;
  let expandedToWord = false;

  // No selection: expand to word at cursor
  if (from === to) {
    const wordRange = findWordAtPosition(docText, from);
    if (wordRange) {
      from = wordRange.from;
      to = wordRange.to;
      expandedToWord = true;
    } else {
      // No word found, insert empty markers
      const { prefix, suffix } = FORMAT_MARKERS[format];
      return {
        changes: { from, to, insert: `${prefix}${suffix}` },
        range: EditorSelection.range(from + prefix.length, from + prefix.length),
      };
    }
  }

  const selectedText = doc.slice(from, to);
  const cursorOffsetInWord = originalCursorPos - from;
  const oppositeResult = unwrapOppositeInRange(doc, format, from, to, selectedText);
  if (oppositeResult) {
    // Adjust cursor position if we expanded to word
    if (expandedToWord && oppositeResult.range) {
      const newPos = oppositeResult.range.from + cursorOffsetInWord;
      return {
        ...oppositeResult,
        range: EditorSelection.cursor(newPos),
      };
    }
    return oppositeResult;
  }

  const { prefix, suffix } = FORMAT_MARKERS[format];
  if (isWrapped(selectedText, prefix, suffix)) {
    const unwrapped = unwrap(selectedText, prefix, suffix);
    const newCursorPos = expandedToWord ? from + cursorOffsetInWord : from;
    return {
      changes: { from, to, insert: unwrapped },
      range: expandedToWord
        ? EditorSelection.cursor(newCursorPos)
        : EditorSelection.range(from, from + unwrapped.length),
    };
  }

  const prefixStart = from - prefix.length;
  const suffixEnd = to + suffix.length;
  if (prefixStart >= 0 && suffixEnd <= doc.length) {
    const textBefore = doc.slice(prefixStart, from);
    const textAfter = doc.slice(to, suffixEnd);
    if (textBefore === prefix && textAfter === suffix) {
      // Unwrap: remove surrounding markers
      const newCursorPos = expandedToWord
        ? prefixStart + cursorOffsetInWord
        : prefixStart;
      return {
        changes: [
          { from: prefixStart, to: from, insert: "" },
          { from: to, to: suffixEnd, insert: "" },
        ],
        range: expandedToWord
          ? EditorSelection.cursor(newCursorPos)
          : EditorSelection.range(prefixStart, prefixStart + selectedText.length),
      };
    }
  }

  // Wrap with markers
  const wrapped = wrap(selectedText, prefix, suffix);
  const newCursorPos = expandedToWord
    ? from + prefix.length + cursorOffsetInWord
    : from + prefix.length;
  return {
    changes: { from, to, insert: wrapped },
    range: expandedToWord
      ? EditorSelection.cursor(newCursorPos)
      : EditorSelection.range(from + prefix.length, from + prefix.length + selectedText.length),
  };
}

export function applyInlineFormatToSelections(
  view: EditorView,
  format: WrapFormatType
): boolean {
  const { state } = view;
  if (state.selection.ranges.length <= 1) return false;

  const docText = state.doc;
  const doc = docText.toString();
  const transaction = state.changeByRange((range) => formatRange(doc, docText, range, format));
  view.dispatch(transaction);
  view.focus();
  return true;
}
