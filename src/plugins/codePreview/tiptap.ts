import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { renderLatex } from "../latex";
import { renderMermaid, updateMermaidTheme } from "../mermaid";
import { sanitizeKatex, sanitizeSvg } from "@/utils/sanitize";

const codePreviewPluginKey = new PluginKey("codePreview");
const PREVIEW_ONLY_LANGUAGES = new Set(["latex", "mermaid"]);

const renderCache = new Map<string, string>();

let themeObserverSetup = false;

function setupThemeObserver() {
  if (themeObserverSetup || typeof window === "undefined") return;
  themeObserverSetup = true;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.attributeName === "class") {
        const isDark = document.documentElement.classList.contains("dark");
        updateMermaidTheme(isDark).then((themeChanged) => {
          if (themeChanged) {
            renderCache.clear();
          }
        });
      }
    }
  });

  observer.observe(document.documentElement, { attributes: true });
}

setupThemeObserver();

function installSelectHandlers(element: HTMLElement, onSelect?: () => void): void {
  if (!onSelect) return;
  element.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  element.addEventListener("click", (event) => {
    event.preventDefault();
    onSelect();
  });
}

function createPreviewElement(
  language: string,
  rendered: string,
  onSelect?: () => void
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = `code-block-preview ${language}-preview`;
  const sanitized = language === "mermaid" ? sanitizeSvg(rendered) : sanitizeKatex(rendered);
  wrapper.innerHTML = sanitized;
  installSelectHandlers(wrapper, onSelect);
  return wrapper;
}

function createPreviewPlaceholder(
  language: string,
  label: string,
  onSelect?: () => void
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = `code-block-preview ${language}-preview code-block-preview-placeholder`;
  wrapper.textContent = label;
  installSelectHandlers(wrapper, onSelect);
  return wrapper;
}

export const codePreviewExtension = Extension.create({
  name: "codePreview",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codePreviewPluginKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, decorations, _oldState, newState) {
            if (!tr.docChanged && decorations !== DecorationSet.empty) {
              return decorations.map(tr.mapping, tr.doc);
            }

            const newDecorations: Decoration[] = [];

            newState.doc.descendants((node, pos) => {
              if (node.type.name !== "codeBlock" && node.type.name !== "code_block") return;

              const language = (node.attrs.language ?? "").toLowerCase();
              if (!PREVIEW_ONLY_LANGUAGES.has(language)) return;

              const content = node.textContent;
              const cacheKey = `${language}:${content}`;
              const nodeStart = pos;
              const nodeEnd = pos + node.nodeSize;
              const handleSelect = (view: EditorView | null | undefined) => {
                if (!view) return;
                const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodeStart));
                view.dispatch(tr);
                view.focus();
              };

              newDecorations.push(
                Decoration.node(nodeStart, nodeEnd, {
                  class: "code-block-preview-only",
                  "data-language": language,
                  contenteditable: "false",
                })
              );

              if (!content.trim()) {
                const placeholderLabel = language === "mermaid" ? "Empty diagram" : "Empty math block";
                const widget = Decoration.widget(
                  nodeEnd,
                  (view) => createPreviewPlaceholder(language, placeholderLabel, () => handleSelect(view)),
                  { side: 1, key: `${cacheKey}:placeholder` }
                );
                newDecorations.push(widget);
                return;
              }

              if (renderCache.has(cacheKey)) {
                const rendered = renderCache.get(cacheKey)!;
                const widget = Decoration.widget(
                  nodeEnd,
                  (view) => createPreviewElement(language, rendered, () => handleSelect(view)),
                  { side: 1, key: cacheKey }
                );
                newDecorations.push(widget);
                return;
              }

              if (language === "latex") {
                const rendered = renderLatex(content);
                renderCache.set(cacheKey, rendered);
                const widget = Decoration.widget(
                  nodeEnd,
                  (view) => createPreviewElement(language, rendered, () => handleSelect(view)),
                  { side: 1, key: cacheKey }
                );
                newDecorations.push(widget);
                return;
              }

              if (language === "mermaid") {
                const placeholder = document.createElement("div");
                placeholder.className = "code-block-preview mermaid-preview mermaid-loading";
                placeholder.textContent = "Rendering diagram...";

                const widget = Decoration.widget(
                  nodeEnd,
                  (view) => {
                    placeholder.addEventListener("mousedown", (event) => {
                      event.preventDefault();
                    });
                    placeholder.addEventListener("click", (event) => {
                      event.preventDefault();
                      handleSelect(view);
                    });
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
      }),
    ];
  },
});

export function clearPreviewCache() {
  renderCache.clear();
}
