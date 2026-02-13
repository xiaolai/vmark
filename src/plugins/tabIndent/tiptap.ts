/**
 * Tab Indent Extension for Tiptap
 *
 * Fallback Tab handler that keeps Tab inside the editor.
 * Handles:
 * 1. Escape from marks (bold, italic, code, strike) and links
 * 2. Table navigation
 * 3. List indent/outdent
 * 4. Space insertion (fallback)
 *
 * When cursor is in an inline mark or link:
 * - Tab: jumps to position after the mark/link
 *
 * When cursor is in a table:
 * - Tab: moves to next cell, or adds a row at the last cell
 * - Shift+Tab: moves to previous cell
 *
 * When cursor is in a list item:
 * - Tab: indent (sink) the list item
 * - Shift+Tab: outdent (lift) the list item
 *
 * Note: We use ProseMirror's direct liftListItem/sinkListItem functions
 * because our custom listItem node doesn't register Tiptap commands.
 *
 * This prevents Tab from moving focus outside the editor.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, TextSelection } from "@tiptap/pm/state";
import { goToNextCell, addRowAfter } from "@tiptap/pm/tables";
import { liftListItem, sinkListItem } from "@tiptap/pm/schema-list";
import { useSettingsStore } from "@/stores/settingsStore";
import { isInTable, getTableInfo } from "@/plugins/tableUI/tableActions.tiptap";
import { canTabEscape } from "./tabEscape";
import { MultiSelection } from "@/plugins/multiCursor/MultiSelection";

const tabIndentPluginKey = new PluginKey("tabIndent");

/**
 * Get the configured tab size (number of spaces).
 */
function getTabSize(): number {
  return useSettingsStore.getState().general.tabSize;
}

/**
 * Check if the cursor is inside a list item.
 */
function isInListItem(state: EditorState): boolean {
  const listItemType = state.schema.nodes.listItem;
  if (!listItemType) return false;

  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === listItemType) return true;
  }
  return false;
}

export const tabIndentExtension = Extension.create({
  name: "tabIndent",
  // Low priority - runs after all other Tab handlers
  priority: 50,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tabIndentPluginKey,
        props: {
          handleDOMEvents: {
            keydown: (view, event) => {
              // Skip if not Tab or has modifiers (except Shift)
              if (event.key !== "Tab") return false;
              if (event.ctrlKey || event.altKey || event.metaKey) return false;

              // Skip IME composition
              if (event.isComposing || event.keyCode === 229) return false;

              const { state, dispatch } = view;

              // Tab escape from marks/links (only for forward Tab, not Shift+Tab)
              if (!event.shiftKey) {
                const escapeResult = canTabEscape(state);
                if (escapeResult) {
                  event.preventDefault();

                  // Handle multi-cursor
                  if (escapeResult instanceof MultiSelection) {
                    const tr = state.tr.setSelection(escapeResult);
                    // Clear link from stored marks for all cursors
                    const linkMarkType = state.schema.marks.link;
                    if (linkMarkType) {
                      tr.removeStoredMark(linkMarkType);
                    }
                    dispatch(tr);
                    return true;
                  }

                  // Handle single cursor
                  const tr = state.tr.setSelection(
                    TextSelection.create(state.doc, escapeResult.targetPos)
                  );
                  // When escaping a link, clear the link from stored marks
                  // so subsequent typing produces normal (unlinked) text.
                  // This is essential when the link is at end of paragraph
                  // where there's no un-marked position to jump to.
                  if (escapeResult.type === "link") {
                    const linkMarkType = state.schema.marks.link;
                    if (linkMarkType) {
                      tr.removeStoredMark(linkMarkType);
                    }
                  }
                  // When escaping an inline mark, clear it from stored marks
                  // so subsequent typing produces unmarked text.
                  if (escapeResult.type === "mark") {
                    const { $from } = state.selection;
                    for (const mark of $from.marks()) {
                      tr.removeStoredMark(mark.type);
                    }
                  }
                  dispatch(tr);
                  return true;
                }
              }

              // In table: delegate to table cell navigation
              if (isInTable(view)) {
                event.preventDefault();
                const direction = event.shiftKey ? -1 : 1;
                const moved = goToNextCell(direction)(view.state, view.dispatch, view);

                // If Tab (not Shift+Tab) couldn't move, we're at last cell - add new row
                if (!moved && direction === 1) {
                  const info = getTableInfo(view);
                  if (info && info.rowIndex === info.numRows - 1 && info.colIndex === info.numCols - 1) {
                    // Add row below, then move to first cell of new row
                    addRowAfter(view.state, view.dispatch);
                    // After adding row, move to first cell
                    goToNextCell(1)(view.state, view.dispatch, view);
                  }
                }
                return true;
              }

              const { selection } = state;

              // In list item: indent/outdent
              if (isInListItem(state)) {
                event.preventDefault();
                const listItemType = state.schema.nodes.listItem;
                if (listItemType) {
                  if (event.shiftKey) {
                    liftListItem(listItemType)(state, dispatch);
                  } else {
                    sinkListItem(listItemType)(state, dispatch);
                  }
                }
                return true;
              }

              // Handle Shift+Tab: outdent (remove up to tabSize spaces before cursor)
              if (event.shiftKey) {
                event.preventDefault();
                const { from } = selection;
                const $from = state.doc.resolve(from);
                const lineStart = $from.start();
                const textBefore = state.doc.textBetween(lineStart, from, "\n");

                // Count leading spaces
                const leadingSpaces = textBefore.match(/^[ ]*/)?.[0].length ?? 0;
                if (leadingSpaces === 0) return true;

                // Remove up to tabSize spaces
                const spacesToRemove = Math.min(leadingSpaces, getTabSize());
                const tr = state.tr.delete(lineStart, lineStart + spacesToRemove);
                dispatch(tr);
                return true;
              }

              // Handle Tab: insert spaces
              event.preventDefault();
              const spaces = " ".repeat(getTabSize());

              // If there's a selection, replace it with spaces
              if (!selection.empty) {
                const tr = state.tr.replaceSelectionWith(
                  state.schema.text(spaces),
                  true
                );
                dispatch(tr);
                return true;
              }

              // Insert spaces at cursor
              const tr = state.tr.insertText(spaces);
              dispatch(tr);
              return true;
            },
          },
        },
      }),
    ];
  },
});
