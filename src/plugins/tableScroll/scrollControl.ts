/**
 * Table Scroll Control
 *
 * Purpose: Overrides ProseMirror's default scrollIntoView behavior when the
 * cursor is inside a table. ProseMirror's built-in scrollRectIntoView walks
 * every scrollable ancestor and adjusts scrollTop/scrollLeft on each —
 * including `.table-scroll-wrapper` (overflow-x: auto), which causes unwanted
 * horizontal scroll jumps. This plugin uses the `handleScrollToSelection` prop
 * to perform controlled scrolling: only `.editor-content` is scrolled vertically,
 * and table wrappers are left untouched.
 *
 * Key decisions:
 *   - Uses handleScrollToSelection (official ProseMirror escape hatch)
 *   - Only intercepts when cursor is inside a table node — all other scroll
 *     behavior falls through to ProseMirror's default
 *   - Scroll margin (20px) ensures cursor isn't flush against container edge
 *   - Always returns true when in a table to suppress ProseMirror's default
 *     scroll algorithm, even if our custom scroll encounters an error
 *
 * @coordinates-with tableScroll/index.ts — the NodeView that creates the scroll wrapper
 * @coordinates-with editor.css — .editor-content (overflow-y: auto) and .table-scroll-wrapper
 * @module plugins/tableScroll/scrollControl
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const SCROLL_MARGIN = 20;

const tableScrollControlKey = new PluginKey("tableScrollControl");

/**
 * Check whether the current selection head is inside a table node.
 */
export function isSelectionInTable(view: EditorView): boolean {
  const { $head } = view.state.selection;
  for (let d = $head.depth; d > 0; d--) {
    if ($head.node(d).type.name === "table") {
      return true;
    }
  }
  return false;
}

/**
 * Scroll only the editor's main scroll container (.editor-content) to make
 * the cursor visible. Does NOT touch any inner scroll wrappers.
 *
 * Always returns true so that ProseMirror's default scroll algorithm is
 * suppressed when the cursor is inside a table — even if the scroll container
 * is missing or coordsAtPos fails. Letting the default through would
 * reintroduce the horizontal scroll jumps this plugin exists to prevent.
 */
export function scrollEditorToSelection(view: EditorView): true {
  const scrollContainer = view.dom.closest(".editor-content") as HTMLElement | null;
  if (!scrollContainer) return true;

  let coords: { top: number; bottom: number; left: number; right: number };
  try {
    coords = view.coordsAtPos(view.state.selection.head, 1);
  } catch {
    return true;
  }

  const rect = scrollContainer.getBoundingClientRect();

  // Vertical scroll: bring cursor into view within the editor container
  if (coords.top < rect.top + SCROLL_MARGIN) {
    scrollContainer.scrollTop -= rect.top + SCROLL_MARGIN - coords.top;
  } else if (coords.bottom > rect.bottom - SCROLL_MARGIN) {
    scrollContainer.scrollTop += coords.bottom - rect.bottom + SCROLL_MARGIN;
  }

  return true;
}

/**
 * Extension that overrides scroll-to-selection for table cells.
 *
 * When the cursor is in a table, performs vertical-only scrolling on
 * .editor-content and prevents ProseMirror from adjusting horizontal
 * scroll on .table-scroll-wrapper.
 *
 * For all other positions, falls through to ProseMirror's default behavior.
 */
export const tableScrollControlExtension = Extension.create({
  name: "tableScrollControl",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tableScrollControlKey,
        props: {
          handleScrollToSelection(view) {
            if (!isSelectionInTable(view)) {
              return false; // Not in table — use ProseMirror default
            }
            return scrollEditorToSelection(view);
          },
        },
      }),
    ];
  },
});
