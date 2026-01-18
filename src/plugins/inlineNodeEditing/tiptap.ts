/**
 * Inline Node Editing Plugin
 *
 * Adds `.editing` class to inline nodes (math, images, footnotes) when
 * the cursor is inside them. This provides visual feedback for nodes
 * that can't show a text cursor.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const EDITABLE_NODE_TYPES = ["math_inline", "image", "footnote_reference"];

export const inlineNodeEditingKey = new PluginKey<InlineNodeEditingState>("inlineNodeEditing");

export interface InlineNodeEditingState {
  decorations: DecorationSet;
  // Entry direction: "left" if nodeAfter triggered, "right" if nodeBefore triggered
  entryDirection: "left" | "right" | null;
  // Position of the node being edited
  editingNodePos: number | null;
}

function computeState(state: EditorState, prevState: InlineNodeEditingState | null): InlineNodeEditingState {
  const { selection, doc } = state;
  const { from } = selection;
  const decorations: Decoration[] = [];
  let entryDirection: "left" | "right" | null = null;
  let editingNodePos: number | null = null;

  // Find the node at cursor position
  const $pos = doc.resolve(from);

  // Check parent nodes for editable types
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (EDITABLE_NODE_TYPES.includes(node.type.name)) {
      const start = $pos.before(depth);
      const end = $pos.after(depth);
      decorations.push(
        Decoration.node(start, end, { class: "editing" })
      );
      editingNodePos = start;
      entryDirection = "left"; // Inside node, default to left
      break;
    }
  }

  // Check if cursor is directly before an inline node (entered from left)
  const nodeAfter = $pos.nodeAfter;
  if (nodeAfter && EDITABLE_NODE_TYPES.includes(nodeAfter.type.name)) {
    decorations.push(
      Decoration.node(from, from + nodeAfter.nodeSize, { class: "editing" })
    );
    editingNodePos = from;
    entryDirection = "left";
  }

  // Check if cursor is directly after an inline node (entered from right)
  const nodeBefore = $pos.nodeBefore;
  if (nodeBefore && EDITABLE_NODE_TYPES.includes(nodeBefore.type.name)) {
    const nodeStart = from - nodeBefore.nodeSize;
    // Only add if not already added by nodeAfter check
    if (editingNodePos !== nodeStart) {
      decorations.push(
        Decoration.node(nodeStart, from, { class: "editing" })
      );
    }
    editingNodePos = nodeStart;
    entryDirection = "right";
  }

  // If we're editing the same node as before, preserve the entry direction
  if (prevState && prevState.editingNodePos === editingNodePos && prevState.entryDirection) {
    entryDirection = prevState.entryDirection;
  }

  return {
    decorations: DecorationSet.create(doc, decorations),
    entryDirection,
    editingNodePos,
  };
}

export const inlineNodeEditingExtension = Extension.create({
  name: "inlineNodeEditing",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: inlineNodeEditingKey,
        state: {
          init(_, state): InlineNodeEditingState {
            return computeState(state, null);
          },
          apply(tr, oldState, _oldState, newState): InlineNodeEditingState {
            if (tr.docChanged || tr.selectionSet) {
              return computeState(newState, oldState);
            }
            // Map decorations if doc changed but selection didn't
            return {
              ...oldState,
              decorations: oldState.decorations.map(tr.mapping, tr.doc),
            };
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
