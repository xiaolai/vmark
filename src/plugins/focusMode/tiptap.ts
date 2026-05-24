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
 *   - Uses plugin state pattern (init/apply) to avoid recreating decorations on
 *     every transaction — only rebuilds when selection changes or focus mode toggles
 *
 * @coordinates-with codemirror/focusModePlugin.ts — Source mode counterpart
 * @coordinates-with stores/editorStore.ts — reads focusModeEnabled state
 * @module plugins/focusMode/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useUIStore } from "@/stores/uiStore";
import { runOrQueueProseMirrorAction } from "@/utils/imeGuard";
import "./focus-mode.css";

const focusPluginKey = new PluginKey("focusMode");

function createFocusDecoration(state: EditorState): DecorationSet | null {
  const focusEnabled = useUIStore.getState().focusModeEnabled;
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

/** Tiptap extension that dims non-focused paragraphs in focus mode. */
export const focusModeExtension = Extension.create({
  name: "focusMode",
  addProseMirrorPlugins() {
    let lastFocusMode = useUIStore.getState().focusModeEnabled;

    return [
      new Plugin({
        key: focusPluginKey,
        view: (view) => {
          const unsubscribe = useUIStore.subscribe((state) => {
            if (state.focusModeEnabled !== lastFocusMode) {
              lastFocusMode = state.focusModeEnabled;
              runOrQueueProseMirrorAction(view, () =>
                view.dispatch(view.state.tr.setMeta(focusPluginKey, "toggle"))
              );
            }
          });

          return {
            destroy: () => {
              unsubscribe();
            },
          };
        },
        state: {
          init(_, editorState) {
            return createFocusDecoration(editorState);
          },
          apply(tr, oldDecos, _oldState, newState) {
            if (tr.selectionSet || tr.getMeta(focusPluginKey)) {
              return createFocusDecoration(newState);
            }
            if (tr.docChanged && oldDecos) {
              return oldDecos.map(tr.mapping, tr.doc);
            }
            return oldDecos;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
