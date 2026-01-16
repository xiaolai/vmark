import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import type { Decoration } from "@tiptap/pm/view";
import { addNodeDecorations } from "./nodeDecorations";
import { addMarkWidgetDecorations } from "./markDecorations";

const cursorAwarePluginKey = new PluginKey<DecorationSet>("cursorAware");

function computeDecorations(state: EditorState): DecorationSet {
  const { selection, doc } = state;
  const { from, to, empty, $from } = selection;

  if (!empty) {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = [];

  addNodeDecorations(
    decorations as unknown as Parameters<typeof addNodeDecorations>[0],
    from,
    to,
    doc as unknown as Parameters<typeof addNodeDecorations>[3]
  );
  addMarkWidgetDecorations(
    decorations as unknown as Parameters<typeof addMarkWidgetDecorations>[0],
    from,
    $from as unknown as Parameters<typeof addMarkWidgetDecorations>[2]
  );

  if (decorations.length === 0) {
    return DecorationSet.empty;
  }

  return DecorationSet.create(doc, decorations);
}

export const cursorAwareExtension = Extension.create({
  name: "cursorAware",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: cursorAwarePluginKey,
        state: {
          init(_, state) {
            return computeDecorations(state);
          },
          apply(tr, oldDecorations, _oldState, newState) {
            if (tr.selectionSet || tr.docChanged) {
              return computeDecorations(newState);
            }
            return oldDecorations.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return cursorAwarePluginKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
