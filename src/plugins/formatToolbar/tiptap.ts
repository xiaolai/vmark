/**
 * Format Toolbar Extension for Tiptap
 *
 * NOTE: Ctrl+E is now handled by the universal toolbar (useUniversalToolbar hook).
 * The context-aware popup is retired in favor of the universal toolbar.
 *
 * This extension still provides:
 * - The TiptapFormatToolbarView for store-driven popup (opened by other triggers)
 * - Selection persist decoration (highlights selection when toolbar is open)
 */
import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useFormatToolbarStore } from "@/stores/formatToolbarStore";
import { TiptapFormatToolbarView } from "./TiptapFormatToolbarView";

const formatToolbarPluginKey = new PluginKey("tiptapFormatToolbar");

export const formatToolbarExtension = Extension.create({
  name: "formatToolbar",
  priority: 1100,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: formatToolbarPluginKey,
        view(editorView) {
          const toolbarView = new TiptapFormatToolbarView(editorView);
          return { destroy: () => toolbarView.destroy() };
        },
      }),
      new Plugin({
        props: {
          decorations(state) {
            const store = useFormatToolbarStore.getState();
            const selection = state.selection;
            if (!store.isOpen || selection.empty) return null;
            if (selection instanceof NodeSelection) return null;
            const decoration = Decoration.inline(selection.from, selection.to, {
              class: "pm-selection-persist",
            });
            return DecorationSet.create(state.doc, [decoration]);
          },
        },
      }),
    ];
  },
});
