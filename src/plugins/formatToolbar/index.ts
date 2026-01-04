/**
 * Format Toolbar Plugin
 *
 * Provides Cmd+E toggle for a context-aware floating toolbar in Milkdown.
 * Similar to source mode's format popup.
 *
 * Context detection (order matches Source mode):
 * - Code block → shows code toolbar (language picker)
 * - Table → triggers table toolbar
 * - Heading → shows heading toolbar (heading levels)
 * - Regular text → shows format toolbar
 */

import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { keymap } from "@milkdown/kit/prose/keymap";
import type { EditorView } from "@milkdown/kit/prose/view";
import { useFormatToolbarStore, type HeadingInfo, type ContextMode, type CodeBlockInfo } from "@/stores/formatToolbarStore";
import { useTableToolbarStore } from "@/stores/tableToolbarStore";
import { isInTable, getTableInfo, getTableRect } from "@/plugins/tableUI/table-utils";
import { findWordAtCursor } from "@/plugins/syntaxReveal/marks";
import { FormatToolbarView } from "./FormatToolbarView";

export const formatToolbarPluginKey = new PluginKey("formatToolbar");

/**
 * Get code block info if cursor is inside a code block node.
 * Returns null if not in a code block.
 */
function getCodeBlockInfo(view: EditorView): CodeBlockInfo | null {
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "code_block" || node.type.name === "fence") {
      return {
        language: node.attrs.language || "",
        nodePos: $from.before(d),
      };
    }
  }
  return null;
}

/**
 * Get heading info if cursor is inside a heading node.
 * Returns null if not in a heading.
 */
function getHeadingInfo(view: EditorView): HeadingInfo | null {
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "heading") {
      return {
        level: node.attrs.level || 1,
        nodePos: $from.before(d),
      };
    }
  }
  return null;
}

/**
 * Get cursor rect for positioning toolbar.
 */
function getCursorRect(view: EditorView) {
  const { from, to } = view.state.selection;
  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to);

  return {
    top: Math.min(start.top, end.top),
    bottom: Math.max(start.bottom, end.bottom),
    left: Math.min(start.left, end.left),
    right: Math.max(start.right, end.right),
    width: Math.abs(end.left - start.left),
    height: Math.abs(end.bottom - start.top),
  };
}

/**
 * Determine context mode based on cursor position.
 * - "format": text selected OR cursor in word
 * - "inline-insert": cursor not in word, not at blank line
 * - "block-insert": cursor at beginning of blank line
 */
function getContextMode(view: EditorView): ContextMode {
  const { empty } = view.state.selection;

  // Has selection → format
  if (!empty) return "format";

  // Check if cursor in word
  const $from = view.state.selection.$from;
  const wordRange = findWordAtCursor($from);
  if (wordRange) return "format";

  // Check if at blank line start
  const parent = $from.parent;
  const atStart = $from.parentOffset === 0;
  const isEmpty = parent.textContent.trim() === "";

  if (atStart && isEmpty) return "block-insert";

  return "inline-insert";
}

/**
 * Context-aware toolbar toggle.
 * Routes to appropriate toolbar based on cursor location (order matches Source mode):
 * - Code block → code toolbar (language picker)
 * - Table → table toolbar
 * - Heading → heading toolbar (heading levels)
 * - Regular text → format toolbar
 */
function toggleContextAwareToolbar(view: EditorView): boolean {
  const formatStore = useFormatToolbarStore.getState();
  const tableStore = useTableToolbarStore.getState();

  // If any toolbar is open, close it
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

  // 1. Check if in code block → show code toolbar (language picker)
  const codeBlockInfo = getCodeBlockInfo(view);
  if (codeBlockInfo) {
    const anchorRect = getCursorRect(view);
    formatStore.openCodeToolbar(anchorRect, view, codeBlockInfo);
    return true;
  }

  // 2. Check if in table → show table toolbar
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

  // 3. Check if in heading → show heading toolbar
  const headingInfo = getHeadingInfo(view);
  if (headingInfo) {
    const anchorRect = getCursorRect(view);
    formatStore.openHeadingToolbar(anchorRect, view, headingInfo);
    return true;
  }

  // 4. Regular text → show format toolbar with context-aware buttons
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

export { FormatToolbarView };
