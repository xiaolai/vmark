/**
 * Mermaid Preview Renderer
 *
 * Dispatches diagram rendering for mermaid, markmap, and SVG blocks.
 * Manages render tokens to discard stale async results.
 */

import { renderMermaid } from "@/plugins/mermaid";
import { renderMarkmapToElement } from "@/plugins/markmap";
import { cleanupDescendants } from "@/plugins/shared/diagramCleanup";
import { renderSvgBlock } from "@/plugins/svg/svgRender";
import { sanitizeSvg } from "@/utils/sanitize";
import { diagramWarn } from "@/utils/debug";

export interface RenderContext {
  preview: HTMLElement;
  error: HTMLElement;
  currentLanguage: string;
  renderToken: number;
  /** Returns the live render token from the owner, for async staleness checks. */
  getCurrentToken: () => number;
  applyZoom: () => void;
}

/**
 * Render diagram content into the preview element.
 * Returns the updated renderToken so the caller can track it.
 */
export function renderPreview(content: string, ctx: RenderContext): number {
  const trimmed = content.trim();
  ctx.error.textContent = "";
  ctx.preview.classList.remove("mermaid-preview-error-state");

  if (!trimmed) {
    ctx.preview.innerHTML = "";
    ctx.preview.classList.add("mermaid-preview-empty");
    return ctx.renderToken;
  }

  ctx.preview.classList.remove("mermaid-preview-empty");

  // SVG blocks: synchronous render, no loading state
  if (ctx.currentLanguage === "svg") {
    const rendered = renderSvgBlock(trimmed);
    if (rendered) {
      ctx.preview.innerHTML = sanitizeSvg(rendered);
      ctx.error.textContent = "";
      ctx.applyZoom();
    } else {
      ctx.preview.innerHTML = "";
      ctx.preview.classList.add("mermaid-preview-error-state");
      ctx.error.textContent = "Invalid SVG";
    }
    return ctx.renderToken;
  }

  // Markmap blocks: live SVG render
  if (ctx.currentLanguage === "markmap") {
    cleanupDescendants(ctx.preview);
    ctx.preview.innerHTML = "";
    const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEl.style.width = "100%";
    svgEl.style.height = "100%";
    ctx.preview.appendChild(svgEl);

    const currentToken = ++ctx.renderToken;
    renderMarkmapToElement(svgEl, trimmed)
      .then((instance) => {
        if (currentToken !== ctx.getCurrentToken()) return;
        if (!instance) {
          ctx.preview.innerHTML = "";
          ctx.preview.classList.add("mermaid-preview-error-state");
          ctx.error.textContent = "Invalid markmap syntax";
        } else {
          ctx.error.textContent = "";
        }
      })
      .catch((error: unknown) => {
        if (currentToken !== ctx.getCurrentToken()) return;
        diagramWarn("Markmap render failed:", error instanceof Error ? error.message : String(error));
        ctx.preview.innerHTML = "";
        ctx.preview.classList.add("mermaid-preview-error-state");
        ctx.error.textContent = "Preview failed";
      });
    return currentToken;
  }

  // Mermaid blocks: async render with loading state
  const currentToken = ++ctx.renderToken;
  ctx.preview.innerHTML = '<div class="mermaid-preview-loading">Rendering...</div>';

  renderMermaid(trimmed)
    .then((svg) => {
      if (currentToken !== ctx.getCurrentToken()) return;

      if (svg) {
        ctx.preview.innerHTML = sanitizeSvg(svg);
        ctx.error.textContent = "";
        ctx.applyZoom();
      } else {
        ctx.preview.innerHTML = "";
        ctx.preview.classList.add("mermaid-preview-error-state");
        ctx.error.textContent = "Invalid mermaid syntax";
      }
    })
    .catch((error: unknown) => {
      if (currentToken !== ctx.getCurrentToken()) return;
      diagramWarn("Mermaid render failed:", error instanceof Error ? error.message : String(error));
      ctx.preview.innerHTML = "";
      ctx.preview.classList.add("mermaid-preview-error-state");
      ctx.error.textContent = "Preview failed";
    });
  return currentToken;
}
