/**
 * Markmap Preview Renderer
 *
 * Handles rendering of Markmap mindmap code block previews.
 * Extracted from tiptap.ts to keep files under ~300 lines.
 *
 * @coordinates-with tiptap.ts — main Extension.create() imports these renderers
 * @module plugins/codePreview/renderers/renderMarkmapPreview
 */

import type { EditorView } from "@tiptap/pm/view";
import { Decoration } from "@tiptap/pm/view";
import { renderMarkmapToElement } from "@/plugins/markmap";
import { setupMarkmapExport } from "@/plugins/markmap/markmapExport";
import { cleanupDescendants } from "@/plugins/shared/diagramCleanup";
import { installDoubleClickHandler } from "../previewHelpers";

/**
 * Update live preview for Markmap content.
 */
export async function updateMarkmapLivePreview(
  element: HTMLElement,
  content: string,
  currentToken: number,
  getToken: () => number,
): Promise<void> {
  // Clean up previous markmap instance before clearing
  cleanupDescendants(element);
  element.innerHTML = "";
  const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  element.appendChild(svgEl);
  const instance = await renderMarkmapToElement(svgEl, content);
  if (currentToken !== getToken()) {
    // Stale render — next render's cleanupDescendants will handle it
    return;
  }
  if (!instance) {
    element.innerHTML = '<div class="code-block-live-preview-error">Invalid markmap</div>';
  }
}

/**
 * Create a markmap preview with live interactive SVG.
 */
export function createMarkmapPreview(
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

/**
 * Create Markmap preview decoration widget.
 */
export function createMarkmapPreviewWidget(
  nodeEnd: number,
  content: string,
  cacheKey: string,
  handleEnterEdit: (view: EditorView | null | undefined) => void,
): Decoration {
  return Decoration.widget(
    nodeEnd,
    (view) => createMarkmapPreview(content, () => handleEnterEdit(view)),
    { side: 1, key: cacheKey }
  );
}
