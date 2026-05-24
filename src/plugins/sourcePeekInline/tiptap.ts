/**
 * Inline Source Peek Plugin
 *
 * Provides inline split view for editing markdown source of ProseMirror blocks.
 * Uses decorations to insert a CodeMirror editor above the block being edited.
 *
 * Architecture:
 * - Header widget (block type label, cancel/save buttons)
 * - CodeMirror widget (markdown source editor)
 * - Node decoration (dims the preview block)
 *
 * @coordinates-with sourcePeekHeader.ts (createEditHeader)
 * @coordinates-with sourcePeekEditor.ts (createCodeMirrorEditor, cleanupCMView)
 * @coordinates-with sourcePeekActions.ts (action functions, EDITING_STATE_CHANGED)
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useSourcePeekStore } from "@/stores/sourcePeekStore";
import { applySourcePeekMarkdown, getExpandedSourcePeekRange } from "@/services/editor/sourcePeek";
import { createEditHeader } from "./sourcePeekHeader";
import { createCodeMirrorEditor, cleanupCMView } from "./sourcePeekEditor";
import {
  EDITING_STATE_CHANGED,
  getMarkdownOptions,
  canUseSourcePeek,
  openSourcePeekInline,
  commitSourcePeek,
  revertAndCloseSourcePeek,
} from "./sourcePeekActions";
import "./source-peek-inline.css";

const sourcePeekInlinePluginKey = new PluginKey("sourcePeekInline");

interface SourcePeekPluginState {
  decorations: DecorationSet;
  editingPos: number | null;
}

export const sourcePeekInlineExtension = Extension.create({
  name: "sourcePeekInline",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: sourcePeekInlinePluginKey,
        state: {
          init(): SourcePeekPluginState {
            return { decorations: DecorationSet.empty, editingPos: null };
          },
          apply(tr, state, _oldState, newState): SourcePeekPluginState {
            const store = useSourcePeekStore.getState();
            const { isOpen, range, markdown, blockTypeName, hasUnsavedChanges, livePreview } = store;

            const editingChanged = tr.getMeta(EDITING_STATE_CHANGED);
            const currentEditingPos = isOpen && range ? range.from : null;

            // If not editing or no changes, map decorations
            if (!isOpen || !range) {
              cleanupCMView();
              return { decorations: DecorationSet.empty, editingPos: null };
            }

            // Only rebuild decorations if editing state changed
            if (!editingChanged && state.editingPos === currentEditingPos && state.decorations !== DecorationSet.empty) {
              return {
                decorations: state.decorations.map(tr.mapping, tr.doc),
                editingPos: currentEditingPos,
              };
            }

            const decorations: Decoration[] = [];
            const nodeStart = range.from;
            const node = newState.doc.nodeAt(nodeStart);
            if (!node) {
              return { decorations: DecorationSet.empty, editingPos: null };
            }

            const nodeEnd = nodeStart + node.nodeSize;

            // Create wrapper widget that contains header + editor
            const wrapperWidget = Decoration.widget(
              nodeStart,
              (view) => {
                const wrapper = document.createElement("div");
                wrapper.className = "source-peek-inline";

                // Header
                const header = createEditHeader(
                  blockTypeName ?? node.type.name,
                  hasUnsavedChanges,
                  () => revertAndCloseSourcePeek(view),
                  () => commitSourcePeek(view),
                  () => {
                    useSourcePeekStore.getState().toggleLivePreview();
                    // Rebuild decorations
                    const tr = view.state.tr.setMeta(EDITING_STATE_CHANGED, true);
                    view.dispatch(tr);
                  },
                  livePreview
                );
                wrapper.appendChild(header);

                // CodeMirror editor
                const editor = createCodeMirrorEditor(
                  markdown,
                  () => commitSourcePeek(view),
                  () => revertAndCloseSourcePeek(view),
                  (newMarkdown) => {
                    useSourcePeekStore.getState().setMarkdown(newMarkdown);

                    // Live preview: apply changes immediately
                    if (useSourcePeekStore.getState().livePreview) {
                      const currentRange = useSourcePeekStore.getState().range;
                      if (currentRange) {
                        const options = getMarkdownOptions();
                        applySourcePeekMarkdown(view, currentRange, newMarkdown, options);
                        // Update range after apply (content may have changed size)
                        const newRange = getExpandedSourcePeekRange(view.state);
                        useSourcePeekStore.setState({ range: newRange });
                      }
                    }
                  }
                );
                wrapper.appendChild(editor);

                return wrapper;
              },
              { side: -1, key: `source-peek:${nodeStart}` }
            );
            decorations.push(wrapperWidget);

            // Mark the node as being edited
            // Show dimmed preview when live preview is ON, hide when OFF
            decorations.push(
              Decoration.node(nodeStart, nodeEnd, {
                class: livePreview ? "source-peek-editing source-peek-live" : "source-peek-editing",
              })
            );

            return {
              decorations: DecorationSet.create(newState.doc, decorations),
              editingPos: currentEditingPos,
            };
          },
        },
        props: {
          decorations(state) {
            /* v8 ignore next -- @preserve reason: missing plugin state fallback not exercised in tests */
            return this.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
        view() {
          return {
            destroy() {
              cleanupCMView();
            },
          };
        },
      }),
    ];
  },
});

export {
  sourcePeekInlinePluginKey,
  EDITING_STATE_CHANGED,
  canUseSourcePeek,
  openSourcePeekInline,
  commitSourcePeek,
  revertAndCloseSourcePeek,
};
