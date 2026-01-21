/**
 * Source Multi-Cursor Plugin
 *
 * CodeMirror 6 plugin that provides enhanced multi-cursor support:
 * - Alt+Click to add/remove cursors
 * - Escape to collapse to single cursor
 */

import { EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { handleAltClick } from "./sourceAltClick";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";

/**
 * Collapse multi-selection to primary cursor.
 */
function collapseToSingleCursor(view: EditorView): boolean {
  const { selection } = view.state;

  if (selection.ranges.length <= 1) {
    return false; // Already single cursor
  }

  // Get the primary (main) cursor position
  const main = selection.main;

  view.dispatch({
    selection: EditorSelection.cursor(main.head),
  });

  return true;
}

/**
 * Plugin that handles Alt+Click events for multi-cursor.
 */
const altClickPlugin = ViewPlugin.fromClass(
  class {
    constructor(private view: EditorView) {
      this.view.dom.addEventListener("mousedown", this.handleMouseDown);
    }

    private handleMouseDown = (event: MouseEvent) => {
      handleAltClick(this.view, event);
    };

    destroy() {
      this.view.dom.removeEventListener("mousedown", this.handleMouseDown);
    }

    update(_update: ViewUpdate) {
      // No update handling needed
    }
  }
);

/**
 * Keymap for multi-cursor commands.
 */
const multiCursorKeymap = keymap.of([
  // Escape collapses to single cursor
  guardCodeMirrorKeyBinding({
    key: "Escape",
    run: (view) => collapseToSingleCursor(view),
    // Don't preventDefault if not handled (let other handlers process Escape)
  }),
]);

/**
 * Source multi-cursor extensions.
 * Includes Alt+Click support and Escape handling.
 */
export const sourceMultiCursorExtensions = [
  altClickPlugin,
  multiCursorKeymap,
];
