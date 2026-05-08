/**
 * Purpose: CodeMirror 6 counterpart to the WYSIWYG inactive-selection
 *   plugin. While the source view is blurred, render each non-empty
 *   selection range as a `Decoration.mark` so the user can still see
 *   what they have selected when typing in the built-in terminal.
 *
 * Key decisions:
 *   - Rebuild decorations on `focusChanged`, `selectionSet`, and
 *     `docChanged`. Cost is O(rangeCount) per update — multi-cursor
 *     selections are usually a handful of ranges.
 *   - `Decoration.mark` (inline) rather than line decoration: matches the
 *     ProseMirror plugin's per-range overlay semantics and avoids
 *     dimming gutters / line-number columns.
 *   - Reuses the same CSS class as the WYSIWYG plugin so dim styling is
 *     defined exactly once.
 *
 * @coordinates-with plugins/inactiveSelection/inactiveSelectionPlugin.ts —
 *   sibling plugin for ProseMirror; both target `.vmark-inactive-selection`
 * @module plugins/codemirror/inactiveSelectionPlugin
 */
import {
  ViewPlugin,
  type ViewUpdate,
  type EditorView,
  Decoration,
  type DecorationSet,
} from "@codemirror/view";
import { INACTIVE_SELECTION_CLASS } from "@/plugins/inactiveSelection/constants";
import "@/plugins/inactiveSelection/inactive-selection.css";

export { INACTIVE_SELECTION_CLASS };

const inactiveMark = Decoration.mark({ class: INACTIVE_SELECTION_CLASS });

class InactiveSelectionView {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = build(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.focusChanged ||
      update.selectionSet ||
      update.docChanged
    ) {
      this.decorations = build(update.view);
    }
  }
}

function build(view: EditorView): DecorationSet {
  if (view.hasFocus) return Decoration.none;
  const ranges = view.state.selection.ranges
    .filter((r) => !r.empty)
    .map((r) => inactiveMark.range(r.from, r.to));
  return Decoration.set(ranges, true);
}

export const inactiveSelectionViewPlugin = ViewPlugin.fromClass(
  InactiveSelectionView,
  { decorations: (v) => v.decorations },
);

export const inactiveSelectionExtensions = [inactiveSelectionViewPlugin];
