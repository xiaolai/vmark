/**
 * Markdown Format Actions for CodeMirror
 *
 * Provides wrap/unwrap functionality for markdown formatting markers.
 */

import type { EditorView } from "@codemirror/view";
import { stripBlockMarkup } from "@/plugins/shared/lineContent";
import { parseReferences, renumberFootnotes } from "./footnoteActions";
import { FORMAT_MARKERS, type FormatType, type WrapFormatType } from "./formatTypes";
import { getOppositeFormat, isWrapped, unwrap, wrap } from "./formatUtils";

function unwrapOppositeFormat(
  view: EditorView,
  format: FormatType,
  from: number,
  to: number,
  selectedText: string
): { from: number; to: number; text: string } | null {
  const oppositeFormat = getOppositeFormat(format);
  if (!oppositeFormat) return null;

  const { prefix, suffix } = FORMAT_MARKERS[oppositeFormat];
  if (isWrapped(selectedText, prefix, suffix)) {
    const unwrapped = unwrap(selectedText, prefix, suffix);
    view.dispatch({
      changes: { from, to, insert: unwrapped },
      selection: { anchor: from, head: from + unwrapped.length },
    });
    return { from, to: from + unwrapped.length, text: unwrapped };
  }

  const prefixStart = from - prefix.length;
  const suffixEnd = to + suffix.length;
  if (prefixStart >= 0 && suffixEnd <= view.state.doc.length) {
    const textBefore = view.state.doc.sliceString(prefixStart, from);
    const textAfter = view.state.doc.sliceString(to, suffixEnd);
    if (textBefore === prefix && textAfter === suffix) {
      view.dispatch({
        changes: [
          { from: prefixStart, to: from, insert: "" },
          { from: to, to: suffixEnd, insert: "" },
        ],
        selection: { anchor: prefixStart, head: prefixStart + selectedText.length },
      });
      return { from: prefixStart, to: prefixStart + selectedText.length, text: selectedText };
    }
  }

  return null;
}


/**
 * Apply footnote formatting with smart numbering.
 * Inserts reference after selection, adds definition at end, then renumbers all.
 */
function applyFootnote(
  view: EditorView,
  _from: number,
  to: number,
  selectedText: string
): void {
  const doc = view.state.doc.toString();
  const docLength = doc.length;

  // Use a temporary label that will be fixed by renumber
  const tempLabel = "999";
  const ref = `[^${tempLabel}]`;

  // Build the definition - always append at end of document
  const needsNewline = docLength > 0 && doc[docLength - 1] !== "\n";
  const definition = `${needsNewline ? "\n\n" : "\n"}[^${tempLabel}]: ${selectedText}`;

  // Insert reference at selection end, definition at document end
  view.dispatch({
    changes: [
      { from: to, to: to, insert: ref },
      { from: docLength, to: docLength, insert: definition },
    ],
  });

  // Now renumber all footnotes
  const newDoc = view.state.doc.toString();
  const renumberedDoc = renumberFootnotes(newDoc);

  /* v8 ignore next -- @preserve reason: false branch (renumberFootnotes returns null) unreachable in practice */
  if (renumberedDoc) {
    // Find where our new reference is (count refs before position 'to')
    const refsBeforeInsert = parseReferences(doc).filter((r) => r.start < to).length;
    const newLabel = String(refsBeforeInsert + 1);
    const newRefEnd = to + `[^${newLabel}]`.length;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: renumberedDoc },
      selection: { anchor: newRefEnd },
    });
  /* v8 ignore start -- @preserve reason: renumberFootnotes always returns a value in practice */
  } else {
    view.dispatch({
      selection: { anchor: to + ref.length },
    });
  }
  /* v8 ignore stop */

  view.focus();
}

/**
 * Apply image formatting.
 * Inserts image syntax after selection with blank caption.
 */
function applyImage(
  view: EditorView,
  _from: number,
  to: number,
  _selectedText: string
): void {
  // Insert space + image after selection with blank caption
  const image = " ![](url)";

  view.dispatch({
    changes: { from: to, to: to, insert: image },
    // Select "url" for easy replacement
    selection: { anchor: to + 5, head: to + 8 },
  });

  view.focus();
}

/**
 * Apply or toggle markdown formatting on the current selection.
 *
 * - If selection is already wrapped → unwrap
 * - If not wrapped → wrap with markers
 * - For links: places cursor in url position
 * - For footnotes: inserts reference + definition with smart numbering
 */
/**
 * Move `from` past any BLOCK MARKUP the selection starts on.
 *
 * `### Title` selected whole and bolded produced `**### Title**` — the heading
 * marker inside the emphasis, which is not a heading and not bold. Same for
 * `- item` and `> quote`, and a selected table came back wrapped entirely in
 * `**`. WYSIWYG cannot reproduce any of it: the marker is not text there, so
 * there is nothing to select.
 *
 * The fix belongs HERE rather than in `selectBlock`. Narrowing the selection
 * instead would have changed what Delete and replace do in a TEXT surface,
 * where the marker legitimately IS text — and it would have missed the case
 * this actually starts from, a user dragging across the line by hand.
 */
function contentStart(view: EditorView, from: number): number {
  const line = view.state.doc.lineAt(from);
  if (from !== line.from) return from; // mid-line: the user meant those chars
  const { content } = stripBlockMarkup(line.text);
  // Nothing stripped means nothing to skip — a plain paragraph, or an
  // indented-code line, where `stripBlockMarkup` returns the line whole
  // because past four columns nothing on it is markup.
  const prefixLength = line.text.length - content.length;
  if (prefixLength <= 0) return from;
  return Math.min(line.from + prefixLength, line.to);
}

export function applyFormat(view: EditorView, format: FormatType): void {
  const { to } = view.state.selection.main;
  const from = contentStart(view, view.state.selection.main.from);

  // Must have a selection
  if (from >= to) return;

  const selectedText = view.state.doc.sliceString(from, to);
  const updatedSelection = unwrapOppositeFormat(view, format, from, to, selectedText);
  const activeFrom = updatedSelection?.from ?? from;
  const activeTo = updatedSelection?.to ?? to;
  const activeText = updatedSelection?.text ?? selectedText;

  // Handle footnote specially - it's not a simple wrap/unwrap
  if (format === "footnote") {
    applyFootnote(view, activeFrom, activeTo, activeText);
    return;
  }

  // Handle image specially - insert after selection with selected text as alt
  if (format === "image") {
    applyImage(view, activeFrom, activeTo, activeText);
    return;
  }

  const { prefix, suffix } = FORMAT_MARKERS[format as WrapFormatType];

  // Check if already wrapped
  if (isWrapped(activeText, prefix, suffix)) {
    // Unwrap
    const unwrapped = unwrap(activeText, prefix, suffix);
    view.dispatch({
      changes: { from: activeFrom, to: activeTo, insert: unwrapped },
      selection: { anchor: activeFrom, head: activeFrom + unwrapped.length },
    });
  } else {
    // Check if surrounding text has the markers (expand selection case)
    const prefixStart = activeFrom - prefix.length;
    const suffixEnd = activeTo + suffix.length;

    if (prefixStart >= 0 && suffixEnd <= view.state.doc.length) {
      const textBefore = view.state.doc.sliceString(prefixStart, activeFrom);
      const textAfter = view.state.doc.sliceString(activeTo, suffixEnd);

      if (textBefore === prefix && textAfter === suffix) {
        // Remove surrounding markers
        view.dispatch({
          changes: [
            { from: prefixStart, to: activeFrom, insert: "" },
            { from: activeTo, to: suffixEnd, insert: "" },
          ],
          selection: { anchor: prefixStart, head: prefixStart + activeText.length },
        });
        return;
      }
    }

    // Wrap with markers
    const wrapped = wrap(activeText, prefix, suffix);
    view.dispatch({
      changes: { from: activeFrom, to: activeTo, insert: wrapped },
      selection: {
        anchor: activeFrom + prefix.length,
        head: activeFrom + prefix.length + activeText.length,
      },
    });

    // For links, position cursor at "url" placeholder
    if (format === "link") {
      const urlStart = activeFrom + prefix.length + activeText.length + 2; // After "]("
      const urlEnd = urlStart + 3; // "url" length
      view.dispatch({
        selection: { anchor: urlStart, head: urlEnd },
      });
    }
  }

  // Refocus the editor
  view.focus();
}

/**
 * Check if current selection has a specific format applied.
 */
export function hasFormat(view: EditorView, format: FormatType): boolean {
  const { from, to } = view.state.selection.main;
  if (from === to) return false;

  // Footnote and image are not toggleable - always return false
  if (format === "footnote" || format === "image") return false;

  const selectedText = view.state.doc.sliceString(from, to);
  const { prefix, suffix } = FORMAT_MARKERS[format as WrapFormatType];

  // Check if selection itself is wrapped
  if (isWrapped(selectedText, prefix, suffix)) {
    return true;
  }

  // Check if surrounding text has markers
  const prefixStart = from - prefix.length;
  const suffixEnd = to + suffix.length;

  if (prefixStart >= 0 && suffixEnd <= view.state.doc.length) {
    const textBefore = view.state.doc.sliceString(prefixStart, from);
    const textAfter = view.state.doc.sliceString(to, suffixEnd);
    return textBefore === prefix && textAfter === suffix;
  }

  return false;
}
