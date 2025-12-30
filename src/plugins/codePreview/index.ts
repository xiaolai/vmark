/**
 * Code Block Preview Plugin
 *
 * Extends code blocks to render previews for special languages:
 * - latex: Renders math using KaTeX
 * - mermaid: Renders diagrams using Mermaid
 */

import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { renderLatex } from "../latex";
import { renderMermaid, updateMermaidTheme } from "../mermaid";
import { sanitizeKatex, sanitizeSvg } from "@/utils/sanitize";

export const codePreviewPluginKey = new PluginKey("codePreview");

// Cache for rendered content to avoid re-rendering
const renderCache = new Map<string, string>();

// Track if theme observer is set up
let themeObserverSetup = false;

/**
 * Set up a MutationObserver to watch for theme changes.
 * When theme changes, clear cache so diagrams re-render with new theme.
 */
function setupThemeObserver() {
  if (themeObserverSetup || typeof window === "undefined") return;
  themeObserverSetup = true;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.attributeName === "class") {
        const isDark = document.documentElement.classList.contains("dark");
        const themeChanged = updateMermaidTheme(isDark);
        if (themeChanged) {
          // Clear cache so mermaid diagrams re-render with new theme
          renderCache.clear();
        }
      }
    }
  });

  observer.observe(document.documentElement, { attributes: true });
}

// Set up observer when module loads
setupThemeObserver();

/**
 * Create a preview element for a code block.
 */
function createPreviewElement(
  language: string,
  rendered: string
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = `code-block-preview ${language}-preview`;
  // Sanitize HTML based on content type
  const sanitized =
    language === "mermaid" ? sanitizeSvg(rendered) : sanitizeKatex(rendered);
  wrapper.innerHTML = sanitized;
  return wrapper;
}

/**
 * Plugin that adds preview decorations for latex and mermaid code blocks.
 */
export const codePreviewPlugin = $prose(() => {
  return new Plugin({
    key: codePreviewPluginKey,
    state: {
      init() {
        return DecorationSet.empty;
      },
      apply(tr, decorations, _oldState, newState) {
        // Only update if document changed
        if (!tr.docChanged && decorations !== DecorationSet.empty) {
          return decorations.map(tr.mapping, tr.doc);
        }

        const newDecorations: Decoration[] = [];

        newState.doc.descendants((node, pos) => {
          if (node.type.name !== "code_block") return;

          const language = (node.attrs.language ?? "").toLowerCase();
          if (language !== "latex" && language !== "mermaid") return;

          const content = node.textContent;
          if (!content.trim()) return;

          const cacheKey = `${language}:${content}`;

          // Check cache first
          if (renderCache.has(cacheKey)) {
            const rendered = renderCache.get(cacheKey)!;
            const widget = Decoration.widget(
              pos + node.nodeSize,
              () => createPreviewElement(language, rendered),
              { side: 1, key: cacheKey }
            );
            newDecorations.push(widget);
            return;
          }

          // For LaTeX, render synchronously
          if (language === "latex") {
            const rendered = renderLatex(content);
            renderCache.set(cacheKey, rendered);
            const widget = Decoration.widget(
              pos + node.nodeSize,
              () => createPreviewElement(language, rendered),
              { side: 1, key: cacheKey }
            );
            newDecorations.push(widget);
            return;
          }

          // For Mermaid, show loading and render async
          if (language === "mermaid") {
            // Create a placeholder that will be updated
            const placeholder = document.createElement("div");
            placeholder.className = "code-block-preview mermaid-preview mermaid-loading";
            placeholder.textContent = "Rendering diagram...";

            const widget = Decoration.widget(
              pos + node.nodeSize,
              () => {
                // Async render
                renderMermaid(content).then((svg) => {
                  if (svg) {
                    renderCache.set(cacheKey, svg);
                    placeholder.className = "code-block-preview mermaid-preview";
                    placeholder.innerHTML = sanitizeSvg(svg);
                  } else {
                    placeholder.className = "code-block-preview mermaid-error";
                    placeholder.textContent = "Failed to render diagram";
                  }
                });
                return placeholder;
              },
              { side: 1, key: cacheKey }
            );
            newDecorations.push(widget);
          }
        });

        return DecorationSet.create(newState.doc, newDecorations);
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
});

/**
 * Clear the render cache (useful when settings change).
 */
export function clearPreviewCache() {
  renderCache.clear();
}
