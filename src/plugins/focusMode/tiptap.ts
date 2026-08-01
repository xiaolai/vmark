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
import { runOrQueueProseMirrorAction } from "@/utils/imeGuard";
import "./focus-mode.css";

const focusPluginKey = new PluginKey("focusMode");

/** Options for the focus-mode extension. */
export interface FocusModeOptions {
  /**
   * Whether focus mode is on, asked fresh each time.
   *
   * INJECTED. A plugin that reaches the app's Zustand singletons cannot ship
   * as a standalone extension (ADR-015). A predicate, not a boolean: the
   * plugin re-asks per transaction so the toggle takes effect immediately.
   */
  isEnabled: () => boolean;
  /**
   * Subscribe to changes in that answer; returns an unsubscribe.
   *
   * The plugin needs to REDRAW when the toggle flips, not merely to read the
   * new value next time it happens to run. Injected for the same reason as
   * `isEnabled` — a store subscription is a store dependency.
   *
   * @default a no-op — a host with no toggle never changes the answer
   */
  onChange: (listener: () => void) => () => void;
}

function createFocusDecoration(
  state: EditorState,
  isEnabled: () => boolean,
): DecorationSet | null {
  if (!isEnabled()) return null;

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
export const focusModeExtension = Extension.create<FocusModeOptions>({
  name: "focusMode",
  // Off by default: dimming text is a deliberate choice, so a host that says
  // nothing gets the plain editor rather than a surprise.
  addOptions() {
    return { isEnabled: () => false, onChange: () => () => {} };
  },
  addProseMirrorPlugins() {
    const { isEnabled, onChange } = this.options;
    let lastFocusMode = isEnabled();

    return [
      new Plugin({
        key: focusPluginKey,
        view: (view) => {
          const unsubscribe = onChange(() => {
            const now = isEnabled();
            if (now === lastFocusMode) return;
            lastFocusMode = now;
            runOrQueueProseMirrorAction(view, () =>
              view.dispatch(view.state.tr.setMeta(focusPluginKey, "toggle"))
            );
          });

          return {
            destroy: () => {
              unsubscribe();
            },
          };
        },
        state: {
          init(_, editorState) {
            return createFocusDecoration(editorState, isEnabled);
          },
          apply(tr, oldDecos, _oldState, newState) {
            if (tr.selectionSet || tr.getMeta(focusPluginKey)) {
              return createFocusDecoration(newState, isEnabled);
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
