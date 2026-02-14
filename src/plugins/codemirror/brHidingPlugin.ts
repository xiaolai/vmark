/**
 * BR Tag Hiding Plugin for CodeMirror
 *
 * Purpose: Hides `<br />` lines in Source mode when the user's linebreak setting
 * makes them redundant, keeping the editor visually clean.
 *
 * Key decisions:
 *   - Uses line decorations (CSS class) rather than replacing content — preserves document integrity
 *   - Rebuilds decorations on every doc change for simplicity (br lines are rare)
 *
 * @coordinates-with stores/settingsStore.ts — reads linebreak visibility setting
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

/**
 * Decoration to hide <br /> lines.
 */
const hiddenLineDecoration = Decoration.line({ class: "cm-br-hidden" });

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
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        const doc = view.state.doc;

        for (let i = 1; i <= doc.lines; i++) {
          const line = doc.line(i);
          // Match lines that are just <br /> (with optional whitespace)
          if (/^\s*<br\s*\/?>\s*$/.test(line.text)) {
            builder.add(line.from, line.from, hiddenLineDecoration);
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
