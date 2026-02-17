/**
 * LaTeX Preview Renderer
 *
 * Handles rendering of LaTeX/math code block previews, both static and live.
 * Extracted from tiptap.ts to keep files under ~300 lines.
 *
 * @coordinates-with tiptap.ts — main Extension.create() imports these renderers
 * @module plugins/codePreview/renderers/renderLatex
 */

import type { EditorView } from "@tiptap/pm/view";
import { Decoration } from "@tiptap/pm/view";
import { renderLatex } from "../../latex";
import { sanitizeKatex } from "@/utils/sanitize";
import { parseLatexError } from "@/plugins/latex/latexErrorParser";
import {
  installDoubleClickHandler,
  type PreviewCache,
} from "../previewHelpers";

/**
 * Update live preview for LaTeX content.
 */
export function updateLatexLivePreview(
  element: HTMLElement,
  content: string,
  currentToken: number,
  getToken: () => number,
): void {
  renderLatex(content)
    .then((rendered) => {
      if (currentToken !== getToken()) return;
      element.innerHTML = sanitizeKatex(rendered);
    })
    .catch((e) => {
      if (currentToken !== getToken()) return;
      const { message, hint } = parseLatexError(e, content);
      const errorText = hint ? `${message}: ${hint}` : message;
      const errorDiv = document.createElement("div");
      errorDiv.className = "code-block-live-preview-error";
      errorDiv.textContent = errorText;
      element.replaceChildren(errorDiv);
    });
}

/**
 * Create LaTeX preview decoration (async rendering with placeholder).
 */
export function createLatexPreviewWidget(
  nodeEnd: number,
  content: string,
  cacheKey: string,
  previewCache: PreviewCache,
  handleEnterEdit: (view: EditorView | null | undefined) => void,
): Decoration {
  const placeholder = document.createElement("div");
  placeholder.className = "code-block-preview latex-preview code-block-preview-placeholder";
  placeholder.textContent = "Rendering math...";

  return Decoration.widget(
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
}
