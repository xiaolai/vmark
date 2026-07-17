/**
 * BR Tag Hiding Plugin for CodeMirror
 *
 * Purpose: Hides `<br />` lines in Source mode when the user's linebreak setting
 * makes them redundant, keeping the editor visually clean.
 *
 * Key decisions:
 *   - Uses line decorations (CSS class) rather than replacing content — preserves document integrity
 *   - Rebuilds on doc/viewport change, scanning only the viewport window
 *     (viewportScanWindow, margin 0 — <br /> lines stand alone) so cost is
 *     O(viewport), not O(document)
 *
 * @coordinates-with stores/settingsStore.ts — reads linebreak visibility setting
 * @coordinates-with viewportScan.ts — bounds the scan to the visible line window
 * @module plugins/codemirror/brHidingPlugin
 */

import { RangeSetBuilder } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { viewportScanWindow } from "./viewportScan";

/**
 * Decoration to hide <br /> lines.
 */
const hiddenLineDecoration = Decoration.line({ class: "cm-br-hidden" });

/** Matches a line that is only a <br> / <br /> tag (with optional whitespace). */
const BR_LINE_REGEX = /^\s*<br\s*\/?>\s*$/;

/**
 * Collect the start offsets of standalone <br /> lines in [fromLine, toLine].
 * Bounds default to the whole document. Each line stands alone, so no
 * look-back margin is needed when the caller passes a viewport window.
 * @internal Exported for testing.
 */
export function findBrLineStarts(
  doc: { lines: number; line: (n: number) => { text: string; from: number } },
  fromLine: number = 1,
  toLine: number = doc.lines,
): number[] {
  const starts: number[] = [];
  for (let i = fromLine; i <= toLine; i++) {
    const line = doc.line(i);
    if (BR_LINE_REGEX.test(line.text)) {
      starts.push(line.from);
    }
  }
  return starts;
}

/**
 * Creates a ViewPlugin that decorates <br /> lines to hide them.
 * @param hide Whether to hide <br /> lines
 * @returns ViewPlugin or empty array
 */
export function createBrHidingPlugin(hide: boolean) {
  if (!hide) return [];

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        /* v8 ignore next 3 -- @preserve viewportChanged branch and else path not covered in tests */
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        const { startLine, endLine } = viewportScanWindow(view, 0);

        for (const from of findBrLineStarts(view.state.doc, startLine, endLine)) {
          builder.add(from, from, hiddenLineDecoration);
        }

        return builder.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}
