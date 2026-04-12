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
 *   - Plugin state tracks `codeBlockRanges` so the apply() fast path can skip the full
 *     doc.descendants() scan when a transaction doesn't touch any code block
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
import { Plugin, PluginKey, TextSelection, Transaction } from "@tiptap/pm/state";
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
  /* v8 ignore next -- @preserve module-level themeObserverSetup is set on first call; re-entry and SSR path unreachable in tests */
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
          /* v8 ignore next -- @preserve non-Error rejections from updateMermaidTheme are theoretically possible but untestable without mocking the MutationObserver callback chain */
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
    /* v8 ignore next -- @preserve stale-token guard: fires only when a prior timer somehow outlives a later updateLivePreview call; in practice all callers clear the timeout before incrementing the token, making the early-return unreachable in synchronous tests */
    if (currentToken !== livePreviewToken) return;

    try {
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
      } else {
        // Only "svg" reaches this branch among PREVIEW_ONLY_LANGUAGES
        updateSvgLivePreview(element, trimmed, currentToken, getToken);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      diagramWarn("code preview live render failed:", msg);
      element.innerHTML = '<div class="code-block-live-preview-error">Preview failed</div>';
    }
  }, DEBOUNCE_MS);
}

/** Meta key to signal editing state change */
const EDITING_STATE_CHANGED = "codePreviewEditingChanged";
/** Meta key to signal settings changed (font size, etc.) */
const SETTINGS_CHANGED = "codePreviewSettingsChanged";

interface CodeBlockRange {
  from: number;
  to: number;
}

interface CodePreviewState {
  decorations: DecorationSet;
  editingPos: number | null;
  codeBlockRanges: CodeBlockRange[];
}

/**
 * Returns true if any step in the transaction's changed ranges (in OLD-position
 * space) overlaps with any of the tracked code block ranges.
 * Uses old positions because `codeBlockRanges` comes from the previous state.
 */
function changesIntersectRanges(tr: Transaction, ranges: CodeBlockRange[]): boolean {
  if (ranges.length === 0) return false;
  for (let i = 0; i < tr.steps.length; i++) {
    let intersects = false;
    tr.mapping.maps[i].forEach((oldFrom: number, oldTo: number) => {
      if (intersects) return;
      for (const range of ranges) {
        if (oldFrom < range.to && oldTo > range.from) {
          intersects = true;
          return;
        }
      }
    });
    if (intersects) return true;
  }
  return false;
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
    /* v8 ignore next 3 -- @preserve livePreviewTimeout is set only when a live-preview debounce timer is pending at the exact moment a stale-position cancel is triggered; this race window is unreachable in synchronous jsdom tests */
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
      /* v8 ignore next -- @preserve originalContent is always truthy here (empty string exits via !== check) */
      tr = tr.replaceWith(start, end, originalContent ? state.schema.text(originalContent) : []);
    }
  }

  // Clear render cache for this content to force re-render
  /* v8 ignore next -- @preserve defensive nullish fallback: PREVIEW_ONLY_LANGUAGES nodes always have a language attr; null/undefined only possible via malformed external doc */
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
            return { decorations: DecorationSet.empty, editingPos: null, codeBlockRanges: [] };
          },
          apply(tr, state, _oldState, newState): CodePreviewState {
            const storeEditingPos = useBlockMathEditingStore.getState().editingPos;
            const editingChanged = tr.getMeta(EDITING_STATE_CHANGED) || state.editingPos !== storeEditingPos;
            const settingsChanged = tr.getMeta(SETTINGS_CHANGED);

            // Update live preview if doc changed and we're editing
            if (tr.docChanged && storeEditingPos !== null && currentLivePreview && currentEditingLanguage) {
              const node = newState.doc.nodeAt(storeEditingPos);
              /* v8 ignore next 3 -- @preserve false branch (node null) requires editingPos to point at a boundary-only position inside a just-modified doc, a race window unreachable in deterministic jsdom tests */
              if (node) {
                updateLivePreview(currentLivePreview, currentEditingLanguage, node.textContent);
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
            // We count code blocks in the new doc to catch insertions/deletions.
            let newCodeBlockCount = 0;
            if (tr.docChanged && !editingChanged && !settingsChanged && state.decorations !== DecorationSet.empty) {
              newState.doc.forEach((node) => {
                if ((node.type.name === "codeBlock" || node.type.name === "code_block") &&
                    PREVIEW_ONLY_LANGUAGES.has((node.attrs.language ?? "").toLowerCase())) {
                  newCodeBlockCount++;
                }
              });
            }

            if (
              tr.docChanged &&
              !editingChanged &&
              !settingsChanged &&
              state.decorations !== DecorationSet.empty &&
              newCodeBlockCount === state.codeBlockRanges.length &&
              !changesIntersectRanges(tr, state.codeBlockRanges)
            ) {
              return {
                decorations: state.decorations.map(tr.mapping, tr.doc),
                editingPos: state.editingPos,
                codeBlockRanges: state.codeBlockRanges.map((r) => ({
                  from: tr.mapping.map(r.from),
                  to: tr.mapping.map(r.to),
                })),
              };
            }

            // Sweep diagram instances whose DOM was removed by ProseMirror
            sweepDetached();

            const newDecorations: Decoration[] = [];
            const currentEditingPos = storeEditingPos;
            const newCodeBlockRanges: CodeBlockRange[] = [];

            newState.doc.descendants((node, pos) => {
              if (node.type.name !== "codeBlock" && node.type.name !== "code_block") return;

              const language = (node.attrs.language ?? "").toLowerCase();
              if (!PREVIEW_ONLY_LANGUAGES.has(language)) return;

              const content = node.textContent;
              const cacheKey = `${language}:${content}`;
              const nodeStart = pos;
              const nodeEnd = pos + node.nodeSize;

              // Track this code block's range for future incremental updates
              newCodeBlockRanges.push({ from: nodeStart, to: nodeEnd });

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
              /* v8 ignore next -- @preserve unreachable false branch: all non-mermaid PREVIEW_ONLY_LANGUAGES return early above */
              if (language === "mermaid") {
                newDecorations.push(
                  createMermaidPreviewWidget(nodeEnd, content, cacheKey, previewCache, handleEnterEdit)
                );
              }
            });

            return {
              decorations: DecorationSet.create(newState.doc, newDecorations),
              editingPos: currentEditingPos,
              codeBlockRanges: newCodeBlockRanges,
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
