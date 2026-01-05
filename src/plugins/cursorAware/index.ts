/**
 * Cursor-Aware Rendering Plugin
 *
 * -style cursor-aware rendering for ALL inline formats:
 * - When cursor is INSIDE formatted content → show raw markdown with syntax fences
 * - When cursor is OUTSIDE → show rendered content
 *
 * Uses widget decorations (like syntaxReveal) to avoid infinite loop issues
 * that occur with inline decorations in React/Milkdown.
 */

import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { useSettingsStore } from "@/stores/settingsStore";
import { addMarkWidgetDecorations } from "./markDecorations";
import { addNodeDecorations } from "./nodeDecorations";

export const cursorAwarePluginKey = new PluginKey<DecorationSet>("cursorAware");

/**
 * Compute decorations for the current state.
 */
function computeDecorations(state: EditorState): DecorationSet {
  const { revealInlineSyntax } = useSettingsStore.getState().markdown;
  if (!revealInlineSyntax) {
    return DecorationSet.empty;
  }

  const { selection, doc } = state;
  const { from, to, empty } = selection;

  // Only show syntax for cursor position (collapsed selection)
  if (!empty) {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = [];
  const $from = doc.resolve(from);

  // 1. Add mark widget decorations (bold, italic, code, strikethrough, link, etc.)
  addMarkWidgetDecorations(decorations, from, $from);

  // 2. Add node decorations (math_inline, image, footnote_reference)
  addNodeDecorations(decorations, from, to, doc);

  if (decorations.length === 0) {
    return DecorationSet.empty;
  }

  return DecorationSet.create(doc, decorations);
}

/**
 * Unified cursor-aware plugin for all inline formats.
 * Uses plugin state to cache decorations and avoid re-computation loops.
 */
export const cursorAwarePlugin = $prose(() => {
  return new Plugin({
    key: cursorAwarePluginKey,

    state: {
      init(_, state) {
        return computeDecorations(state);
      },
      apply(tr, oldDecorations, _oldState, newState) {
        // Only recompute if selection changed or document changed
        if (tr.selectionSet || tr.docChanged) {
          return computeDecorations(newState);
        }
        // Map existing decorations through the transaction
        return oldDecorations.map(tr.mapping, tr.doc);
      },
    },

    props: {
      decorations(state) {
        return cursorAwarePluginKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
});

export default cursorAwarePlugin;
