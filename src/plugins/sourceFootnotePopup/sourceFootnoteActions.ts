/**
 * Source Footnote Actions
 *
 * Actions for editing footnotes in Source mode (CodeMirror 6).
 */

import type { EditorView } from "@codemirror/view";
import { useFootnotePopupStore } from "@/stores/footnotePopupStore";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";

/**
 * Save footnote content changes.
 * Updates the definition content in the document.
 */
export function saveFootnoteContent(view: EditorView): void {
  const state = useFootnotePopupStore.getState();
  const { content, definitionPos, label } = state;

  if (definitionPos === null) {
    // No definition found - nothing to save
    return;
  }

  runOrQueueCodeMirrorAction(view, () => {
    const doc = view.state.doc;
    const line = doc.lineAt(definitionPos);
    const currentText = line.text;

    // Extract just the content part after [^label]:
    const defMatch = currentText.match(/^\[\^([^\]]+)\]:\s*/);
    if (!defMatch) {
      console.warn("[SourceFootnote] Definition format not found");
      return;
    }

    const newText = `[^${label}]: ${content}`;

    // Find the end of the definition line
    view.dispatch({
      changes: {
        from: line.from,
        to: line.to,
        insert: newText,
      },
    });
  });
}

/**
 * Go to the footnote definition from reference (or vice versa).
 */
export function gotoFootnoteTarget(view: EditorView, openedOnReference: boolean): void {
  const state = useFootnotePopupStore.getState();
  const { definitionPos, referencePos } = state;

  runOrQueueCodeMirrorAction(view, () => {
    const targetPos = openedOnReference ? definitionPos : referencePos;
    if (targetPos === null) {
      console.warn("[SourceFootnote] Target position not found");
      return;
    }

    // Scroll to and select at target
    view.dispatch({
      selection: { anchor: targetPos },
      scrollIntoView: true,
    });
  });
}

/**
 * Remove the footnote completely (both reference and definition).
 */
export function removeFootnote(view: EditorView): void {
  const state = useFootnotePopupStore.getState();
  const { label, definitionPos, referencePos } = state;
  const reference = label
    ? findFootnoteReferenceAtPos(view, label, referencePos) ?? findFootnoteReference(view, label)
    : null;
  if (!reference) return;

  runOrQueueCodeMirrorAction(view, () => {
    const doc = view.state.doc;
    const changes: { from: number; to: number; insert: string }[] = [];

    // Get actual definition extent (entire line if it exists)
    let defLineFrom: number | null = null;
    let defLineTo: number | null = null;
    if (definitionPos !== null) {
      const defLine = doc.lineAt(definitionPos);
      defLineFrom = defLine.from;
      // Include the newline if there is one
      defLineTo = defLine.to < doc.length ? defLine.to + 1 : defLine.to;
    }

    // Delete in reverse order (later positions first) to preserve earlier positions
    if (defLineFrom !== null && defLineTo !== null && defLineFrom > reference.to) {
      // Definition is after reference - delete definition first
      changes.push({ from: defLineFrom, to: defLineTo, insert: "" });
      changes.push({ from: reference.from, to: reference.to, insert: "" });
    } else if (defLineFrom !== null && defLineTo !== null) {
      // Definition is before reference - delete reference first
      changes.push({ from: reference.from, to: reference.to, insert: "" });
      changes.push({ from: defLineFrom, to: defLineTo, insert: "" });
    } else {
      // No definition, just delete reference
      changes.push({ from: reference.from, to: reference.to, insert: "" });
    }

    view.dispatch({ changes });
  });
}

function findFootnoteReferenceAtPos(
  view: EditorView,
  label: string,
  pos: number | null
): { from: number; to: number } | null {
  if (pos === null) return null;
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const text = line.text;
  const refRegex = new RegExp(`\\[\\^${escapeRegex(label)}\\](?!:)`, "g");
  let match;
  while ((match = refRegex.exec(text)) !== null) {
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (pos >= from && pos <= to) {
      return { from, to };
    }
  }
  return null;
}

/**
 * Find the footnote definition for a given label in the document.
 * Returns the position and content, or null if not found.
 */
export function findFootnoteDefinition(
  view: EditorView,
  label: string
): { from: number; to: number; content: string } | null {
  const doc = view.state.doc;
  const defRegex = new RegExp(`^\\[\\^${escapeRegex(label)}\\]:\\s*(.*)$`);

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const match = line.text.match(defRegex);
    if (match) {
      return {
        from: line.from,
        to: line.to,
        content: match[1] || "",
      };
    }
  }

  return null;
}

/**
 * Find the footnote reference for a given label in the document.
 * Returns the first occurrence's position, or null if not found.
 */
export function findFootnoteReference(
  view: EditorView,
  label: string
): { from: number; to: number } | null {
  const doc = view.state.doc;
  const refRegex = new RegExp(`\\[\\^${escapeRegex(label)}\\](?!:)`);

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const match = line.text.match(refRegex);
    if (match && match.index !== undefined) {
      return {
        from: line.from + match.index,
        to: line.from + match.index + match[0].length,
      };
    }
  }

  return null;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
