/**
 * List Blank Line Hiding Plugin for CodeMirror
 *
 * Purpose: Hides empty lines between list items in Source mode so that loose lists
 * (which require blank lines for correct markdown parsing) appear visually tight.
 *
 * Key decisions:
 *   - Only hides blank lines that are between two list item lines — won't affect
 *     blank lines at the end of a list or between unrelated blocks
 *   - Uses line decorations (CSS class) to hide, not content replacement
 *
 * @module plugins/codemirror/listBlankLinePlugin
 */

import { RangeSetBuilder } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * Decoration to hide blank lines between list items.
 */
const hiddenLineDecoration = Decoration.line({ class: "cm-list-blank-hidden" });

/**
 * Check if a line is a list item (unordered or ordered).
 */
function isListItem(text: string): boolean {
  // Unordered: - item, * item, + item (with optional leading whitespace)
  // Ordered: 1. item, 2) item, etc.
  return /^\s*[-*+]\s/.test(text) || /^\s*\d+[.)]\s/.test(text);
}

/**
 * Check if a line is empty or contains only whitespace.
 */
function isBlankLine(text: string): boolean {
  return /^\s*$/.test(text);
}

type LineType = "list" | "blank" | "other";

/**
 * Classify a line's type.
 */
function getLineType(text: string): LineType {
  if (isBlankLine(text)) return "blank";
  if (isListItem(text)) return "list";
  return "other";
}

/**
 * Creates a ViewPlugin that hides blank lines between list items.
 * Uses O(n) algorithm with two passes instead of O(n²) nested loops.
 */
export function createListBlankLinePlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        const doc = view.state.doc;
        const totalLines = doc.lines;

        if (totalLines === 0) return builder.finish();

        // Pass 1: Classify all lines
        const lineTypes: LineType[] = [];
        for (let i = 1; i <= totalLines; i++) {
          lineTypes.push(getLineType(doc.line(i).text));
        }

        // Pass 2: Compute next non-blank type for each position (backward)
        const nextNonBlank: (LineType | null)[] = new Array(totalLines).fill(null);
        let nextType: LineType | null = null;
        for (let i = totalLines - 1; i >= 0; i--) {
          nextNonBlank[i] = nextType;
          if (lineTypes[i] !== "blank") {
            nextType = lineTypes[i];
          }
        }

        // Pass 3: Decorate blank lines between list items (tracking prev as we go)
        let prevType: LineType | null = null;
        for (let i = 0; i < totalLines; i++) {
          if (lineTypes[i] === "blank") {
            if (prevType === "list" && nextNonBlank[i] === "list") {
              const line = doc.line(i + 1); // doc.line is 1-indexed
              builder.add(line.from, line.from, hiddenLineDecoration);
            }
          } else {
            prevType = lineTypes[i];
          }
        }

        return builder.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}
