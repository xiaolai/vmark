/**
 * Preview Helpers
 *
 * Shared utilities for code block preview rendering — element creation,
 * double-click handling, preview cache types, and theme utilities.
 *
 * Extracted from tiptap.ts to avoid circular dependencies between
 * renderers and the main extension file.
 *
 * @coordinates-with tiptap.ts — main Extension.create()
 * @coordinates-with renderers/ — per-language preview renderers
 * @module plugins/codePreview/previewHelpers
 */

import { setupMermaidPanZoom } from "@/plugins/mermaid/mermaidPanZoom";
import { setupMermaidExport } from "@/plugins/mermaid/mermaidExport";
import { setupSvgExport } from "@/plugins/svg/svgExport";
import { sanitizeKatex, sanitizeSvg } from "@/utils/sanitize";

// --- Types ---

export interface PreviewCacheEntry {
  rendered?: string;
  promise?: Promise<string>;
}

export type PreviewCache = Map<string, PreviewCacheEntry>;

export type UpdateLivePreviewFn = (
  element: HTMLElement,
  language: string,
  content: string,
) => void;

// --- Utility functions ---

/** Check if language is a latex/math language (handles both "latex" and "$$math$$" sentinel) */
export function isLatexLanguage(lang: string): boolean {
  return lang === "latex" || lang === "$$math$$";
}

/** Install double-click handler for entering edit mode */
export function installDoubleClickHandler(element: HTMLElement, onDoubleClick?: () => void): void {
  if (!onDoubleClick) return;
  element.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  element.addEventListener("dblclick", (event) => {
    event.preventDefault();
    onDoubleClick();
  });
}

/** Create a rendered preview element with sanitized content */
export function createPreviewElement(
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

/** Create a placeholder preview element */
export function createPreviewPlaceholder(
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

/** Create live preview element for edit mode */
export function createLivePreview(language: string): HTMLElement {
  const wrapper = document.createElement("div");
  const previewClass = isLatexLanguage(language) ? "latex"
    : language === "svg" ? "mermaid"
    : language === "markmap" ? "markmap" : language;
  wrapper.className = `code-block-live-preview ${previewClass}-live-preview`;
  wrapper.innerHTML = '<div class="code-block-live-preview-loading">Rendering...</div>';
  return wrapper;
}

/** Create edit mode header with title and cancel/save buttons */
export function createEditHeader(
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
