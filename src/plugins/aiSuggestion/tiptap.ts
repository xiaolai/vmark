/**
 * AI Suggestion Tiptap Extension
 *
 * Provides decorations for AI suggestions and handles accept/reject transactions.
 * Follows the pattern from search/tiptap.ts for Zustand + decoration integration.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { runOrQueueProseMirrorAction } from "@/utils/imeGuard";
import type { AiSuggestion } from "./types";

/**
 * Create Lucide-style SVG icon element.
 * Icons are 24x24 viewBox, sized via CSS.
 */
function createIcon(pathD: string | string[]): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");

  const paths = Array.isArray(pathD) ? pathD : [pathD];
  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }

  return svg;
}

// Lucide icon paths
const ICON_CHECK = "M20 6 9 17l-5-5";
const ICON_X = ["M18 6 6 18", "m6 6 12 12"];

const aiSuggestionPluginKey = new PluginKey("aiSuggestion");

/**
 * Get decoration class based on suggestion type and focus state.
 */
function getDecorationClass(suggestion: AiSuggestion, isFocused: boolean): string {
  const baseClass = `ai-suggestion ai-suggestion-${suggestion.type}`;
  return isFocused ? `${baseClass} ai-suggestion-focused` : baseClass;
}

export const aiSuggestionExtension = Extension.create({
  name: "aiSuggestion",

  addKeyboardShortcuts() {
    return {
      // Enter: accept focused suggestion
      Enter: () => {
        const state = useAiSuggestionStore.getState();
        if (state.focusedSuggestionId && state.suggestions.size > 0) {
          state.acceptSuggestion(state.focusedSuggestionId);
          return true;
        }
        return false;
      },

      // Escape: reject focused suggestion
      Escape: () => {
        const state = useAiSuggestionStore.getState();
        if (state.focusedSuggestionId && state.suggestions.size > 0) {
          state.rejectSuggestion(state.focusedSuggestionId);
          return true;
        }
        return false;
      },

      // Tab: navigate to next suggestion
      Tab: () => {
        const state = useAiSuggestionStore.getState();
        if (state.suggestions.size > 0) {
          state.navigateNext();
          return true;
        }
        return false;
      },

      // Shift-Tab: navigate to previous suggestion
      "Shift-Tab": () => {
        const state = useAiSuggestionStore.getState();
        if (state.suggestions.size > 0) {
          state.navigatePrevious();
          return true;
        }
        return false;
      },

      // Mod-Shift-Enter: accept all suggestions
      "Mod-Shift-Enter": () => {
        const state = useAiSuggestionStore.getState();
        if (state.suggestions.size > 0) {
          state.acceptAll();
          return true;
        }
        return false;
      },

      // Mod-Shift-Escape: reject all suggestions
      "Mod-Shift-Escape": () => {
        const state = useAiSuggestionStore.getState();
        if (state.suggestions.size > 0) {
          state.rejectAll();
          return true;
        }
        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: aiSuggestionPluginKey,

        props: {
          decorations(state) {
            const suggestionState = useAiSuggestionStore.getState();
            if (suggestionState.suggestions.size === 0) {
              return DecorationSet.empty;
            }

            const decorations: Decoration[] = [];
            const { focusedSuggestionId, suggestions } = suggestionState;

            for (const suggestion of suggestions.values()) {
              // Validate positions are within document bounds
              if (suggestion.from < 0 || suggestion.to > state.doc.content.size) {
                continue;
              }

              const isFocused = suggestion.id === focusedSuggestionId;
              const className = getDecorationClass(suggestion, isFocused);

              // Create inline decoration for the suggestion range
              decorations.push(
                Decoration.inline(suggestion.from, suggestion.to, {
                  class: className,
                  "data-suggestion-id": suggestion.id,
                  "data-suggestion-type": suggestion.type,
                })
              );

              // Add widget decoration for accept/reject buttons on focused suggestion
              if (isFocused) {
                decorations.push(
                  Decoration.widget(suggestion.to, () => {
                    const container = document.createElement("span");
                    container.className = "ai-suggestion-buttons";

                    // Accept button with Check icon
                    const acceptBtn = document.createElement("button");
                    acceptBtn.className = "ai-suggestion-btn ai-suggestion-btn-accept";
                    acceptBtn.title = "Accept (Enter)";
                    acceptBtn.appendChild(createIcon(ICON_CHECK));
                    acceptBtn.onclick = (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      useAiSuggestionStore.getState().acceptSuggestion(suggestion.id);
                    };

                    // Reject button with X icon
                    const rejectBtn = document.createElement("button");
                    rejectBtn.className = "ai-suggestion-btn ai-suggestion-btn-reject";
                    rejectBtn.title = "Reject (Escape)";
                    rejectBtn.appendChild(createIcon(ICON_X));
                    rejectBtn.onclick = (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      useAiSuggestionStore.getState().rejectSuggestion(suggestion.id);
                    };

                    container.appendChild(acceptBtn);
                    container.appendChild(rejectBtn);
                    return container;
                  })
                );
              }
            }

            return DecorationSet.create(state.doc, decorations);
          },

          handleClick(_view, _pos, event) {
            // Focus suggestion when clicked
            const target = event.target as HTMLElement;
            const suggestionEl = target.closest("[data-suggestion-id]");
            if (suggestionEl) {
              const id = suggestionEl.getAttribute("data-suggestion-id");
              if (id) {
                useAiSuggestionStore.getState().focusSuggestion(id);
                return true;
              }
            }
            return false;
          },
        },

        view(editorView) {
          // Handle accept event - apply the change
          const handleAccept = (event: Event) => {
            const { suggestion } = (event as CustomEvent).detail as {
              id: string;
              suggestion: AiSuggestion;
            };

            runOrQueueProseMirrorAction(editorView, () => {
              switch (suggestion.type) {
                case "insert":
                case "replace":
                  // Content already in document, just need to refresh decorations
                  editorView.dispatch(editorView.state.tr);
                  break;

                case "delete": {
                  // Now actually delete the content
                  const tr = editorView.state.tr.delete(suggestion.from, suggestion.to);
                  editorView.dispatch(tr);
                  break;
                }
              }
            });
          };

          // Handle reject event - restore original state
          const handleReject = (event: Event) => {
            const { suggestion } = (event as CustomEvent).detail as {
              id: string;
              suggestion: AiSuggestion;
            };

            runOrQueueProseMirrorAction(editorView, () => {
              const { state } = editorView;

              switch (suggestion.type) {
                case "insert": {
                  // Delete the inserted content
                  const deleteTr = state.tr.delete(suggestion.from, suggestion.to);
                  editorView.dispatch(deleteTr);
                  break;
                }

                case "replace": {
                  // Delete new content and restore original
                  if (suggestion.originalContent) {
                    const tr = state.tr
                      .delete(suggestion.from, suggestion.to)
                      .insertText(suggestion.originalContent, suggestion.from);
                    editorView.dispatch(tr);
                  }
                  break;
                }

                case "delete":
                  // Content was never deleted, just refresh decorations
                  editorView.dispatch(state.tr);
                  break;
              }
            });
          };

          // Handle store changes to trigger decoration updates
          const unsubscribe = useAiSuggestionStore.subscribe(() => {
            runOrQueueProseMirrorAction(editorView, () => {
              editorView.dispatch(editorView.state.tr);
            });
          });

          // Subscribe to scroll-to-focus events
          const handleFocusChanged = (event: Event) => {
            const { id } = (event as CustomEvent).detail;
            const suggestion = useAiSuggestionStore.getState().getSuggestion(id);
            if (!suggestion) return;

            // Scroll to the focused suggestion
            const coords = editorView.coordsAtPos(suggestion.from);
            const editorRect = editorView.dom.getBoundingClientRect();

            if (coords.top < editorRect.top || coords.bottom > editorRect.bottom) {
              editorView.dom.scrollTo({
                top:
                  editorView.dom.scrollTop +
                  coords.top -
                  editorRect.top -
                  editorRect.height / 3,
                behavior: "smooth",
              });
            }
          };

          window.addEventListener("ai-suggestion:accept", handleAccept);
          window.addEventListener("ai-suggestion:reject", handleReject);
          window.addEventListener("ai-suggestion:focus-changed", handleFocusChanged);

          return {
            destroy() {
              unsubscribe();
              window.removeEventListener("ai-suggestion:accept", handleAccept);
              window.removeEventListener("ai-suggestion:reject", handleReject);
              window.removeEventListener("ai-suggestion:focus-changed", handleFocusChanged);
            },
          };
        },
      }),
    ];
  },
});
