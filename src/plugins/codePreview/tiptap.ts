/**
 * Code Preview Tiptap Extension
 *
 * Purpose: Renders live previews below code blocks for special languages (LaTeX/math,
 * Mermaid diagrams, Markmap mindmaps, SVG) in WYSIWYG mode. Also handles click-to-edit
 * for block math ($$...$$ code blocks).
 *
 * Pipeline: code_block node -> detect language -> render preview widget decoration
 *         -> debounced re-render on content change -> click to edit -> Cmd+Enter to commit
 *
 * Key decisions:
 *   - Previews are ProseMirror widget decorations (not node views) to avoid complicating
 *     the document schema
 *   - Preview rendering is debounced (200ms) to avoid re-rendering on every keystroke
 *   - Each preview type has its own renderer (in renderers/ directory)
 *   - Block math uses a special "$$math$$" sentinel language to distinguish from regular latex
 *   - Export buttons (copy SVG, download PNG) are injected into diagram previews
 *
 * Known limitations:
 *   - Module-level `currentEditorView` is used for button callbacks (not ideal for multi-editor)
 *
 * @coordinates-with blockMathKeymap.ts — keyboard shortcuts for math editing
 * @coordinates-with previewHelpers.ts — shared element creation and utility functions
 * @coordinates-with renderers/ — per-language preview renderers
 * @module plugins/codePreview/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { updateMermaidTheme } from "../mermaid";
import { diagramWarn } from "@/utils/debug";
import { updateMarkmapTheme } from "@/plugins/markmap";
import { sweepDetached } from "@/plugins/shared/diagramCleanup";
import { useBlockMathEditingStore } from "@/stores/blockMathEditingStore";
import {
  isLatexLanguage,
  createPreviewElement,
  createPreviewPlaceholder,
  createLivePreview,
  createEditHeader,
  type PreviewCacheEntry,
} from "./previewHelpers";
import { updateLatexLivePreview, createLatexPreviewWidget } from "./renderers/renderLatex";
import { updateMermaidLivePreview, createMermaidPreviewWidget } from "./renderers/renderMermaidPreview";
import { updateMarkmapLivePreview, createMarkmapPreviewWidget } from "./renderers/renderMarkmapPreview";
import { updateSvgLivePreview, createSvgPreviewWidget } from "./renderers/renderSvgPreview";
import "./code-preview.css";

const codePreviewPluginKey = new PluginKey("codePreview");
const PREVIEW_ONLY_LANGUAGES = new Set(["latex", "mermaid", "markmap", "svg", "$$math$$"]);
const DEBOUNCE_MS = 200;

// Store current editor view for button callbacks
let currentEditorView: EditorView | null = null;

const previewCache = new Map<string, PreviewCacheEntry>();

let themeObserverSetup = false;

function setupThemeObserver() {
  if (themeObserverSetup || typeof window === "undefined") return;
  themeObserverSetup = true;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.attributeName === "class") {
        const isDark = document.documentElement.classList.contains("dark");
        updateMermaidTheme(isDark).then((themeChanged) => {
          if (themeChanged) {
            previewCache.clear();
          }
        }).catch((error: unknown) => {
          diagramWarn("Mermaid theme update failed:", error instanceof Error ? error.message : String(error));
        });
        updateMarkmapTheme(isDark);
      }
    }
  });

  observer.observe(document.documentElement, { attributes: true });
}

setupThemeObserver();

/** Update live preview content with debouncing */
let livePreviewTimeout: ReturnType<typeof setTimeout> | null = null;
let livePreviewToken = 0;

function updateLivePreview(
  element: HTMLElement,
  language: string,
  content: string
): void {
  if (livePreviewTimeout) {
    clearTimeout(livePreviewTimeout);
  }

  const currentToken = ++livePreviewToken;
  const getToken = () => livePreviewToken;

  livePreviewTimeout = setTimeout(async () => {
    if (currentToken !== livePreviewToken) return;

    const trimmed = content.trim();
    if (!trimmed) {
      element.innerHTML = '<div class="code-block-live-preview-empty">Empty</div>';
      return;
    }

    if (isLatexLanguage(language)) {
      updateLatexLivePreview(element, trimmed, currentToken, getToken);
    } else if (language === "mermaid") {
      await updateMermaidLivePreview(element, trimmed, currentToken, getToken);
    } else if (language === "markmap") {
      await updateMarkmapLivePreview(element, trimmed, currentToken, getToken);
    } else if (language === "svg") {
      updateSvgLivePreview(element, trimmed, currentToken, getToken);
    }
  }, DEBOUNCE_MS);
}

/** Meta key to signal editing state change */
const EDITING_STATE_CHANGED = "codePreviewEditingChanged";
/** Meta key to signal settings changed (font size, etc.) */
const SETTINGS_CHANGED = "codePreviewSettingsChanged";

interface CodePreviewState {
  decorations: DecorationSet;
  editingPos: number | null;
}

/** Exit editing mode */
function exitEditMode(view: EditorView | null, revert: boolean): void {
  // Use stored view if passed view is not valid
  const editorView = view || currentEditorView;
  if (!editorView) {
    return;
  }

  const store = useBlockMathEditingStore.getState();
  const { editingPos, originalContent } = store;

  if (editingPos === null) {
    return;
  }

  const { state, dispatch } = editorView;
  const node = state.doc.nodeAt(editingPos);

  if (!node) {
    store.exitEditing();
    dispatch(state.tr.setMeta(EDITING_STATE_CHANGED, true));
    livePreviewToken++;
    if (livePreviewTimeout) {
      clearTimeout(livePreviewTimeout);
      livePreviewTimeout = null;
    }
    return;
  }

  let tr = state.tr;

  // If reverting, restore original content
  if (revert && originalContent !== null) {
    const currentContent = node.textContent;
    if (currentContent !== originalContent) {
      const start = editingPos + 1;
      const end = editingPos + node.nodeSize - 1;
      tr = tr.replaceWith(start, end, originalContent ? state.schema.text(originalContent) : []);
    }
  }

  // Clear render cache for this content to force re-render
  const language = (node.attrs.language ?? "").toLowerCase();
  const content = revert ? originalContent : node.textContent;
  if (content) {
    const cacheKey = `${language}:${content}`;
    previewCache.delete(cacheKey);
  }

  // Move cursor after the code block
  const nodeEnd = editingPos + node.nodeSize;
  const $pos = state.doc.resolve(Math.min(nodeEnd, state.doc.content.size));
  tr = tr.setSelection(TextSelection.near($pos));
  tr.setMeta(EDITING_STATE_CHANGED, true);

  // Exit editing FIRST (before dispatch, so decorations see the new state)
  store.exitEditing();
  dispatch(tr);

  // Reset live preview token
  livePreviewToken++;
  if (livePreviewTimeout) {
    clearTimeout(livePreviewTimeout);
    livePreviewTimeout = null;
  }
}

export const codePreviewExtension = Extension.create({
  name: "codePreview",
  addProseMirrorPlugins() {
    // Keep track of live preview element for updates
    let currentLivePreview: HTMLElement | null = null;
    let currentEditingLanguage: string | null = null;

    return [
      new Plugin({
        key: codePreviewPluginKey,
        state: {
          init(): CodePreviewState {
            return { decorations: DecorationSet.empty, editingPos: null };
          },
          apply(tr, state, _oldState, newState): CodePreviewState {
            const storeEditingPos = useBlockMathEditingStore.getState().editingPos;
            const editingChanged = tr.getMeta(EDITING_STATE_CHANGED) || state.editingPos !== storeEditingPos;
            const settingsChanged = tr.getMeta(SETTINGS_CHANGED);

            // Update live preview if doc changed and we're editing
            if (tr.docChanged && storeEditingPos !== null && currentLivePreview && currentEditingLanguage) {
              const node = newState.doc.nodeAt(storeEditingPos);
              if (node) {
                updateLivePreview(currentLivePreview, currentEditingLanguage, node.textContent);
              }
            }

            // Only recompute decorations if doc changed, editing state changed, or settings changed
            if (!tr.docChanged && !editingChanged && !settingsChanged && state.decorations !== DecorationSet.empty) {
              return {
                decorations: state.decorations.map(tr.mapping, tr.doc),
                editingPos: state.editingPos,
              };
            }

            // Sweep diagram instances whose DOM was removed by ProseMirror
            sweepDetached();

            const newDecorations: Decoration[] = [];
            const currentEditingPos = storeEditingPos;

            newState.doc.descendants((node, pos) => {
              if (node.type.name !== "codeBlock" && node.type.name !== "code_block") return;

              const language = (node.attrs.language ?? "").toLowerCase();
              if (!PREVIEW_ONLY_LANGUAGES.has(language)) return;

              const content = node.textContent;
              const cacheKey = `${language}:${content}`;
              const nodeStart = pos;
              const nodeEnd = pos + node.nodeSize;

              // Check if this block is being edited
              const isEditing = currentEditingPos === nodeStart;

              if (isEditing) {
                currentEditingLanguage = language;

                // Add header widget before the code block
                const headerWidget = Decoration.widget(
                  nodeStart,
                  (widgetView) => {
                    const onCopy = (language === "mermaid" || language === "markmap" || language === "svg")
                      ? () => {
                          const node = widgetView?.state.doc.nodeAt(nodeStart);
                          if (node) navigator.clipboard.writeText(node.textContent);
                        }
                      : undefined;
                    return createEditHeader(
                      language,
                      () => exitEditMode(widgetView, true), // Cancel
                      () => exitEditMode(widgetView, false), // Save
                      onCopy,
                    );
                  },
                  { side: -1, key: `${nodeStart}:header` }
                );
                newDecorations.push(headerWidget);

                // Add editing class to code block
                newDecorations.push(
                  Decoration.node(nodeStart, nodeEnd, {
                    class: "code-block-editing",
                    "data-language": language,
                  })
                );

                // Add live preview widget after the code block
                const previewWidget = Decoration.widget(
                  nodeEnd,
                  () => {
                    const preview = createLivePreview(language);
                    currentLivePreview = preview;
                    // Initial render
                    updateLivePreview(preview, language, content);
                    return preview;
                  },
                  { side: 1, key: `${nodeStart}:live-preview` }
                );
                newDecorations.push(previewWidget);

                return;
              }

              // Reset tracking when not editing
              if (state.editingPos === nodeStart && currentEditingPos !== nodeStart) {
                currentLivePreview = null;
                currentEditingLanguage = null;
              }

              const handleEnterEdit = (view: EditorView | null | undefined) => {
                if (!view) return;
                // Update store FIRST (before dispatch, so decorations see the new state)
                useBlockMathEditingStore.getState().startEditing(nodeStart, content);
                // Then dispatch transaction to trigger decoration rebuild
                const $pos = view.state.doc.resolve(nodeStart + 1);
                const tr = view.state.tr.setSelection(TextSelection.near($pos));
                tr.setMeta(EDITING_STATE_CHANGED, true);
                view.dispatch(tr);
                view.focus();
              };

              newDecorations.push(
                Decoration.node(nodeStart, nodeEnd, {
                  class: "code-block-preview-only",
                  "data-language": language,
                  contenteditable: "false",
                })
              );

              if (!content.trim()) {
                const placeholderLabel = language === "mermaid" ? "Empty diagram"
                  : language === "markmap" ? "Empty mindmap"
                  : language === "svg" ? "Empty SVG" : "Empty math block";
                const widget = Decoration.widget(
                  nodeEnd,
                  (view) => createPreviewPlaceholder(language, placeholderLabel, () => handleEnterEdit(view)),
                  { side: 1, key: `${cacheKey}:placeholder` }
                );
                newDecorations.push(widget);
                return;
              }

              // Check cache for already-rendered content
              const cached = previewCache.get(cacheKey);
              if (cached?.rendered) {
                const rendered = cached.rendered;
                const widget = Decoration.widget(
                  nodeEnd,
                  (view) => createPreviewElement(language, rendered, () => handleEnterEdit(view), content),
                  { side: 1, key: cacheKey }
                );
                newDecorations.push(widget);
                return;
              }

              // Markmap renders to live DOM — skip cache, always create fresh
              if (language === "markmap") {
                newDecorations.push(
                  createMarkmapPreviewWidget(nodeEnd, content, cacheKey, handleEnterEdit)
                );
                return;
              }

              // LaTeX (async rendering with placeholder)
              if (isLatexLanguage(language)) {
                newDecorations.push(
                  createLatexPreviewWidget(nodeEnd, content, cacheKey, previewCache, handleEnterEdit)
                );
                return;
              }

              // SVG (synchronous rendering)
              if (language === "svg") {
                newDecorations.push(
                  createSvgPreviewWidget(nodeEnd, content, cacheKey, previewCache, handleEnterEdit)
                );
                return;
              }

              // Mermaid (async rendering with placeholder)
              if (language === "mermaid") {
                newDecorations.push(
                  createMermaidPreviewWidget(nodeEnd, content, cacheKey, previewCache, handleEnterEdit)
                );
              }
            });

            return {
              decorations: DecorationSet.create(newState.doc, newDecorations),
              editingPos: currentEditingPos,
            };
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
        view(view) {
          // Store the view for button callbacks
          currentEditorView = view;
          return {
            update(view) {
              currentEditorView = view;
            },
            destroy() {
              currentEditorView = null;
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
  if (currentEditorView) {
    const tr = currentEditorView.state.tr;
    tr.setMeta(SETTINGS_CHANGED, true);
    currentEditorView.dispatch(tr);
  }
}
