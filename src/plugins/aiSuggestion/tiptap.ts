/**
 * AI Suggestion Tiptap Extension
 *
 * Provides decorations for AI suggestions and handles accept/reject transactions.
 *
 * UNDO/REDO SAFE: Document is NOT modified until user accepts.
 * - Insert: Shows ghost text widget at position
 * - Replace: Shows original with strikethrough + ghost text for new
 * - Delete: Shows original with strikethrough
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { runOrQueueProseMirrorAction } from "@/utils/imeGuard";
import type { AiSuggestion } from "./types";
import { AI_SUGGESTION_EVENTS } from "./types";

const aiSuggestionPluginKey = new PluginKey("aiSuggestion");

/**
 * Create Lucide-style SVG icon element.
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

/**
 * Create ghost text element for insert/replace preview.
 */
function createGhostText(text: string, isFocused: boolean): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `ai-suggestion-ghost${isFocused ? " ai-suggestion-ghost-focused" : ""}`;
  span.textContent = text;
  return span;
}

/**
 * Create accept/reject buttons container.
 */
function createButtons(suggestion: AiSuggestion): HTMLSpanElement {
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
}

/**
 * Get decoration class for delete/replace original text.
 */
function getDecorationClass(suggestion: AiSuggestion, isFocused: boolean): string {
  const baseClass = `ai-suggestion ai-suggestion-${suggestion.type}`;
  return isFocused ? `${baseClass} ai-suggestion-focused` : baseClass;
}

/**
 * Check if suggestion positions are valid within document bounds.
 */
function isValidPosition(suggestion: AiSuggestion, docSize: number): boolean {
  return suggestion.from >= 0 && suggestion.to <= docSize && suggestion.from <= suggestion.to;
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
              const isFocused = suggestion.id === focusedSuggestionId;
              const docSize = state.doc.content.size;

              // Skip suggestions with invalid positions
              if (!isValidPosition(suggestion, docSize)) continue;

              switch (suggestion.type) {
                case "insert": {
                  // Insert: Show ghost text widget at position
                  // No inline decoration - document unchanged
                  decorations.push(
                    Decoration.widget(suggestion.from, () => {
                      const container = document.createElement("span");
                      container.className = "ai-suggestion-insert-container";
                      container.setAttribute("data-suggestion-id", suggestion.id);

                      // Ghost text preview
                      if (suggestion.newContent) {
                        container.appendChild(createGhostText(suggestion.newContent, isFocused));
                      }

                      // Buttons for focused suggestion
                      if (isFocused) {
                        container.appendChild(createButtons(suggestion));
                      }

                      return container;
                    }, { side: 0 })
                  );
                  break;
                }

                case "replace": {
                  // Replace: Strikethrough original + ghost text for new
                  // Strikethrough decoration on original text
                  decorations.push(
                    Decoration.inline(suggestion.from, suggestion.to, {
                      class: getDecorationClass(suggestion, isFocused),
                      "data-suggestion-id": suggestion.id,
                      "data-suggestion-type": suggestion.type,
                    })
                  );

                  // Ghost text widget after original
                  decorations.push(
                    Decoration.widget(suggestion.to, () => {
                      const container = document.createElement("span");
                      container.className = "ai-suggestion-replace-container";

                      // Ghost text for new content
                      if (suggestion.newContent) {
                        container.appendChild(createGhostText(suggestion.newContent, isFocused));
                      }

                      // Buttons for focused suggestion
                      if (isFocused) {
                        container.appendChild(createButtons(suggestion));
                      }

                      return container;
                    }, { side: 0 })
                  );
                  break;
                }

                case "delete": {
                  // Delete: Strikethrough decoration only
                  decorations.push(
                    Decoration.inline(suggestion.from, suggestion.to, {
                      class: getDecorationClass(suggestion, isFocused),
                      "data-suggestion-id": suggestion.id,
                      "data-suggestion-type": suggestion.type,
                    })
                  );

                  // Buttons for focused suggestion
                  if (isFocused) {
                    decorations.push(
                      Decoration.widget(suggestion.to, () => createButtons(suggestion), { side: 0 })
                    );
                  }
                  break;
                }
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
          // Handle accept event - NOW we modify the document
          const handleAccept = (event: Event) => {
            const { suggestion } = (event as CustomEvent).detail as {
              id: string;
              suggestion: AiSuggestion;
            };

            runOrQueueProseMirrorAction(editorView, () => {
              const { state } = editorView;

              switch (suggestion.type) {
                case "insert": {
                  // Insert the new content at the stored position
                  if (suggestion.newContent) {
                    const tr = state.tr.insertText(suggestion.newContent, suggestion.from);
                    editorView.dispatch(tr);
                  }
                  break;
                }

                case "replace": {
                  // Delete original and insert new content
                  if (suggestion.newContent) {
                    const tr = state.tr
                      .delete(suggestion.from, suggestion.to)
                      .insertText(suggestion.newContent, suggestion.from);
                    editorView.dispatch(tr);
                  }
                  break;
                }

                case "delete": {
                  // Delete the content
                  const tr = state.tr.delete(suggestion.from, suggestion.to);
                  editorView.dispatch(tr);
                  break;
                }
              }
            });
          };

          // Handle reject event - just refresh decorations (no doc changes)
          const handleReject = () => {
            runOrQueueProseMirrorAction(editorView, () => {
              // Trigger decoration refresh
              editorView.dispatch(editorView.state.tr);
            });
          };

          // Handle accept all event - apply all changes in a SINGLE transaction
          const handleAcceptAll = (event: Event) => {
            const { suggestions } = (event as CustomEvent).detail as {
              suggestions: AiSuggestion[];
            };

            if (suggestions.length === 0) return;

            runOrQueueProseMirrorAction(editorView, () => {
              let { tr } = editorView.state;

              // Apply all suggestions in reverse order (they're already sorted reverse)
              // This maintains correct positions as we modify the document
              for (const suggestion of suggestions) {
                switch (suggestion.type) {
                  case "insert": {
                    if (suggestion.newContent) {
                      tr = tr.insertText(suggestion.newContent, suggestion.from);
                    }
                    break;
                  }
                  case "replace": {
                    if (suggestion.newContent) {
                      tr = tr
                        .delete(suggestion.from, suggestion.to)
                        .insertText(suggestion.newContent, suggestion.from);
                    }
                    break;
                  }
                  case "delete": {
                    tr = tr.delete(suggestion.from, suggestion.to);
                    break;
                  }
                }
              }

              // Dispatch single transaction for all changes - one undo reverts all
              editorView.dispatch(tr);
            });
          };

          // Handle reject all event - just refresh decorations
          const handleRejectAll = () => {
            runOrQueueProseMirrorAction(editorView, () => {
              // Trigger decoration refresh
              editorView.dispatch(editorView.state.tr);
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

          window.addEventListener(AI_SUGGESTION_EVENTS.ACCEPT, handleAccept);
          window.addEventListener(AI_SUGGESTION_EVENTS.REJECT, handleReject);
          window.addEventListener(AI_SUGGESTION_EVENTS.ACCEPT_ALL, handleAcceptAll);
          window.addEventListener(AI_SUGGESTION_EVENTS.REJECT_ALL, handleRejectAll);
          window.addEventListener(AI_SUGGESTION_EVENTS.FOCUS_CHANGED, handleFocusChanged);

          return {
            destroy() {
              unsubscribe();
              window.removeEventListener(AI_SUGGESTION_EVENTS.ACCEPT, handleAccept);
              window.removeEventListener(AI_SUGGESTION_EVENTS.REJECT, handleReject);
              window.removeEventListener(AI_SUGGESTION_EVENTS.ACCEPT_ALL, handleAcceptAll);
              window.removeEventListener(AI_SUGGESTION_EVENTS.REJECT_ALL, handleRejectAll);
              window.removeEventListener(AI_SUGGESTION_EVENTS.FOCUS_CHANGED, handleFocusChanged);
            },
          };
        },
      }),
    ];
  },
});
