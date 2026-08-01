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
import { Plugin, PluginKey, type EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { goToNextCell, addRowAfter } from "@tiptap/pm/tables";
import { liftListItem, sinkListItem } from "@tiptap/pm/schema-list";
import { isInTable, getTableInfo } from "@/plugins/tableUI/tableActions.tiptap";
import { canTabEscape, type TabEscapeResult } from "./tabEscape";
import { canShiftTabEscape, type ShiftTabEscapeResult } from "./shiftTabEscape";
import { MultiSelection } from "@/plugins/multiCursor/MultiSelection";

const tabIndentPluginKey = new PluginKey("tabIndent");

/** Escapable mark type names — only these are cleared from stored marks */
const ESCAPABLE_MARK_NAMES = new Set(["bold", "italic", "code", "strike", "link"]);

/**
 * Apply an escape result: set selection and clear stored marks.
 * Shared by both Tab (forward) and Shift+Tab (backward) escape paths.
 */
function applyEscapeResult(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  escapeResult: TabEscapeResult | ShiftTabEscapeResult | MultiSelection,
): void {
  if (escapeResult instanceof MultiSelection) {
    const tr = state.tr.setSelection(escapeResult);
    // Clear all escapable mark types present in the schema.
    // Different cursors may be in different marks, so we can't rely
    // on the primary cursor's marks alone (#10).
    for (const name of ESCAPABLE_MARK_NAMES) {
      const markType = state.schema.marks[name];
      if (markType) {
        tr.removeStoredMark(markType);
      }
    }
    dispatch(tr);
    return;
  }

  const tr = state.tr.setSelection(
    TextSelection.create(state.doc, escapeResult.targetPos)
  );

  if (escapeResult.type === "link") {
    const linkMarkType = state.schema.marks.link;
    if (linkMarkType) {
      tr.removeStoredMark(linkMarkType);
    }
  }

  if (escapeResult.type === "mark") {
    // Clear escapable marks from cursor position's marks
    const { $from } = state.selection;
    for (const mark of $from.marks()) {
      /* v8 ignore next 2 -- @preserve reason: mark escape clears all stored marks; testing individual mark.type.name filtering requires real PM editor with stored marks, untestable in jsdom */
      if (ESCAPABLE_MARK_NAMES.has(mark.type.name)) {
        tr.removeStoredMark(mark.type);
      }
    }
    // Also clear from state.storedMarks — handles the left-boundary case where
    // $from.marks() is empty but inlineCodeBoundary set storedMarks to [codeMark].
    /* v8 ignore next 5 -- @preserve reason: state.storedMarks path requires real PM editor with storedMarks state, untestable in jsdom */
    for (const mark of (state.storedMarks ?? [])) {
      if (ESCAPABLE_MARK_NAMES.has(mark.type.name)) {
        tr.removeStoredMark(mark.type);
      }
    }
  }

  dispatch(tr);
}

/** Options for the tab-indent extension. */
export interface TabIndentOptions {
  /**
   * Spaces per indent level, asked fresh each time.
   *
   * INJECTED. A plugin that reaches the app's Zustand singletons cannot ship
   * as a standalone extension (ADR-015), so the host — which owns the settings
   * — answers. A getter, not a number: the setting is re-read per keypress so
   * a change takes effect without rebuilding the editor.
   */
  getTabSize: () => number;
}

/** CommonMark's own indent unit, and a sane default with no settings layer. */
const DEFAULT_TAB_SIZE = 4;

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

/**
 * Handle Tab/Shift+Tab in table context.
 * Returns true if handled (always — Tab is consumed in tables).
 */
function handleTableTab(view: import("@tiptap/pm/view").EditorView, shiftKey: boolean): boolean {
  const direction = shiftKey ? -1 : 1;
  const moved = goToNextCell(direction)(view.state, view.dispatch, view);

  // If Tab (not Shift+Tab) couldn't move, we're at last cell — add new row
  if (!moved && direction === 1) {
    const info = getTableInfo(view);
    if (info && info.rowIndex === info.numRows - 1 && info.colIndex === info.numCols - 1) {
      addRowAfter(view.state, view.dispatch);
      goToNextCell(1)(view.state, view.dispatch, view);
    }
  }
  return true;
}

/**
 * Handle Tab/Shift+Tab in list item context.
 * Returns true if handled (always — Tab is consumed in lists).
 */
function handleListTab(state: EditorState, dispatch: (tr: Transaction) => void, shiftKey: boolean): boolean {
  const listItemType = state.schema.nodes.listItem;
  /* v8 ignore next -- @preserve reason: schema always defines listItem in test environment */
  if (listItemType) {
    if (shiftKey) {
      liftListItem(listItemType)(state, dispatch);
    } else {
      sinkListItem(listItemType)(state, dispatch);
    }
  }
  return true;
}

/**
 * Handle Shift+Tab outdent: remove up to tabSize leading spaces.
 */
function handleShiftTabOutdent(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  getTabSize: () => number,
): boolean {
  const { from } = state.selection;
  const $from = state.doc.resolve(from);
  const lineStart = $from.start();
  const textBefore = state.doc.textBetween(lineStart, from, "\n");

  /* v8 ignore start -- leading-space regex always matches (never null); optional chain is defensive */
  const leadingSpaces = textBefore.match(/^[ ]*/)?.[0].length ?? 0;
  /* v8 ignore stop */
  if (leadingSpaces === 0) return true;

  const spacesToRemove = Math.min(leadingSpaces, getTabSize());
  dispatch(state.tr.delete(lineStart, lineStart + spacesToRemove));
  return true;
}

/**
 * Handle Tab: insert spaces (or replace selection with spaces).
 */
function handleTabInsertSpaces(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  getTabSize: () => number,
): boolean {
  const spaces = " ".repeat(getTabSize());

  if (!state.selection.empty) {
    dispatch(state.tr.replaceSelectionWith(state.schema.text(spaces), true));
  } else {
    dispatch(state.tr.insertText(spaces));
  }
  return true;
}

/** Tiptap extension for Tab/Shift+Tab indent, list navigation, and mark escape. */
export const tabIndentExtension = Extension.create<TabIndentOptions>({
  name: "tabIndent",
  addOptions() {
    return { getTabSize: () => DEFAULT_TAB_SIZE };
  },
  // Low priority — runs AFTER autoPairExtension's Tab/Shift+Tab handlers.
  // Priority chain for Tab key:
  //   1. autoPair (default priority ~100): bracket jump over closing chars
  //   2. tabIndent (priority 50): mark/link escape → table nav → list indent → spaces
  // This means bracket jump takes priority over mark escape (innermost-first).
  // User can Tab again to escape the mark after jumping the bracket.
  priority: 50,

  addProseMirrorPlugins() {
    const { getTabSize } = this.options;
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

              // 1. Tab/Shift+Tab escape from marks/links
              if (!event.shiftKey) {
                const escapeResult = canTabEscape(state);
                if (escapeResult) {
                  event.preventDefault();
                  applyEscapeResult(state, dispatch, escapeResult);
                  return true;
                }
              }
              if (event.shiftKey) {
                const escapeResult = canShiftTabEscape(state);
                if (escapeResult) {
                  event.preventDefault();
                  applyEscapeResult(state, dispatch, escapeResult);
                  return true;
                }
              }

              // 2. Table navigation
              if (isInTable(view)) {
                event.preventDefault();
                return handleTableTab(view, event.shiftKey);
              }

              // 3. List indent/outdent
              if (isInListItem(state)) {
                event.preventDefault();
                return handleListTab(state, dispatch, event.shiftKey);
              }

              // 4. Shift+Tab outdent (remove leading spaces)
              if (event.shiftKey) {
                event.preventDefault();
                return handleShiftTabOutdent(state, dispatch, getTabSize);
              }

              // 5. Tab: insert spaces
              event.preventDefault();
              return handleTabInsertSpaces(state, dispatch, getTabSize);
            },
          },
        },
      }),
    ];
  },
});
