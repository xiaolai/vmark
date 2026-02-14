/**
 * Code Preview Tiptap Extension
 *
 * Purpose: Renders live previews below code blocks for special languages (LaTeX/math,
 * Mermaid diagrams, Markmap mindmaps, SVG) in WYSIWYG mode. Also handles click-to-edit
 * for block math ($$...$$ code blocks).
 *
 * Pipeline: code_block node → detect language → render preview widget decoration
 *         → debounced re-render on content change → click to edit → Cmd+Enter to commit
 *
 * Key decisions:
 *   - Previews are ProseMirror widget decorations (not node views) to avoid complicating
 *     the document schema
 *   - Preview rendering is debounced (200ms) to avoid re-rendering on every keystroke
 *   - Each preview type has its own renderer (renderLatex, renderMermaid, etc.)
 *   - Block math uses a special "$$math$$" sentinel language to distinguish from regular latex
 *   - Export buttons (copy SVG, download PNG) are injected into diagram previews
 *
 * Known limitations:
 *   - Module-level `currentEditorView` is used for button callbacks (not ideal for multi-editor)
 *
 * @coordinates-with blockMathKeymap.ts — keyboard shortcuts for math editing
 * @coordinates-with latex/ — KaTeX rendering
 * @coordinates-with mermaid/ — Mermaid diagram rendering
 * @coordinates-with markmap/ — Markmap mindmap rendering
 * @coordinates-with svg/ — SVG block rendering
 * @module plugins/codePreview/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { renderLatex } from "../latex";
import { renderMermaid, updateMermaidTheme } from "../mermaid";
import { setupMermaidPanZoom } from "@/plugins/mermaid/mermaidPanZoom";
import { setupMermaidExport } from "@/plugins/mermaid/mermaidExport";
import { renderSvgBlock } from "@/plugins/svg/svgRender";
import { setupSvgExport } from "@/plugins/svg/svgExport";
import { renderMarkmapToElement, updateMarkmapTheme } from "@/plugins/markmap";
import { setupMarkmapExport } from "@/plugins/markmap/markmapExport";
import { sweepDetached, cleanupDescendants } from "@/plugins/shared/diagramCleanup";
import { sanitizeKatex, sanitizeSvg } from "@/utils/sanitize";
import { useBlockMathEditingStore } from "@/stores/blockMathEditingStore";
import { parseLatexError } from "@/plugins/latex/latexErrorParser";

const codePreviewPluginKey = new PluginKey("codePreview");
const PREVIEW_ONLY_LANGUAGES = new Set(["latex", "mermaid", "markmap", "svg", "$$math$$"]);
const DEBOUNCE_MS = 200;

// Store current editor view for button callbacks
let currentEditorView: EditorView | null = null;

/** Check if language is a latex/math language (handles both "latex" and "$$math$$" sentinel) */
function isLatexLanguage(lang: string): boolean {
  return lang === "latex" || lang === "$$math$$";
}

interface PreviewCacheEntry {
  rendered?: string;
  promise?: Promise<string>;
}
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
        });
        updateMarkmapTheme(isDark);
      }
    }
  });

  observer.observe(document.documentElement, { attributes: true });
}

setupThemeObserver();

/** Install double-click handler for entering edit mode */
function installDoubleClickHandler(element: HTMLElement, onDoubleClick?: () => void): void {
  if (!onDoubleClick) return;
  element.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  element.addEventListener("dblclick", (event) => {
    event.preventDefault();
    onDoubleClick();
  });
}

function createPreviewElement(
  language: string,
  rendered: string,
  onDoubleClick?: () => void,
  sourceContent?: string,
): HTMLElement {
  const wrapper = document.createElement("div");
  // Use "latex" class for both "latex" and "$$math$$" languages
  // Use "mermaid" class for SVG too (reuses same pan+zoom styles)
  const previewClass = isLatexLanguage(language) ? "latex"
    : language === "svg" ? "mermaid" : language;
  wrapper.className = `code-block-preview ${previewClass}-preview`;
  const sanitized = (language === "mermaid" || language === "svg")
    ? sanitizeSvg(rendered) : sanitizeKatex(rendered);
  wrapper.innerHTML = sanitized;
  if (language === "mermaid" || language === "svg") {
    // Defer panzoom/export setup — Panzoom requires DOM-attached elements,
    // but ProseMirror attaches the widget after the factory returns.
    // Panzoom and export auto-register cleanup via diagramCleanup
    requestAnimationFrame(() => {
      setupMermaidPanZoom(wrapper);
      if (sourceContent) {
        if (language === "mermaid") {
          setupMermaidExport(wrapper, sourceContent);
        } else {
          setupSvgExport(wrapper, sourceContent);
        }
      }
    });
  }
  installDoubleClickHandler(wrapper, onDoubleClick);
  return wrapper;
}

/** Create a markmap preview with live interactive SVG */
function createMarkmapPreview(
  content: string,
  onDoubleClick?: () => void,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "code-block-preview markmap-preview";

  const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  wrapper.appendChild(svgEl);

  // Defer rendering until DOM-attached
  requestAnimationFrame(() => {
    if (!svgEl.isConnected) return; // Widget already removed
    renderMarkmapToElement(svgEl, content).then((instance) => {
      if (!instance) return;

      // Add fit button
      const fitBtn = document.createElement("button");
      fitBtn.className = "markmap-fit-btn";
      fitBtn.title = "Fit to view";
      fitBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
      fitBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      fitBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        instance.fit();
      });
      wrapper.appendChild(fitBtn);

      // Export auto-registers cleanup via diagramCleanup
      setupMarkmapExport(wrapper, content);
    });
  });

  installDoubleClickHandler(wrapper, onDoubleClick);
  return wrapper;
}

function createPreviewPlaceholder(
  language: string,
  label: string,
  onDoubleClick?: () => void
): HTMLElement {
  const wrapper = document.createElement("div");
  // Use "latex" class for both "latex" and "$$math$$" languages
  const previewClass = isLatexLanguage(language) ? "latex" : language;
  wrapper.className = `code-block-preview ${previewClass}-preview code-block-preview-placeholder`;
  wrapper.textContent = label;
  installDoubleClickHandler(wrapper, onDoubleClick);
  return wrapper;
}

/** Create edit mode header with title and cancel/save buttons */
function createEditHeader(
  language: string,
  onCancel: () => void,
  onSave: () => void,
  onCopy?: () => void,
): HTMLElement {
  const header = document.createElement("div");
  header.className = "code-block-edit-header";

  const title = document.createElement("span");
  title.className = "code-block-edit-title";
  title.textContent = language === "mermaid" ? "Mermaid"
    : language === "markmap" ? "Markmap"
    : language === "svg" ? "SVG" : "LaTeX";

  const actions = document.createElement("div");
  actions.className = "code-block-edit-actions";

  // Copy button (mermaid only — passed via onCopy)
  if (onCopy) {
    const copyBtn = document.createElement("button");
    copyBtn.className = "code-block-edit-btn code-block-edit-copy";
    copyBtn.title = "Copy source code";
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    copyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onCopy();
      // Brief checkmark feedback
      copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      copyBtn.classList.add("code-block-edit-btn--success");
      setTimeout(() => {
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        copyBtn.classList.remove("code-block-edit-btn--success");
      }, 1500);
    });
    actions.appendChild(copyBtn);
  }

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "code-block-edit-btn code-block-edit-cancel";
  cancelBtn.title = "Cancel (Esc)";
  cancelBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  // Prevent ProseMirror from capturing mousedown
  cancelBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  cancelBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  });

  const saveBtn = document.createElement("button");
  saveBtn.className = "code-block-edit-btn code-block-edit-save";
  saveBtn.title = "Save";
  saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  // Prevent ProseMirror from capturing mousedown
  saveBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  saveBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onSave();
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  header.appendChild(title);
  header.appendChild(actions);

  return header;
}

/** Create live preview element for edit mode */
function createLivePreview(language: string): HTMLElement {
  const wrapper = document.createElement("div");
  const previewClass = isLatexLanguage(language) ? "latex"
    : language === "svg" ? "mermaid"
    : language === "markmap" ? "markmap" : language;
  wrapper.className = `code-block-live-preview ${previewClass}-live-preview`;
  wrapper.innerHTML = '<div class="code-block-live-preview-loading">Rendering...</div>';
  return wrapper;
}

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

  livePreviewTimeout = setTimeout(async () => {
    if (currentToken !== livePreviewToken) return;

    const trimmed = content.trim();
    if (!trimmed) {
      element.innerHTML = '<div class="code-block-live-preview-empty">Empty</div>';
      return;
    }

    if (isLatexLanguage(language)) {
      try {
        const rendered = await renderLatex(trimmed);
        if (currentToken !== livePreviewToken) return;
        element.innerHTML = sanitizeKatex(rendered);
      } catch (e) {
        if (currentToken !== livePreviewToken) return;
        const { message, hint } = parseLatexError(e, trimmed);
        const errorText = hint ? `${message}: ${hint}` : message;
        const errorDiv = document.createElement("div");
        errorDiv.className = "code-block-live-preview-error";
        errorDiv.textContent = errorText;
        element.replaceChildren(errorDiv);
      }
    } else if (language === "mermaid") {
      const svg = await renderMermaid(trimmed);
      if (currentToken !== livePreviewToken) return;
      if (svg) {
        element.innerHTML = sanitizeSvg(svg);
      } else {
        element.innerHTML = '<div class="code-block-live-preview-error">Invalid syntax</div>';
      }
    } else if (language === "markmap") {
      // Clean up previous markmap instance before clearing
      cleanupDescendants(element);
      element.innerHTML = "";
      const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      element.appendChild(svgEl);
      const instance = await renderMarkmapToElement(svgEl, trimmed);
      if (currentToken !== livePreviewToken) {
        // Stale render — next render's cleanupDescendants will handle it
        return;
      }
      if (!instance) {
        element.innerHTML = '<div class="code-block-live-preview-error">Invalid markmap</div>';
      }
    } else if (language === "svg") {
      const rendered = renderSvgBlock(trimmed);
      if (currentToken !== livePreviewToken) return;
      if (rendered) {
        element.innerHTML = sanitizeSvg(rendered);
      } else {
        element.innerHTML = '<div class="code-block-live-preview-error">Invalid SVG</div>';
      }
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

              // Markmap renders to live DOM — skip cache, always create fresh
              if (language === "markmap") {
                const widget = Decoration.widget(
                  nodeEnd,
                  (view) => createMarkmapPreview(content, () => handleEnterEdit(view)),
                  { side: 1, key: cacheKey }
                );
                newDecorations.push(widget);
                return;
              }

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

              if (isLatexLanguage(language)) {
                const placeholder = document.createElement("div");
                placeholder.className = "code-block-preview latex-preview code-block-preview-placeholder";
                placeholder.textContent = "Rendering math...";

                const widget = Decoration.widget(
                  nodeEnd,
                  (view) => {
                    installDoubleClickHandler(placeholder, () => handleEnterEdit(view));

                    const entry = previewCache.get(cacheKey);
                    let promise = entry?.promise;
                    if (!promise) {
                      promise = Promise.resolve(renderLatex(content));
                      previewCache.set(cacheKey, { promise });
                    }

                    promise
                      .then((rendered) => {
                        previewCache.set(cacheKey, { rendered });
                        placeholder.className = "code-block-preview latex-preview";
                        placeholder.innerHTML = sanitizeKatex(rendered);
                      })
                      .catch(() => {
                        previewCache.delete(cacheKey);
                        placeholder.className = "code-block-preview latex-preview mermaid-error";
                        placeholder.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg> Failed to render math`;
                      });

                    return placeholder;
                  },
                  { side: 1, key: cacheKey }
                );

                newDecorations.push(widget);
                return;
              }

              if (language === "svg") {
                const rendered = renderSvgBlock(content);
                if (rendered) {
                  previewCache.set(cacheKey, { rendered });
                  const widget = Decoration.widget(
                    nodeEnd,
                    (view) => createPreviewElement(language, rendered, () => handleEnterEdit(view), content),
                    { side: 1, key: cacheKey }
                  );
                  newDecorations.push(widget);
                } else {
                  const errorWidget = document.createElement("div");
                  errorWidget.className = "code-block-preview mermaid-error";
                  errorWidget.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg> Invalid SVG`;
                  const widget = Decoration.widget(
                    nodeEnd,
                    (view) => {
                      installDoubleClickHandler(errorWidget, () => handleEnterEdit(view));
                      return errorWidget;
                    },
                    { side: 1, key: cacheKey }
                  );
                  newDecorations.push(widget);
                }
              } else if (language === "mermaid") {
                const placeholder = document.createElement("div");
                placeholder.className = "code-block-preview mermaid-preview mermaid-loading";
                placeholder.textContent = "Rendering diagram...";

                const widget = Decoration.widget(
                  nodeEnd,
                  (view) => {
                    installDoubleClickHandler(placeholder, () => handleEnterEdit(view));
                    renderMermaid(content).then((svg) => {
                      if (svg) {
                        previewCache.set(cacheKey, { rendered: svg });
                        placeholder.className = "code-block-preview mermaid-preview";
                        placeholder.innerHTML = sanitizeSvg(svg);
                        setupMermaidPanZoom(placeholder);
                        setupMermaidExport(placeholder, content);
                      } else {
                        placeholder.className = "code-block-preview mermaid-error";
                        placeholder.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg> Failed to render diagram`;
                      }
                    });
                    return placeholder;
                  },
                  { side: 1, key: cacheKey }
                );
                newDecorations.push(widget);
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
