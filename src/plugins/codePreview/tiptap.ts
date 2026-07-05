/**
 * Code Preview Tiptap Extension
 *
 * Purpose: Renders live previews below code blocks for special languages (LaTeX/math,
 * Mermaid diagrams, Graphviz/DOT diagrams, Markmap mindmaps, SVG, GitHub Actions
 * workflow YAML) in WYSIWYG mode.
 * Also handles click-to-edit for block math ($$...$$ code blocks). This file is the
 * extension entry point; the heavy lifting lives in sibling modules.
 *
 * Pipeline: code_block node -> detect language (transactionScan.ts) -> render preview
 *         widget decoration (previewDecorations.ts) -> debounced re-render on content
 *         change -> click to edit -> Cmd+Enter to commit (editMode.ts)
 *
 * Key decisions:
 *   - Plugin state tracks `codeBlockRanges` so the apply() fast path can skip the full
 *     doc.descendants() scan when a transaction doesn't touch any code block
 *   - Block math uses a special "$$math$$" sentinel language to distinguish from
 *     regular latex
 *   - Shared module state (plugin key, meta keys, view registry, preview cache)
 *     lives in pluginState.ts; this file re-exports the public names so import
 *     paths stay stable
 *
 * @coordinates-with pluginState.ts — shared state, meta keys, plugin state types
 * @coordinates-with transactionScan.ts — previewability + fast-path transaction checks
 * @coordinates-with previewDecorations.ts — full-scan decoration builder
 * @coordinates-with editMode.ts — debounced live preview + save/cancel edit mode
 * @coordinates-with themeObserver.ts — theme changes (class or token flips) invalidate previews
 * @coordinates-with blockMathKeymap.ts — keyboard shortcuts for math editing
 * @module plugins/codePreview/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import { sweepDetached } from "@/plugins/shared/diagramCleanup";
import { useBlockMathEditingStore } from "@/stores/blockMathEditingStore";
import {
  codePreviewPluginKey,
  EDITING_STATE_CHANGED,
  SETTINGS_CHANGED,
  activeEditorViews,
  previewCache,
  type CodePreviewState,
} from "./pluginState";
import {
  changesIntersectRanges,
  countPreviewableCodeBlocks,
  transactionMayAffectCodeBlock,
} from "./transactionScan";
import { updateLivePreview } from "./editMode";
import {
  buildCodePreviewDecorations,
  type LivePreviewTracker,
} from "./previewDecorations";
import { setupThemeObserver } from "./themeObserver";
import "./code-preview.css";

setupThemeObserver();

export const codePreviewExtension = Extension.create({
  name: "codePreview",
  addProseMirrorPlugins() {
    // Keep track of live preview element for updates
    const tracker: LivePreviewTracker = {
      currentLivePreview: null,
      currentEditingLanguage: null,
    };

    return [
      new Plugin({
        key: codePreviewPluginKey,
        state: {
          init(): CodePreviewState {
            return { decorations: DecorationSet.empty, editingPos: null, codeBlockRanges: [] };
          },
          apply(tr, state, _oldState, newState): CodePreviewState {
            const storeEditingPos = useBlockMathEditingStore.getState().editingPos;
            const editingChanged = tr.getMeta(EDITING_STATE_CHANGED) || state.editingPos !== storeEditingPos;
            const settingsChanged = tr.getMeta(SETTINGS_CHANGED);

            // Update live preview if doc changed and we're editing
            if (tr.docChanged && storeEditingPos !== null && tracker.currentLivePreview && tracker.currentEditingLanguage) {
              const node = newState.doc.nodeAt(storeEditingPos);
              /* v8 ignore next 3 -- @preserve false branch (node null) requires editingPos to point at a boundary-only position inside a just-modified doc, a race window unreachable in deterministic jsdom tests */
              if (node) {
                updateLivePreview(tracker.currentLivePreview, tracker.currentEditingLanguage, node.textContent);
              }
            }

            // Only recompute decorations if doc changed, editing state changed, or settings changed
            if (!tr.docChanged && !editingChanged && !settingsChanged && state.decorations !== DecorationSet.empty) {
              return {
                decorations: state.decorations.map(tr.mapping, tr.doc),
                editingPos: state.editingPos,
                codeBlockRanges: state.codeBlockRanges.map((r) => ({
                  from: tr.mapping.map(r.from),
                  to: tr.mapping.map(r.to),
                })),
              };
            }

            // Fast path: if doc changed but the change doesn't touch any code block
            // AND the number of code blocks hasn't changed, skip the full scan.
            //
            // Cheap check first (changesIntersectRanges is O(steps × ranges)). Only
            // pay the O(blocks) doc walk to verify no insertions/deletions when
            // changes don't touch code blocks — otherwise the fast path would
            // fail anyway and the count was wasted. The count is depth-aware
            // (countPreviewableCodeBlocks) because the builder tracks nested
            // blocks too — a top-level-only count let nested inserts slip past.
            if (
              tr.docChanged &&
              !editingChanged &&
              !settingsChanged &&
              state.decorations !== DecorationSet.empty &&
              !changesIntersectRanges(tr, state.codeBlockRanges)
            ) {
              if (countPreviewableCodeBlocks(newState.doc) === state.codeBlockRanges.length) {
                return {
                  decorations: state.decorations.map(tr.mapping, tr.doc),
                  editingPos: state.editingPos,
                  codeBlockRanges: state.codeBlockRanges.map((r) => ({
                    from: tr.mapping.map(r.from),
                    to: tr.mapping.map(r.to),
                  })),
                };
              }
            }

            // O1 fast path — prose-only docs. With zero tracked previewable
            // code blocks the two fast paths above don't apply (both require a
            // non-empty decoration set), so every keystroke would otherwise fall
            // through to the full descendants() walk below. Confirm cheaply that
            // no previewable block exists AT ANY DEPTH (a nested yaml block can
            // become workflow-shaped from a plain text edit) or was just
            // inserted, then early-return the empty set without the full walk.
            if (
              tr.docChanged &&
              !editingChanged &&
              !settingsChanged &&
              state.codeBlockRanges.length === 0
            ) {
              if (
                countPreviewableCodeBlocks(newState.doc) === 0 &&
                !transactionMayAffectCodeBlock(tr)
              ) {
                return {
                  decorations: DecorationSet.empty,
                  editingPos: state.editingPos,
                  codeBlockRanges: [],
                };
              }
            }

            // Sweep diagram instances whose DOM was removed by ProseMirror
            sweepDetached();

            const currentEditingPos = storeEditingPos;
            const { decorations, codeBlockRanges } = buildCodePreviewDecorations(
              newState.doc,
              currentEditingPos,
              state.editingPos,
              tracker,
            );

            return {
              decorations: DecorationSet.create(newState.doc, decorations),
              editingPos: currentEditingPos,
              codeBlockRanges,
            };
          },
        },
        props: {
          decorations(state) {
            /* v8 ignore next -- @preserve defensive nullish fallback: getState always returns CodePreviewState after init */
            return this.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
        view(view) {
          // Register this view so refreshPreviews can dispatch into it.
          // destroy() unregisters so refreshPreviews doesn't dispatch into
          // torn-down editors. update() is a no-op (PM passes the same view
          // across updates), kept for PluginView interface conformance.
          activeEditorViews.add(view);
          return {
            update() {
              /* no-op — view instance is stable across updates */
            },
            destroy() {
              activeEditorViews.delete(view);
            },
          };
        },
      }),
    ];
  },
});

/** Export plugin key for other extensions */
export { codePreviewPluginKey, EDITING_STATE_CHANGED, SETTINGS_CHANGED };

export function clearPreviewCache() {
  previewCache.clear();
}

/**
 * Clear preview cache and trigger a re-render of all preview decorations.
 * Call this when settings like font size change.
 */
export function refreshPreviews() {
  previewCache.clear();
  for (const view of activeEditorViews) {
    const tr = view.state.tr;
    tr.setMeta(SETTINGS_CHANGED, true);
    view.dispatch(tr);
  }
}

/**
 * Test-only: empty the active-views registry. Tests that exercise the plugin
 * lifecycle via `spec.view!()` directly (rather than through a real Editor)
 * can leak entries; use this in `beforeEach` to isolate. Not for production.
 */
export function __resetActiveEditorViewsForTesting(): void {
  activeEditorViews.clear();
}
