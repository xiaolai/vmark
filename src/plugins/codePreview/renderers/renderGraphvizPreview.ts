/**
 * Graphviz Preview Renderer
 *
 * Handles rendering of Graphviz (```dot / ```graphviz) code block previews.
 * Mirrors renderMermaidPreview.ts: async render with a loading placeholder,
 * shared pan-zoom, and a themed PNG export button.
 *
 * @coordinates-with tiptap.ts — main Extension.create() imports these renderers
 * @module plugins/codePreview/renderers/renderGraphvizPreview
 */

import type { EditorView } from "@tiptap/pm/view";
import { Decoration } from "@tiptap/pm/view";
import i18n from "@/i18n";
import { renderGraphviz } from "@/plugins/graphviz";
import { setupGraphvizExport } from "@/plugins/graphviz/graphvizExport";
import { setupMermaidPanZoom } from "@/plugins/mermaid/mermaidPanZoom";
import {
  readDiagramThemeTokens,
  serializeDiagramThemeTokens,
} from "@/plugins/shared/diagramThemeTokens";
import { sanitizeSvg } from "@/utils/sanitize";
import { diagramWarn } from "@/utils/debug";
import { installDoubleClickHandler, type PreviewCache } from "../previewHelpers";
import { errorMessage } from "@/utils/errorMessage";

/** Swap the placeholder into its error state (icon + translated message). */
function showRenderError(placeholder: HTMLElement): void {
  placeholder.className = "code-block-preview graphviz-error";
  placeholder.replaceChildren();
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("width", "16");
  icon.setAttribute("height", "16");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.innerHTML =
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>';
  placeholder.append(icon, ` ${i18n.t("editor:preview.renderFailed")}`);
}

/**
 * Update live preview for Graphviz content.
 */
export async function updateGraphvizLivePreview(
  element: HTMLElement,
  content: string,
  currentToken: number,
  getToken: () => number,
): Promise<void> {
  const svg = await renderGraphviz(content);
  if (currentToken !== getToken()) return;
  if (svg) {
    element.innerHTML = sanitizeSvg(svg);
  } else {
    element.replaceChildren(
      Object.assign(document.createElement("div"), {
        className: "code-block-live-preview-error",
        textContent: i18n.t("editor:preview.renderFailed"),
      }),
    );
  }
}

/**
 * Create Graphviz preview decoration (async rendering with placeholder).
 */
export function createGraphvizPreviewWidget(
  nodeEnd: number,
  content: string,
  cacheKey: string,
  previewCache: PreviewCache,
  handleEnterEdit: (view: EditorView | null | undefined) => void,
): Decoration {
  const placeholder = document.createElement("div");
  placeholder.className = "code-block-preview graphviz-preview graphviz-loading";
  placeholder.textContent = i18n.t("editor:preview.rendering");

  return Decoration.widget(
    nodeEnd,
    (view) => {
      installDoubleClickHandler(placeholder, () => handleEnterEdit(view));

      // Theme snapshot at render start: the SVG about to be produced is
      // themed with the CURRENT design tokens. If the tokens change while
      // the render is in flight, the theme observer has already cleared the
      // cache and scheduled a rebuild — caching or painting the stale-theme
      // output here would resurrect it.
      const themeKey = serializeDiagramThemeTokens(readDiagramThemeTokens());

      // Reuse a pending render for the same source (LaTeX renderer pattern)
      // so identical DOT blocks don't launch duplicate WASM renders.
      let promise = previewCache.get(cacheKey)?.promise;
      if (!promise) {
        promise = renderGraphviz(content).then((svg) => {
          if (!svg) throw new Error("Graphviz render produced no output");
          return svg;
        });
        previewCache.set(cacheKey, { promise });
      }

      promise
        .then((svg) => {
          if (serializeDiagramThemeTokens(readDiagramThemeTokens()) !== themeKey) {
            return; // stale theme — rebuilt widget re-renders with fresh tokens
          }
          previewCache.set(cacheKey, { rendered: svg });
          placeholder.className = "code-block-preview graphviz-preview";
          placeholder.innerHTML = sanitizeSvg(svg);
          setupMermaidPanZoom(placeholder);
          setupGraphvizExport(placeholder, content);
        })
        .catch((error: unknown) => {
          diagramWarn("Graphviz preview render failed:", errorMessage(error));
          previewCache.delete(cacheKey);
          showRenderError(placeholder);
        });
      return placeholder;
    },
    { side: 1, key: cacheKey },
  );
}
