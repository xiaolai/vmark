/**
 * Mermaid Preview Renderer
 *
 * Handles rendering of Mermaid diagram code block previews.
 * Extracted from tiptap.ts to keep files under ~300 lines.
 *
 * @coordinates-with tiptap.ts — main Extension.create() imports these renderers
 * @module plugins/codePreview/renderers/renderMermaidPreview
 */

import type { EditorView } from "@tiptap/pm/view";
import { Decoration } from "@tiptap/pm/view";
import { renderMermaid } from "../../mermaid";
import { setupMermaidPanZoom } from "@/plugins/mermaid/mermaidPanZoom";
import { setupMermaidExport } from "@/plugins/mermaid/mermaidExport";
import { sanitizeSvg } from "@/utils/sanitize";
import { installDoubleClickHandler, type PreviewCache } from "../previewHelpers";

/**
 * Update live preview for Mermaid content.
 */
export async function updateMermaidLivePreview(
  element: HTMLElement,
  content: string,
  currentToken: number,
  getToken: () => number,
): Promise<void> {
  const svg = await renderMermaid(content);
  if (currentToken !== getToken()) return;
  if (svg) {
    element.innerHTML = sanitizeSvg(svg);
  } else {
    element.innerHTML = '<div class="code-block-live-preview-error">Invalid syntax</div>';
  }
}

/**
 * Create Mermaid preview decoration (async rendering with placeholder).
 */
export function createMermaidPreviewWidget(
  nodeEnd: number,
  content: string,
  cacheKey: string,
  previewCache: PreviewCache,
  handleEnterEdit: (view: EditorView | null | undefined) => void,
): Decoration {
  const placeholder = document.createElement("div");
  placeholder.className = "code-block-preview mermaid-preview mermaid-loading";
  placeholder.textContent = "Rendering diagram...";

  return Decoration.widget(
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
}
