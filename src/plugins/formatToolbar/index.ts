/**
 * Format Toolbar Plugin
 *
 * Provides Cmd+E toggle for a context-aware floating toolbar in Milkdown.
 * Similar to source mode's format popup.
 *
 * Context detection priority (matches Source mode):
 * 1. Toggle if already open
 * 2. Code block → CODE toolbar
 * 3. Table → TABLE toolbar (merged)
 * 4. List → LIST toolbar (merged)
 * 5. Blockquote → BLOCKQUOTE toolbar (merged)
 * 6. Has selection → FORMAT toolbar
 * 7-10. Inline elements (link, image, math, footnote)
 * 11-12. Heading or paragraph line start → HEADING toolbar
 * 13-14. Word → FORMAT toolbar (auto-select)
 * 15-16. Blank line or otherwise → INSERT toolbar
 */

import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { keymap } from "@milkdown/kit/prose/keymap";
import type { EditorView } from "@milkdown/kit/prose/view";
import { useFormatToolbarStore } from "@/stores/formatToolbarStore";
import { useTableToolbarStore } from "@/stores/tableToolbarStore";
import { useMilkdownCursorContextStore } from "@/stores/milkdownCursorContextStore";
import { isInTable, getTableInfo, getTableRect } from "@/plugins/tableUI/table-utils";
import { findWordAtCursor } from "@/plugins/syntaxReveal/marks";
import { FormatToolbarView } from "./FormatToolbarView";
import { computeMilkdownCursorContext } from "./cursorContext";
import {
  getCodeBlockInfo,
  getHeadingInfo,
  isInList,
  isInBlockquote,
  isAtParagraphLineStart,
  getCursorRect,
  getContextMode,
} from "./nodeDetection";

export const formatToolbarPluginKey = new PluginKey("formatToolbar");

/**
 * Context-aware toolbar toggle.
 * Routes to appropriate toolbar based on cursor location.
 * Priority order matches Source mode.
 */
function toggleContextAwareToolbar(view: EditorView): boolean {
  const formatStore = useFormatToolbarStore.getState();
  const tableStore = useTableToolbarStore.getState();
  const { empty } = view.state.selection;

  // 1. Toggle: if any toolbar is open, close it
  if (formatStore.isOpen) {
    formatStore.closeToolbar();
    view.focus();
    return true;
  }
  if (tableStore.isOpen) {
    tableStore.closeToolbar();
    view.focus();
    return true;
  }

  // 2. Code block → CODE toolbar (language picker)
  const codeBlockInfo = getCodeBlockInfo(view);
  if (codeBlockInfo) {
    const anchorRect = getCursorRect(view);
    formatStore.openCodeToolbar(anchorRect, view, codeBlockInfo);
    return true;
  }

  // 3. Table → TABLE toolbar (merged in Phase 2)
  // TODO: Phase 2 will merge table toolbar into format toolbar
  if (isInTable(view)) {
    const info = getTableInfo(view);
    if (info) {
      const rect = getTableRect(view, info.tablePos);
      if (rect) {
        tableStore.openToolbar({
          tablePos: info.tablePos,
          anchorRect: rect,
        });
        return true;
      }
    }
  }

  // 4. List → LIST toolbar (merged in Phase 2)
  // TODO: Phase 2 will add list-specific toolbar with format + list actions
  if (isInList(view)) {
    const anchorRect = getCursorRect(view);
    const contextMode = getContextMode(view);
    formatStore.openToolbar(anchorRect, view, contextMode);
    return true;
  }

  // 5. Blockquote → BLOCKQUOTE toolbar (merged in Phase 2)
  // TODO: Phase 2 will add blockquote-specific toolbar with format + quote actions
  if (isInBlockquote(view)) {
    const anchorRect = getCursorRect(view);
    const contextMode = getContextMode(view);
    formatStore.openToolbar(anchorRect, view, contextMode);
    return true;
  }

  // 6. Has selection → FORMAT toolbar
  if (!empty) {
    const anchorRect = getCursorRect(view);
    formatStore.openToolbar(anchorRect, view, "format");
    return true;
  }

  // 7-10. Inline elements (link, image, math, footnote)
  // TODO: Phase 4 will add inline element auto-selection

  // 11. Heading → HEADING toolbar
  const headingInfo = getHeadingInfo(view);
  if (headingInfo) {
    const anchorRect = getCursorRect(view);
    formatStore.openHeadingToolbar(anchorRect, view, headingInfo);
    return true;
  }

  // 12. Cursor at paragraph line start → HEADING toolbar
  if (isAtParagraphLineStart(view)) {
    const anchorRect = getCursorRect(view);
    formatStore.openHeadingToolbar(anchorRect, view, {
      level: 0, // paragraph
      nodePos: view.state.selection.$from.before(view.state.selection.$from.depth),
    });
    return true;
  }

  // 13-14. Cursor in word → FORMAT toolbar (auto-select word)
  const $from = view.state.selection.$from;
  const wordRange = findWordAtCursor($from);
  if (wordRange) {
    // Auto-select the word
    const tr = view.state.tr.setSelection(
      TextSelection.create(view.state.doc, wordRange.from, wordRange.to)
    );
    view.dispatch(tr);

    const anchorRect = getCursorRect(view);
    formatStore.openToolbar(anchorRect, view, "format");
    return true;
  }

  // 15-16. Blank line or otherwise → INSERT toolbar
  const anchorRect = getCursorRect(view);
  const contextMode = getContextMode(view);
  formatStore.openToolbar(anchorRect, view, contextMode);
  return true;
}

/**
 * Keymap plugin for Cmd+E context-aware toolbar toggle.
 */
export const formatToolbarKeymapPlugin = $prose(() =>
  keymap({
    "Mod-e": (_state, _dispatch, view) => {
      if (!view) return false;
      return toggleContextAwareToolbar(view);
    },
  })
);

/**
 * View plugin that creates and manages the toolbar DOM.
 */
export const formatToolbarViewPlugin = $prose(() =>
  new Plugin({
    key: formatToolbarPluginKey,
    view: (editorView) => {
      const toolbarView = new FormatToolbarView(editorView);
      return {
        destroy: () => toolbarView.destroy(),
      };
    },
  })
);

/**
 * Plugin that updates cursor context on every selection/doc change.
 */
export const cursorContextPluginKey = new PluginKey("cursorContext");

export const cursorContextPlugin = $prose(() =>
  new Plugin({
    key: cursorContextPluginKey,
    view: (editorView) => {
      // Initial context update
      const context = computeMilkdownCursorContext(editorView);
      useMilkdownCursorContextStore.getState().setContext(context, editorView);

      return {
        update: (view, prevState) => {
          // Update context on selection or doc change
          if (
            !view.state.selection.eq(prevState.selection) ||
            !view.state.doc.eq(prevState.doc)
          ) {
            const ctx = computeMilkdownCursorContext(view);
            useMilkdownCursorContextStore.getState().setContext(ctx, view);
          }
        },
        destroy: () => {
          useMilkdownCursorContextStore.getState().clearContext();
        },
      };
    },
  })
);

export { FormatToolbarView };
