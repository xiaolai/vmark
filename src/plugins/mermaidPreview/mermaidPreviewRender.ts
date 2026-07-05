/**
 * Mermaid Preview Renderer
 *
 * Dispatches diagram rendering for mermaid, markmap, and SVG blocks.
 * Manages render tokens to discard stale async results.
 */

import i18n from "@/i18n";
import { renderMermaid } from "@/plugins/mermaid";
import { renderGraphviz } from "@/plugins/graphviz";
import { renderMarkmapToElement } from "@/plugins/markmap";
import { cleanupDescendants } from "@/plugins/shared/diagramCleanup";
import { renderSvgBlock } from "@/plugins/svg/svgRender";
import { sanitizeSvg } from "@/utils/sanitize";
import { diagramWarn } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";

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

  // EVERY render request advances the token — including empty and synchronous
  // ones. Otherwise a pending async render still matches getCurrentToken()
  // and paints stale output over the newer empty/SVG state (audit finding).
  const currentToken = ++ctx.renderToken;

  if (!trimmed) {
    ctx.preview.innerHTML = "";
    ctx.preview.classList.add("mermaid-preview-empty");
    return currentToken;
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
      ctx.error.textContent = i18n.t("editor:preview.invalidSvg");
    }
    return currentToken;
  }

  // Markmap blocks: live SVG render
  if (ctx.currentLanguage === "markmap") {
    cleanupDescendants(ctx.preview);
    ctx.preview.innerHTML = "";
    const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEl.style.width = "100%";
    svgEl.style.height = "100%";
    ctx.preview.appendChild(svgEl);

    renderMarkmapToElement(svgEl, trimmed)
      .then((instance) => {
        if (currentToken !== ctx.getCurrentToken()) return;
        if (!instance) {
          ctx.preview.innerHTML = "";
          ctx.preview.classList.add("mermaid-preview-error-state");
          ctx.error.textContent = i18n.t("editor:preview.invalidMarkmapSyntax");
        } else {
          ctx.error.textContent = "";
        }
      })
      .catch((error: unknown) => {
        if (currentToken !== ctx.getCurrentToken()) return;
        diagramWarn("Markmap render failed:", errorMessage(error));
        ctx.preview.innerHTML = "";
        ctx.preview.classList.add("mermaid-preview-error-state");
        ctx.error.textContent = i18n.t("editor:preview.renderFailed");
      });
    return currentToken;
  }

  // Graphviz (dot) blocks: async render with loading state
  if (ctx.currentLanguage === "dot" || ctx.currentLanguage === "graphviz") {
    ctx.preview.innerHTML = '<div class="mermaid-preview-loading"></div>';
    ctx.preview.firstElementChild!.textContent = i18n.t("editor:preview.rendering");

    renderGraphviz(trimmed)
      .then((svg) => {
        if (currentToken !== ctx.getCurrentToken()) return;
        if (svg) {
          ctx.preview.innerHTML = sanitizeSvg(svg);
          ctx.error.textContent = "";
          ctx.applyZoom();
        } else {
          ctx.preview.innerHTML = "";
          ctx.preview.classList.add("mermaid-preview-error-state");
          ctx.error.textContent = i18n.t("editor:preview.renderFailed");
        }
      })
      .catch((error: unknown) => {
        if (currentToken !== ctx.getCurrentToken()) return;
        diagramWarn("Graphviz render failed:", errorMessage(error));
        ctx.preview.innerHTML = "";
        ctx.preview.classList.add("mermaid-preview-error-state");
        ctx.error.textContent = i18n.t("editor:preview.renderFailed");
      });
    return currentToken;
  }

  // Mermaid blocks: async render with loading state
  ctx.preview.innerHTML = '<div class="mermaid-preview-loading"></div>';
  ctx.preview.firstElementChild!.textContent = i18n.t("editor:preview.rendering");

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
        ctx.error.textContent = i18n.t("editor:preview.invalidMermaidSyntax");
      }
    })
    .catch((error: unknown) => {
      if (currentToken !== ctx.getCurrentToken()) return;
      diagramWarn("Mermaid render failed:", errorMessage(error));
      ctx.preview.innerHTML = "";
      ctx.preview.classList.add("mermaid-preview-error-state");
      ctx.error.textContent = i18n.t("editor:preview.renderFailed");
    });
  return currentToken;
}
