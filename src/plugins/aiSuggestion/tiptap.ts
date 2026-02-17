/**
 * AI Suggestion Tiptap Extension
 *
 * Purpose: Renders AI-generated suggestions as non-destructive decorations (ghost text,
 * strikethrough) and commits document changes only when the user explicitly accepts.
 *
 * Pipeline: AI provider → aiSuggestionStore → this plugin reads store → decorations rendered
 *         → user accept/reject → store event → this plugin applies or discards transaction
 *
 * Key decisions:
 *   - UNDO/REDO SAFE: Document is NOT modified until user accepts — all previews are decorations
 *   - Insert: ghost text widget at position
 *   - Replace: original with strikethrough + ghost text for new content
 *   - Delete: original with strikethrough
 *   - Accept/reject buttons rendered as ProseMirror widgets to stay in editor coordinate space
 *
 * @coordinates-with types.ts — AiSuggestion interface and event name constants
 * @coordinates-with stores/aiSuggestionStore.ts — source of suggestion data
 * @module plugins/aiSuggestion/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { useTiptapEditorStore } from "@/stores/tiptapEditorStore";
import { runOrQueueProseMirrorAction } from "@/utils/imeGuard";
import { createMarkdownPasteSlice } from "@/plugins/markdownPaste/tiptap";
import { cleanMarkdownForClipboard } from "@/plugins/markdownCopy/tiptap";
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
  // Strip markdown backslash escapes (\$, \~, \@ …) and collapse autolinks
  // so ghost text matches what the user will see after accepting.
  span.textContent = cleanMarkdownForClipboard(text);
  return span;
}

/**
 * Apply a suggestion's document change on a transaction.
 * Shared by button handler, handleAccept, and handleAcceptAll.
 */
function applySuggestionToTr(
  state: EditorState,
  tr: Transaction,
  suggestion: AiSuggestion,
): Transaction {
  const docSize = tr.doc.content.size;

  // Whole-document replace (from=0): clamp `to` to current doc size.
  // The doc may have changed since the suggestion was created, but the
  // intent is to replace the entire content — so we use the live size.
  if (suggestion.from === 0 && suggestion.to > docSize) {
    suggestion = { ...suggestion, to: docSize };
  }

  // Guard against stale positions after doc edits
  if (!isValidPosition(suggestion, docSize)) return tr;

  switch (suggestion.type) {
    case "insert": {
      if (suggestion.newContent != null) {
        const slice = createMarkdownPasteSlice(state, suggestion.newContent);
        return tr.replaceRange(suggestion.from, suggestion.from, slice);
      }
      break;
    }
    case "replace": {
      if (suggestion.newContent != null) {
        const slice = createMarkdownPasteSlice(state, suggestion.newContent);
        return tr.replaceRange(suggestion.from, suggestion.to, slice);
      }
      break;
    }
    case "delete": {
      return tr.delete(suggestion.from, suggestion.to);
    }
  }
  return tr;
}

/**
 * Apply a suggestion directly on the editor view.
 * Uses runOrQueueProseMirrorAction for IME safety.
 */
function applySuggestion(view: EditorView, suggestion: AiSuggestion): void {
  runOrQueueProseMirrorAction(view, () => {
    const { state } = view;
    view.dispatch(applySuggestionToTr(state, state.tr, suggestion));
  });
}

/**
 * Create accept/reject buttons container.
 * Buttons apply changes directly via the editor store — no CustomEvent
 * indirection — for immediate visual response.
 */
function createButtons(suggestion: AiSuggestion): HTMLSpanElement {
  const container = document.createElement("span");
  container.className = "ai-suggestion-buttons";

  // Use mousedown instead of click — ProseMirror's mousedown handler
  // triggers state updates that rebuild widget decorations, so the button
  // DOM is replaced before the click event fires.
  const acceptBtn = document.createElement("button");
  acceptBtn.className = "ai-suggestion-btn ai-suggestion-btn-accept";
  acceptBtn.title = "Accept (Enter)";
  acceptBtn.appendChild(createIcon(ICON_CHECK));
  acceptBtn.onmousedown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const view = useTiptapEditorStore.getState().editorView;
    if (!view) return;
    applySuggestion(view, suggestion);
    useAiSuggestionStore.getState().removeSuggestion(suggestion.id);
  };

  // Reject button with X icon
  const rejectBtn = document.createElement("button");
  rejectBtn.className = "ai-suggestion-btn ai-suggestion-btn-reject";
  rejectBtn.title = "Reject (Escape)";
  rejectBtn.appendChild(createIcon(ICON_X));
  rejectBtn.onmousedown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    useAiSuggestionStore.getState().removeSuggestion(suggestion.id);
  };

  container.appendChild(acceptBtn);
  container.appendChild(rejectBtn);
  return container;
}

/**
 * Check if a DOM event targets a suggestion button.
 * Used by widget decorations to tell ProseMirror not to handle button clicks.
 */
function isButtonEvent(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return target.closest(".ai-suggestion-btn") !== null;
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
                    }, { side: 0, stopEvent: isButtonEvent })
                  );
                  break;
                }

                case "replace": {
                  // Replace: Strikethrough original + ghost text for new
                  // Skip zero-length range (nothing to strike through)
                  if (suggestion.from === suggestion.to) continue;
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
                      container.setAttribute("data-suggestion-id", suggestion.id);

                      // Ghost text for new content
                      if (suggestion.newContent) {
                        container.appendChild(createGhostText(suggestion.newContent, isFocused));
                      }

                      // Buttons for focused suggestion
                      if (isFocused) {
                        container.appendChild(createButtons(suggestion));
                      }

                      return container;
                    }, { side: 0, stopEvent: isButtonEvent })
                  );
                  break;
                }

                case "delete": {
                  // Delete: Strikethrough decoration only
                  // Skip zero-length range (nothing to delete)
                  if (suggestion.from === suggestion.to) continue;
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
                      Decoration.widget(suggestion.to, () => createButtons(suggestion), { side: 0, stopEvent: isButtonEvent })
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
          // Handle accept event — apply the suggestion's document change
          const handleAccept = (event: Event) => {
            const { suggestion } = (event as CustomEvent).detail as {
              suggestion: AiSuggestion;
            };

            runOrQueueProseMirrorAction(editorView, () => {
              const { state } = editorView;
              editorView.dispatch(applySuggestionToTr(state, state.tr, suggestion));
            });
          };

          // Trigger decoration refresh via empty transaction
          const refreshDecorations = () => {
            runOrQueueProseMirrorAction(editorView, () => {
              editorView.dispatch(editorView.state.tr);
            });
          };

          // Handle reject event — just refresh decorations (no doc changes)
          const handleReject = refreshDecorations;

          // Handle accept all event — apply all changes in a SINGLE transaction
          const handleAcceptAll = (event: Event) => {
            const { suggestions } = (event as CustomEvent).detail as {
              suggestions: AiSuggestion[];
            };

            if (suggestions.length === 0) return;

            runOrQueueProseMirrorAction(editorView, () => {
              const { state } = editorView;
              let { tr } = state;

              // Apply all suggestions in reverse order (they're already sorted reverse)
              // so earlier positions remain valid as we modify later ones
              for (const suggestion of suggestions) {
                tr = applySuggestionToTr(state, tr, suggestion);
              }

              editorView.dispatch(tr);
            });
          };

          // Handle reject all event — just refresh decorations
          const handleRejectAll = refreshDecorations;

          // Handle store changes to trigger decoration updates
          const unsubscribe = useAiSuggestionStore.subscribe(refreshDecorations);

          // Subscribe to scroll-to-focus events
          const handleFocusChanged = (event: Event) => {
            const { id } = (event as CustomEvent).detail;
            const suggestion = useAiSuggestionStore.getState().getSuggestion(id);
            if (!suggestion) return;

            // Guard against stale positions after doc changes
            if (!isValidPosition(suggestion, editorView.state.doc.content.size)) return;

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
