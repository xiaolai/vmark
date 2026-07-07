/**
 * Preview Helpers
 *
 * Shared utilities for code block preview rendering — element creation,
 * language → preview-class routing (getPreviewClass), clipboard copy,
 * double-click handling, and preview cache types.
 *
 * Extracted from tiptap.ts to avoid circular dependencies between
 * renderers and the main extension file.
 *
 * @coordinates-with tiptap.ts — main Extension.create()
 * @coordinates-with renderers/ — per-language preview renderers
 * @module plugins/codePreview/previewHelpers
 */

import i18n from "@/i18n";
import { setupMermaidPanZoom } from "@/plugins/mermaid/mermaidPanZoom";
import { setupMermaidExport } from "@/plugins/mermaid/mermaidExport";
import { setupSvgExport } from "@/plugins/svg/svgExport";
import { isGraphvizLanguage } from "@/plugins/graphviz";
import { setupGraphvizExport } from "@/plugins/graphviz/graphvizExport";
import { sanitizeKatex, sanitizeSvg } from "@/utils/sanitize";
import { diagramWarn } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";

// --- Types ---

export interface PreviewCacheEntry {
  rendered?: string;
  promise?: Promise<string>;
}

export type PreviewCache = Map<string, PreviewCacheEntry>;

// --- Utility functions ---

/** Check if language is a latex/math language (handles both "latex" and "$$math$$" sentinel) */
export function isLatexLanguage(lang: string): boolean {
  return lang === "latex" || lang === "$$math$$";
}

/** Widget flavor for getPreviewClass — rendered output, empty placeholder, or live edit preview. */
export type PreviewMode = "rendered" | "placeholder" | "live";

/**
 * Single source of truth for the language → CSS-class routing shared by
 * createPreviewElement / createPreviewPlaceholder / createLivePreview.
 * The per-mode divergences are intentional:
 *   - latex / $$math$$ → "latex" in every mode;
 *   - dot / graphviz   → "graphviz" in every mode;
 *   - svg              → "mermaid" for rendered/live output (reuses Mermaid's
 *                        pan/zoom + sizing CSS), but the placeholder is a
 *                        plain text label, so it keeps its own "svg" class;
 *   - yaml / yml       → "workflow" ONLY for rendered output (the cache-hit
 *                        rendering is a workflow SVG that needs
 *                        .workflow-preview sizing); placeholder and live
 *                        previews keep the raw language class.
 */
export function getPreviewClass(language: string, mode: PreviewMode): string {
  if (isLatexLanguage(language)) return "latex";
  if (isGraphvizLanguage(language)) return "graphviz";
  if (language === "svg") return mode === "placeholder" ? "svg" : "mermaid";
  if ((language === "yaml" || language === "yml") && mode === "rendered") {
    return "workflow";
  }
  return language;
}

/**
 * Copy text to the system clipboard. Resolves true on success, false when the
 * Clipboard API is unavailable or the write fails — never rejects, so callers
 * can branch feedback on the boolean without a try/catch.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard?.writeText) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch (error) {
    diagramWarn("Copy to clipboard failed:", errorMessage(error));
    return false;
  }
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
  // Class routing lives in getPreviewClass; sanitizer dispatch:
  //   - SVG-producing languages (mermaid, svg, dot/graphviz, yaml/yml
  //     workflow snapshots) → sanitizeSvg
  //   - latex / $$math$$ → sanitizeKatex (sanitizeSvg would strip KaTeX HTML)
  const isWorkflowYamlLang = language === "yaml" || language === "yml";
  const isGraphviz = isGraphvizLanguage(language);
  wrapper.className = `code-block-preview ${getPreviewClass(language, "rendered")}-preview`;
  const isSvgOutput =
    language === "mermaid" || language === "svg" || isGraphviz || isWorkflowYamlLang;
  const sanitized = isSvgOutput ? sanitizeSvg(rendered) : sanitizeKatex(rendered);
  wrapper.innerHTML = sanitized;
  if (language === "mermaid" || language === "svg" || isGraphviz) {
    // Defer panzoom/export setup — Panzoom requires DOM-attached elements,
    // but ProseMirror attaches the widget after the factory returns.
    // Panzoom and export auto-register cleanup via diagramCleanup
    requestAnimationFrame(() => {
      setupMermaidPanZoom(wrapper);
      if (sourceContent) {
        if (language === "mermaid") {
          setupMermaidExport(wrapper, sourceContent);
        } else if (isGraphviz) {
          setupGraphvizExport(wrapper, sourceContent);
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
  const previewClass = getPreviewClass(language, "placeholder");
  wrapper.className = `code-block-preview ${previewClass}-preview code-block-preview-placeholder`;
  wrapper.textContent = label;
  installDoubleClickHandler(wrapper, onDoubleClick);
  return wrapper;
}

/** Create live preview element for edit mode */
export function createLivePreview(language: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = `code-block-live-preview ${getPreviewClass(language, "live")}-live-preview`;
  const loading = document.createElement("div");
  loading.className = "code-block-live-preview-loading";
  loading.textContent = i18n.t("editor:preview.rendering");
  wrapper.replaceChildren(loading);
  return wrapper;
}

const COPY_ICON =
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_ICON =
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const CROSS_ICON =
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

/** Create edit mode header with title and cancel/save buttons */
export function createEditHeader(
  language: string,
  onCancel: () => void,
  onSave: () => void,
  onCopy?: () => Promise<boolean>,
): HTMLElement {
  const header = document.createElement("div");
  header.className = "code-block-edit-header";

  const title = document.createElement("span");
  title.className = "code-block-edit-title";
  title.textContent = language === "mermaid" ? "Mermaid"
    : language === "markmap" ? "Markmap"
    : isGraphvizLanguage(language) ? "Graphviz"
    : language === "svg" ? "SVG" : "LaTeX";

  const actions = document.createElement("div");
  actions.className = "code-block-edit-actions";

  // Copy button (diagram languages only — passed via onCopy)
  if (onCopy) {
    const copyBtn = document.createElement("button");
    copyBtn.className = "code-block-edit-btn code-block-edit-copy";
    const copyLabel = i18n.t("editor:plugin.copySource");
    copyBtn.title = copyLabel;
    copyBtn.setAttribute("aria-label", copyLabel);
    copyBtn.innerHTML = COPY_ICON;
    copyBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    const showCopyFeedback = (icon: string, className: string) => {
      copyBtn.innerHTML = icon;
      copyBtn.classList.add(className);
      setTimeout(() => {
        copyBtn.innerHTML = COPY_ICON;
        copyBtn.classList.remove(className);
      }, 1500);
    };
    copyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Feedback only after the clipboard write settles — a synchronous
      // checkmark would report success even when the write failed.
      void (async () => {
        let copied = false;
        try {
          copied = await onCopy();
        } catch (error) {
          diagramWarn("Copy source failed:", errorMessage(error));
        }
        if (copied) {
          showCopyFeedback(CHECK_ICON, "code-block-edit-btn--success");
        } else {
          showCopyFeedback(CROSS_ICON, "code-block-edit-btn--error");
        }
      })();
    });
    actions.appendChild(copyBtn);
  }

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "code-block-edit-btn code-block-edit-cancel";
  const cancelLabel = i18n.t("editor:plugin.cancel");
  cancelBtn.title = cancelLabel;
  cancelBtn.setAttribute("aria-label", cancelLabel);
  cancelBtn.innerHTML = CROSS_ICON;
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
  const saveLabel = i18n.t("editor:plugin.save");
  saveBtn.title = saveLabel;
  saveBtn.setAttribute("aria-label", saveLabel);
  saveBtn.innerHTML = CHECK_ICON;
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
