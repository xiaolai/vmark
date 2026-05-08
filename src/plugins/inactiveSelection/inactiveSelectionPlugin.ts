/**
 * Purpose: Render the editor's TextSelection as a dimmed overlay while the
 *   ProseMirror view is blurred. The browser clears the native ::selection
 *   highlight on blur, so without this plugin a user who selects text in
 *   the editor and then focuses the built-in terminal (or any other field)
 *   loses the visual cue for what is selected — even though
 *   `state.selection` is preserved and MCP tools like
 *   `vmark.selection.{get,set}` still operate on the right range.
 *
 * Key decisions:
 *   - Track focus in plugin state. Decorations are derived from
 *     `(focused, selection)`, so they recompute on every focus flip and
 *     every selection change without separate listeners.
 *   - Listen for native `focus` / `blur` on `view.dom`, dispatching a
 *     transaction with meta to update plugin state. ProseMirror's
 *     `EditorView.hasFocus()` is read once at view-init time so an
 *     editor that mounts already focused does not flicker into the
 *     "blurred" branch on first paint.
 *   - One inline decoration over the whole selection range. Multi-range
 *     selections (e.g., the multi-cursor plugin) are not in scope here —
 *     the multi-cursor plugin renders its own non-primary highlights and
 *     fully owns selection display in its active mode.
 *   - Empty selection → no decoration. A bare cursor while blurred
 *     should not render anything (would look like a stray bar).
 *
 * @coordinates-with hooks/mcpBridge/v2/selection.ts — the MCP tools that
 *   benefit from visible selection while focus is elsewhere
 * @module plugins/inactiveSelection/inactiveSelectionPlugin
 */
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { INACTIVE_SELECTION_CLASS } from "./constants";

export { INACTIVE_SELECTION_CLASS };

interface InactiveSelectionState {
  focused: boolean;
}

export const inactiveSelectionPluginKey =
  new PluginKey<InactiveSelectionState>("inactiveSelection");

export function inactiveSelectionPlugin(): Plugin<InactiveSelectionState> {
  return new Plugin<InactiveSelectionState>({
    key: inactiveSelectionPluginKey,

    state: {
      init: (): InactiveSelectionState => ({ focused: false }),
      apply(
        tr: Transaction,
        prev: InactiveSelectionState,
      ): InactiveSelectionState {
        const meta = tr.getMeta(inactiveSelectionPluginKey) as
          | { focused?: unknown }
          | undefined;
        if (meta && typeof meta.focused === "boolean") {
          if (meta.focused === prev.focused) return prev;
          return { focused: meta.focused };
        }
        return prev;
      },
    },

    view(view: EditorView) {
      const setFocused = (focused: boolean) => {
        // Defensive: a `blur` event can be delivered as a microtask after
        // the view starts tearing down. Dispatching into a destroyed view
        // throws.
        if (view.isDestroyed) return;
        const cur = inactiveSelectionPluginKey.getState(view.state);
        if (cur?.focused === focused) return;
        view.dispatch(
          view.state.tr.setMeta(inactiveSelectionPluginKey, { focused }),
        );
      };
      const onFocus = () => setFocused(true);
      const onBlur = () => setFocused(false);
      view.dom.addEventListener("focus", onFocus);
      view.dom.addEventListener("blur", onBlur);
      // Sync the plugin's state with the DOM truth at construction time so
      // an editor mounted already focused (autofocus, programmatic focus
      // before plugin attach) doesn't render dimmed selection until the
      // first focus event.
      setFocused(view.hasFocus());
      return {
        destroy() {
          view.dom.removeEventListener("focus", onFocus);
          view.dom.removeEventListener("blur", onBlur);
        },
      };
    },

    props: {
      decorations(state: EditorState): DecorationSet | null {
        const pluginState = inactiveSelectionPluginKey.getState(state);
        if (!pluginState || pluginState.focused) return null;
        const { from, to } = state.selection;
        if (from === to) return null;
        return DecorationSet.create(state.doc, [
          Decoration.inline(from, to, { class: INACTIVE_SELECTION_CLASS }),
        ]);
      },
    },
  });
}
