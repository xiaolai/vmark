import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useEditorStore } from "@/stores/editorStore";

const focusPluginKey = new PluginKey("focusMode");

function createFocusDecoration(state: EditorState): DecorationSet | null {
  const focusEnabled = useEditorStore.getState().focusModeEnabled;
  if (!focusEnabled) return null;

  const { selection } = state;
  const { $from } = selection;

  if ($from.depth < 1) return null;

  try {
    const start = $from.before(1);
    const end = $from.after(1);

    const decoration = Decoration.node(start, end, {
      class: "md-focus",
    });

    return DecorationSet.create(state.doc, [decoration]);
  } catch {
    return null;
  }
}

export const focusModeExtension = Extension.create({
  name: "focusMode",
  addProseMirrorPlugins() {
    let lastFocusMode = useEditorStore.getState().focusModeEnabled;

    return [
      new Plugin({
        key: focusPluginKey,
        view: (view) => {
          const unsubscribe = useEditorStore.subscribe((state) => {
            if (state.focusModeEnabled !== lastFocusMode) {
              lastFocusMode = state.focusModeEnabled;
              view.dispatch(view.state.tr);
            }
          });

          return {
            destroy: () => {
              unsubscribe();
            },
          };
        },
        props: {
          decorations(state) {
            return createFocusDecoration(state);
          },
        },
      }),
    ];
  },
});

