/**
 * Smart Select-All Extension for WYSIWYG Mode
 *
 * Progressive block expansion: each Cmd+A press selects the next-larger
 * container (cell -> row -> table -> document). Selection changes are
 * undoable via Cmd+Z.
 *
 * Uses ProseMirror plugin state (not module-level) so each editor
 * instance has its own stack.
 */

import { Extension } from "@tiptap/core";
import { AllSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { getNextContainerBounds } from "./blockBounds";

interface SelectionPos {
  from: number;
  to: number;
}

interface SmartSelectState {
  /** Previous selections we can undo back to */
  stack: SelectionPos[];
  /** The last expansion result, used to verify Cmd+Z matches */
  lastExpanded: SelectionPos | null;
}

const smartSelectPluginKey = new PluginKey<SmartSelectState>("smartSelectAll");

function createSmartSelectPlugin(): Plugin<SmartSelectState> {
  return new Plugin<SmartSelectState>({
    key: smartSelectPluginKey,
    state: {
      init(): SmartSelectState {
        return { stack: [], lastExpanded: null };
      },
      apply(tr: Transaction, value: SmartSelectState): SmartSelectState {
        // Clear stack on any document change
        if (tr.docChanged) {
          return { stack: [], lastExpanded: null };
        }
        // Otherwise preserve (mutations happen via setMeta)
        const meta = tr.getMeta(smartSelectPluginKey) as SmartSelectState | undefined;
        if (meta) return meta;
        return value;
      },
    },
  });
}

/**
 * Attempt progressive expansion. Returns true if handled.
 */
function handleSmartSelectAll(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { from, to } = state.selection;
  const docSize = state.doc.content.size;

  // Already selecting entire document — nothing more to expand
  if (from === 0 && to === docSize) {
    return false;
  }

  const nextBounds = getNextContainerBounds(state, from, to);

  if (!nextBounds) {
    // No container found. If we're in a container-less context (plain paragraph),
    // return false to let default select-all handle it.
    // But if we got here via progressive expansion (stack non-empty),
    // select the entire document ourselves so it's tracked.
    const pluginState = smartSelectPluginKey.getState(state);
    if (!pluginState || pluginState.stack.length === 0) {
      return false;
    }

    // Select entire document — AllSelection highlights the doc uniformly;
    // TextSelection(0, docSize) silently snaps endpoints to inline positions
    // and can leave visual gaps at block boundaries (Issue #816).
    /* v8 ignore next -- @preserve dispatch is always provided by ProseMirror keyboard handlers; the no-dispatch path is a dry-run check that Tiptap never uses for this command */
    if (dispatch) {
      const tr = state.tr.setSelection(new AllSelection(state.doc));
      tr.setMeta("addToHistory", false);
      tr.setMeta(smartSelectPluginKey, {
        stack: [...pluginState.stack, { from, to }],
        lastExpanded: { from: 0, to: docSize },
      });
      dispatch(tr);
    }
    return true;
  }

  /* v8 ignore next -- @preserve dispatch is always provided by ProseMirror keyboard handlers; the no-dispatch path is a dry-run check that Tiptap never uses for this command */
  if (dispatch) {
    const pluginState = smartSelectPluginKey.getState(state) ?? { stack: [], lastExpanded: null };
    const tr = state.tr.setSelection(
      TextSelection.create(state.doc, nextBounds.from, nextBounds.to),
    );
    tr.setMeta("addToHistory", false);
    tr.setMeta(smartSelectPluginKey, {
      stack: [...pluginState.stack, { from, to }],
      lastExpanded: { from: nextBounds.from, to: nextBounds.to },
    });
    dispatch(tr);
  }
  return true;
}

/**
 * Attempt selection undo. Returns true if handled (restored previous selection).
 */
function handleSelectionUndo(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const pluginState = smartSelectPluginKey.getState(state);
  if (!pluginState || pluginState.stack.length === 0) {
    return false;
  }

  // Verify current selection matches the last expansion
  const { from, to } = state.selection;
  const last = pluginState.lastExpanded;
  if (!last || from !== last.from || to !== last.to) {
    // Selection was changed externally — clear stack, fall through to normal undo
    /* v8 ignore next -- @preserve dispatch is always provided by ProseMirror keyboard handlers */
    if (dispatch) {
      const tr = state.tr;
      tr.setMeta(smartSelectPluginKey, { stack: [], lastExpanded: null });
      tr.setMeta("addToHistory", false);
      dispatch(tr);
    }
    return false;
  }

  // Pop the stack and restore previous selection
  /* v8 ignore next -- @preserve dispatch is always provided by ProseMirror keyboard handlers */
  if (dispatch) {
    const newStack = pluginState.stack.slice(0, -1);
    const prev = pluginState.stack[pluginState.stack.length - 1];
    const tr = state.tr.setSelection(TextSelection.create(state.doc, prev.from, prev.to));
    tr.setMeta("addToHistory", false);
    tr.setMeta(smartSelectPluginKey, {
      stack: newStack,
      lastExpanded: newStack.length > 0 ? prev : null,
    });
    dispatch(tr);
  }
  return true;
}

/** Tiptap extension that makes Cmd+A select the current block first, then the full document. */
export const smartSelectAllExtension = Extension.create({
  name: "smartSelectAll",
  priority: 200,

  addKeyboardShortcuts() {
    return {
      "Mod-a": ({ editor }) => {
        return handleSmartSelectAll(editor.state, editor.view.dispatch);
      },
      "Mod-z": ({ editor }) => {
        return handleSelectionUndo(editor.state, editor.view.dispatch);
      },
    };
  },

  addProseMirrorPlugins() {
    return [createSmartSelectPlugin()];
  },
});
