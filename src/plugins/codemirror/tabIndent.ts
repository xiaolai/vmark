/**
 * Tab Indent Plugin for CodeMirror
 *
 * Purpose: Fallback Tab handler that inserts spaces when no higher-priority
 * keymap handles Tab (tab escape, list indent, etc.), preventing Tab from
 * moving focus outside the editor.
 *
 * Key decisions:
 *   - Uses tabSize from settings for consistent indentation
 *   - Shift+Tab removes up to tabSize spaces from the line start
 *   - Lower priority than tabEscape and listSmartIndent in the keymap chain
 *   - Handles all selection ranges for multi-cursor support; Shift+Tab dedupes
 *     by line so multiple cursors on one line produce a single outdent change
 *     (no overlapping changes)
 *
 * @coordinates-with tabEscape.ts — higher-priority Tab handler for bracket/link escape
 * @coordinates-with listSmartIndent.ts — higher-priority Tab handler for list items
 * @module plugins/codemirror/tabIndent
 */

import { type ChangeSpec, EditorSelection } from "@codemirror/state";
import { KeyBinding } from "@codemirror/view";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Get the configured tab size (number of spaces).
 */
function getTabSize(): number {
  return useSettingsStore.getState().general.tabSize;
}

/**
 * Tab key handler: insert spaces when Tab is not handled by other keymaps.
 * This is a fallback to prevent focus from leaving the editor.
 * Handles all cursors for multi-cursor support.
 */
export const tabIndentFallbackKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Tab",
  run: (view) => {
    const { state } = view;
    const spaces = " ".repeat(getTabSize());

    const changes: ChangeSpec[] = state.selection.ranges.map((range) => ({
      from: range.from,
      to: range.to,
      insert: spaces,
    }));

    // Build new selection: each cursor moves to end of inserted spaces,
    // adjusting for prior insertions shifting positions
    let offset = 0;
    const anchors: number[] = state.selection.ranges.map((range) => {
      const newAnchor = range.from + offset + spaces.length;
      // Each replacement changes length by (spaces.length - (to - from))
      offset += spaces.length - (range.to - range.from);
      return newAnchor;
    });

    view.dispatch({
      changes,
      selection: EditorSelection.create(anchors.map((a) => EditorSelection.cursor(a))),
      scrollIntoView: true,
    });
    return true;
  },
});

/**
 * Shift+Tab key handler: outdent (remove up to tabSize spaces before cursor).
 * This is a fallback to prevent focus from leaving the editor.
 * Handles all cursors for multi-cursor support.
 */
export const shiftTabIndentFallbackKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Shift-Tab",
  run: (view) => {
    const { state } = view;
    const tabSize = getTabSize();

    // Dedupe by line: multiple cursors on the same line must yield ONE outdent
    // change, not one per cursor. Two changes anchored at the same line.from
    // overlap; rather than rely on CodeMirror silently merging them, collapse
    // them here and remove the widest amount any cursor on the line warrants
    // (matching the union of the per-cursor removals).
    const removalByLine = new Map<number, number>();
    for (const range of state.selection.ranges) {
      const line = state.doc.lineAt(range.from);
      const textBefore = state.doc.sliceString(line.from, range.from);
      /* v8 ignore next -- @preserve null-coalesce: regex always matches (zero or more spaces), nullish branch unreachable */
      const leadingSpaces = textBefore.match(/^[ ]*/)?.[0].length ?? 0;
      if (leadingSpaces === 0) continue;

      const spacesToRemove = Math.min(leadingSpaces, tabSize);
      const prev = removalByLine.get(line.from) ?? 0;
      if (spacesToRemove > prev) removalByLine.set(line.from, spacesToRemove);
    }

    const changes: ChangeSpec[] = [...removalByLine].map(([from, count]) => ({
      from,
      to: from + count,
      insert: "",
    }));

    if (changes.length > 0) {
      view.dispatch({ changes, scrollIntoView: true });
    }
    return true; // Always handle the key to prevent focus leaving
  },
});
