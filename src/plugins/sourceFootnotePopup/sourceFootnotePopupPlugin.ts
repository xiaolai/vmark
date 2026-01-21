/**
 * Source Footnote Popup Plugin
 *
 * CodeMirror 6 plugin for editing footnotes in Source mode.
 * Shows a popup when cursor is inside a footnote reference [^label]
 * or footnote definition [^label]: content
 */

import type { EditorView } from "@codemirror/view";
import { createSourcePopupPlugin } from "@/plugins/sourcePopup";
import { useFootnotePopupStore } from "@/stores/footnotePopupStore";
import { SourceFootnotePopupView } from "./SourceFootnotePopupView";
import { findFootnoteDefinition, findFootnoteReference } from "./sourceFootnoteActions";

/**
 * Footnote detection result.
 */
interface FootnoteMatch {
  from: number;
  to: number;
  label: string;
  isReference: boolean;
  content?: string;
}

/**
 * Find footnote at cursor position.
 * Detects both [^label] references and [^label]: definitions.
 */
function findFootnoteAtPos(view: EditorView, pos: number): FootnoteMatch | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineText = line.text;
  const lineStart = line.from;
  const cursorOffset = pos - lineStart;

  // First check for definition at start of line: [^label]: content
  const defRegex = /^\[\^([^\]]+)\]:\s*(.*)/;
  const defMatch = lineText.match(defRegex);
  if (defMatch) {
    // Cursor is somewhere on this definition line
    return {
      from: lineStart,
      to: line.to,
      label: defMatch[1],
      isReference: false,
      content: defMatch[2] || "",
    };
  }

  // Then check for references: [^label] (not followed by :)
  const refRegex = /\[\^([^\]]+)\](?!:)/g;
  let match;
  while ((match = refRegex.exec(lineText)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;

    // Check if cursor is inside this reference
    if (cursorOffset >= matchStart && cursorOffset <= matchEnd) {
      return {
        from: lineStart + matchStart,
        to: lineStart + matchEnd,
        label: match[1],
        isReference: true,
      };
    }
  }

  return null;
}

/**
 * Detect trigger for footnote popup.
 * Returns the footnote range if cursor is inside a footnote, null otherwise.
 */
function detectFootnoteTrigger(view: EditorView): { from: number; to: number } | null {
  const { from, to } = view.state.selection.main;
  if (from !== to) return null;
  const footnote = findFootnoteAtPos(view, from);
  if (!footnote) {
    return null;
  }
  return { from: footnote.from, to: footnote.to };
}

/**
 * Extract footnote data for the popup.
 */
function extractFootnoteData(
  view: EditorView,
  range: { from: number; to: number }
): {
  label: string;
  content: string;
  referencePos: number | null;
  definitionPos: number | null;
  openedOnReference: boolean;
} {
  const footnote = findFootnoteAtPos(view, range.from);
  if (!footnote) {
    return {
      label: "",
      content: "",
      referencePos: range.from,
      definitionPos: null,
      openedOnReference: true,
    };
  }

  const { label, isReference } = footnote;

  // Find both reference and definition positions
  let referencePos: number | null = footnote.from;
  let definitionPos: number | null = null;
  let content = "";

  if (isReference) {
    // Cursor is on reference - find the definition
    const def = findFootnoteDefinition(view, label);
    if (def) {
      definitionPos = def.from;
      content = def.content;
    }
  } else {
    // Cursor is on definition
    definitionPos = footnote.from;
    content = footnote.content || "";

    // Find the reference
    const ref = findFootnoteReference(view, label);
    referencePos = ref ? ref.from : null;
  }

  return {
    label,
    content,
    referencePos,
    definitionPos,
    openedOnReference: isReference,
  };
}

/**
 * Create the Source footnote popup plugin.
 */
export function createSourceFootnotePopupPlugin() {
  return createSourcePopupPlugin({
    store: useFootnotePopupStore,
    createView: (view, store) => new SourceFootnotePopupView(view, store),
    detectTrigger: detectFootnoteTrigger,
    detectTriggerAtPos: (view, pos) => {
      const footnote = findFootnoteAtPos(view, pos);
      if (!footnote) return null;
      return { from: footnote.from, to: footnote.to };
    },
    extractData: extractFootnoteData,
    onOpen: ({ popupView, data }) => {
      if (popupView instanceof SourceFootnotePopupView) {
        popupView.setOpenedOnReference(data.openedOnReference);
      }
    },
    openPopup: ({ anchorRect, data }) => {
      useFootnotePopupStore
        .getState()
        .openPopup(
          data.label,
          data.content,
          anchorRect as unknown as DOMRect,
          data.definitionPos,
          data.referencePos
        );
    },
    triggerOnClick: true,
    triggerOnHover: true,
    hoverDelay: 150,
    hoverHideDelay: 100,
  });
}
