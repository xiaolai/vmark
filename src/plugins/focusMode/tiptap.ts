/**
 * Focus Mode Tiptap Extension (WYSIWYG)
 *
 * Purpose: Dims all blocks except the one containing the cursor, helping the user
 * concentrate on the paragraph they're currently editing.
 *
 * Key decisions:
 *   - Uses a node decoration (`md-focus` class) on the active top-level block
 *   - CSS then dims all OTHER blocks via `:not(.md-focus)` styling
 *   - Subscribes to editorStore to toggle decorations when focusMode setting changes
 *   - IME-guarded dispatch to avoid interfering with CJK composition
 *
 * @coordinates-with codemirror/focusModePlugin.ts — Source mode counterpart
 * @coordinates-with stores/editorStore.ts — reads focusModeEnabled state
 * @module plugins/focusMode/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useEditorStore } from "@/stores/editorStore";
import { runOrQueueProseMirrorAction } from "@/utils/imeGuard";

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
              runOrQueueProseMirrorAction(view, () => view.dispatch(view.state.tr));
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
