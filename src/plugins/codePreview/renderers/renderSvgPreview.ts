/**
 * SVG Preview Renderer
 *
 * Handles rendering of SVG code block previews.
 * Extracted from tiptap.ts to keep files under ~300 lines.
 *
 * @coordinates-with tiptap.ts — main Extension.create() imports these renderers
 * @module plugins/codePreview/renderers/renderSvgPreview
 */

import type { EditorView } from "@tiptap/pm/view";
import { Decoration } from "@tiptap/pm/view";
import { renderSvgBlock } from "@/plugins/svg/svgRender";
import { sanitizeSvg } from "@/utils/sanitize";
import {
  installDoubleClickHandler,
  createPreviewElement,
  type PreviewCache,
} from "../previewHelpers";

/**
 * Update live preview for SVG content.
 */
export function updateSvgLivePreview(
  element: HTMLElement,
  content: string,
  currentToken: number,
  getToken: () => number,
): void {
  const rendered = renderSvgBlock(content);
  if (currentToken !== getToken()) return;
  if (rendered) {
    element.innerHTML = sanitizeSvg(rendered);
  } else {
    element.innerHTML = '<div class="code-block-live-preview-error">Invalid SVG</div>';
  }
}

/**
 * Create SVG preview decoration widget.
 */
export function createSvgPreviewWidget(
  nodeEnd: number,
  content: string,
  cacheKey: string,
  previewCache: PreviewCache,
  handleEnterEdit: (view: EditorView | null | undefined) => void,
): Decoration {
  const rendered = renderSvgBlock(content);

  if (rendered) {
    previewCache.set(cacheKey, { rendered });
    return Decoration.widget(
      nodeEnd,
      (view) => createPreviewElement("svg", rendered, () => handleEnterEdit(view), content),
      { side: 1, key: cacheKey }
    );
  }

  // Error case
  const errorWidget = document.createElement("div");
  errorWidget.className = "code-block-preview mermaid-error";
  errorWidget.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg> Invalid SVG`;

  return Decoration.widget(
    nodeEnd,
    (view) => {
      installDoubleClickHandler(errorWidget, () => handleEnterEdit(view));
      return errorWidget;
    },
    { side: 1, key: cacheKey }
  );
}
