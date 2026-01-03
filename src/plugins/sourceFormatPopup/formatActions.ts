/**
 * Markdown Format Actions for CodeMirror
 *
 * Provides wrap/unwrap functionality for markdown formatting markers.
 */

import type { EditorView } from "@codemirror/view";

export type FormatType =
  | "bold"
  | "italic"
  | "code"
  | "strikethrough"
  | "highlight"
  | "link"
  | "image"
  | "superscript"
  | "subscript"
  | "footnote";

interface FormatMarkers {
  prefix: string;
  suffix: string;
}

// Formats that use simple prefix/suffix wrapping
type WrapFormatType = Exclude<FormatType, "footnote">;

const FORMAT_MARKERS: Record<WrapFormatType, FormatMarkers> = {
  bold: { prefix: "**", suffix: "**" },
  italic: { prefix: "*", suffix: "*" },
  code: { prefix: "`", suffix: "`" },
  strikethrough: { prefix: "~~", suffix: "~~" },
  highlight: { prefix: "==", suffix: "==" },
  link: { prefix: "[", suffix: "](url)" },
  image: { prefix: "![", suffix: "](url)" },
  superscript: { prefix: "^", suffix: "^" },
  subscript: { prefix: "~", suffix: "~" },
};

/**
 * Check if text is wrapped with specific markers.
 */
function isWrapped(text: string, prefix: string, suffix: string): boolean {
  return text.startsWith(prefix) && text.endsWith(suffix);
}

/**
 * Unwrap text by removing prefix and suffix.
 */
function unwrap(text: string, prefix: string, suffix: string): string {
  return text.slice(prefix.length, text.length - suffix.length);
}

/**
 * Wrap text with prefix and suffix.
 */
function wrap(text: string, prefix: string, suffix: string): string {
  return `${prefix}${text}${suffix}`;
}

interface FootnoteRef {
  label: string;
  start: number;
  end: number;
}

interface FootnoteDef {
  label: string;
  start: number;
  end: number;
}

/**
 * Find all footnote references [^N] in document order.
 */
function findAllReferences(doc: string): FootnoteRef[] {
  const refs: FootnoteRef[] = [];
  const pattern = /\[\^(\d+)\]/g;
  let match;
  while ((match = pattern.exec(doc)) !== null) {
    refs.push({
      label: match[1],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return refs;
}

/**
 * Find all footnote definitions [^N]: in document.
 */
function findAllDefinitions(doc: string): FootnoteDef[] {
  const defs: FootnoteDef[] = [];
  // Match definition line: [^N]: content (until end of line or next definition)
  const pattern = /^\[\^(\d+)\]:.*$/gm;
  let match;
  while ((match = pattern.exec(doc)) !== null) {
    defs.push({
      label: match[1],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return defs;
}

/**
 * Renumber all footnotes to be sequential based on reference order.
 * Returns the new document content if changes were made.
 */
function renumberFootnotes(doc: string): string | null {
  const refs = findAllReferences(doc);
  if (refs.length === 0) return null;

  // Build label mapping based on reference order (first occurrence)
  const labelMap = new Map<string, string>();
  const seenLabels = new Set<string>();
  let nextNum = 1;

  for (const ref of refs) {
    if (!seenLabels.has(ref.label)) {
      seenLabels.add(ref.label);
      labelMap.set(ref.label, String(nextNum));
      nextNum++;
    }
  }

  // Check if renumbering is needed
  let needsRenumber = false;
  for (const [oldLabel, newLabel] of labelMap) {
    if (oldLabel !== newLabel) {
      needsRenumber = true;
      break;
    }
  }
  if (!needsRenumber) return null;

  // Replace all references and definitions with new labels
  let result = doc;

  // Replace definitions first (they're usually at the end)
  const defs = findAllDefinitions(result);
  // Process in reverse order to maintain positions
  for (let i = defs.length - 1; i >= 0; i--) {
    const def = defs[i];
    const newLabel = labelMap.get(def.label);
    if (newLabel && newLabel !== def.label) {
      // Replace just the [^N]: part
      const defPattern = new RegExp(`\\[\\^${def.label}\\]:`);
      const lineContent = result.slice(def.start, def.end);
      const newLineContent = lineContent.replace(defPattern, `[^${newLabel}]:`);
      result = result.slice(0, def.start) + newLineContent + result.slice(def.end);
    }
  }

  // Replace references
  // Need to re-find refs since positions may have changed
  const updatedRefs = findAllReferences(result);
  for (let i = updatedRefs.length - 1; i >= 0; i--) {
    const ref = updatedRefs[i];
    const newLabel = labelMap.get(ref.label);
    if (newLabel && newLabel !== ref.label) {
      result = result.slice(0, ref.start) + `[^${newLabel}]` + result.slice(ref.end);
    }
  }

  return result;
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

  if (renumberedDoc) {
    // Find where our new reference is (count refs before position 'to')
    const refsBeforeInsert = findAllReferences(doc).filter(r => r.start < to).length;
    const newLabel = String(refsBeforeInsert + 1);
    const newRefEnd = to + `[^${newLabel}]`.length;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: renumberedDoc },
      selection: { anchor: newRefEnd },
    });
  } else {
    // No renumbering needed, just set cursor
    view.dispatch({
      selection: { anchor: to + ref.length },
    });
  }

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
export function applyFormat(view: EditorView, format: FormatType): void {
  const { from, to } = view.state.selection.main;

  // Must have a selection
  if (from === to) return;

  const selectedText = view.state.doc.sliceString(from, to);

  // Handle footnote specially - it's not a simple wrap/unwrap
  if (format === "footnote") {
    applyFootnote(view, from, to, selectedText);
    return;
  }

  // Handle image specially - insert after selection with selected text as alt
  if (format === "image") {
    applyImage(view, from, to, selectedText);
    return;
  }

  const { prefix, suffix } = FORMAT_MARKERS[format as WrapFormatType];

  // Check if already wrapped
  if (isWrapped(selectedText, prefix, suffix)) {
    // Unwrap
    const unwrapped = unwrap(selectedText, prefix, suffix);
    view.dispatch({
      changes: { from, to, insert: unwrapped },
      selection: { anchor: from, head: from + unwrapped.length },
    });
  } else {
    // Check if surrounding text has the markers (expand selection case)
    const prefixStart = from - prefix.length;
    const suffixEnd = to + suffix.length;

    if (prefixStart >= 0 && suffixEnd <= view.state.doc.length) {
      const textBefore = view.state.doc.sliceString(prefixStart, from);
      const textAfter = view.state.doc.sliceString(to, suffixEnd);

      if (textBefore === prefix && textAfter === suffix) {
        // Remove surrounding markers
        view.dispatch({
          changes: [
            { from: prefixStart, to: from, insert: "" },
            { from: to, to: suffixEnd, insert: "" },
          ],
          selection: { anchor: prefixStart, head: prefixStart + selectedText.length },
        });
        return;
      }
    }

    // Wrap with markers
    const wrapped = wrap(selectedText, prefix, suffix);
    view.dispatch({
      changes: { from, to, insert: wrapped },
      selection: {
        anchor: from + prefix.length,
        head: from + prefix.length + selectedText.length,
      },
    });

    // For links, position cursor at "url" placeholder
    if (format === "link") {
      const urlStart = from + prefix.length + selectedText.length + 2; // After "]("
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
