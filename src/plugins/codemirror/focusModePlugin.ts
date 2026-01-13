/**
 * Focus Mode Plugin for CodeMirror (Source Mode)
 *
 * Dims all lines except the current paragraph.
 * A paragraph is defined as lines between blank lines.
 *
 * Mirrors the behavior of the WYSIWYG focus mode plugin.
 */

import { RangeSetBuilder } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { useEditorStore } from "@/stores/editorStore";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";

// Decoration to mark blurred (non-focused) lines
const blurDecoration = Decoration.line({ class: "cm-blur" });

/**
 * Find paragraph boundaries around a given line.
 * Returns [startLine, endLine] (1-indexed).
 */
function findParagraphBounds(
  doc: { lines: number; line: (n: number) => { text: string } },
  lineNum: number
): [number, number] {
  const isBlank = (n: number) => /^\s*$/.test(doc.line(n).text);

  // Find start (scan up to blank line or start of doc)
  let start = lineNum;
  while (start > 1 && !isBlank(start - 1)) {
    start--;
  }

  // Find end (scan down to blank line or end of doc)
  let end = lineNum;
  while (end < doc.lines && !isBlank(end + 1)) {
    end++;
  }

  return [start, end];
}

/**
 * Creates a ViewPlugin that dims non-focused paragraphs.
 * Subscribes to editorStore.focusModeEnabled for toggle.
 */
export function createSourceFocusModePlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      unsubscribe: (() => void) | null = null;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);

        // Subscribe to store changes to rebuild decorations
        this.unsubscribe = useEditorStore.subscribe((state, prevState) => {
          if (state.focusModeEnabled !== prevState.focusModeEnabled) {
            this.decorations = this.buildDecorations(view);
            // Force view update by dispatching empty transaction (guard IME)
            runOrQueueCodeMirrorAction(view, () => view.dispatch({}));
          }
        });
      }

      update(update: ViewUpdate) {
        // Rebuild when selection or document changes
        if (update.selectionSet || update.docChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      destroy() {
        if (this.unsubscribe) {
          this.unsubscribe();
        }
      }

      buildDecorations(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();

        // Check if focus mode is enabled
        if (!useEditorStore.getState().focusModeEnabled) {
          return builder.finish();
        }

        const doc = view.state.doc;
        const totalLines = doc.lines;

        if (totalLines === 0) return builder.finish();

        // Get current cursor line
        const { from } = view.state.selection.main;
        const currentLineNum = doc.lineAt(from).number;

        // Find paragraph bounds
        const [paragraphStart, paragraphEnd] = findParagraphBounds(
          doc,
          currentLineNum
        );

        // Mark all lines OUTSIDE the current paragraph as blurred
        for (let i = 1; i <= totalLines; i++) {
          if (i < paragraphStart || i > paragraphEnd) {
            const line = doc.line(i);
            builder.add(line.from, line.from, blurDecoration);
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
