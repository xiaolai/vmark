/**
 * AI Suggestion Store
 *
 * Manages AI-generated content suggestions that require user approval.
 * Uses CustomEvent pattern for plugin communication (like searchStore).
 */

import { create } from "zustand";
import type { AiSuggestion, SuggestionType } from "@/plugins/aiSuggestion/types";

interface AiSuggestionState {
  suggestions: Map<string, AiSuggestion>;
  focusedSuggestionId: string | null;
}

interface AiSuggestionActions {
  /** Add a new suggestion. Returns the generated ID. */
  addSuggestion: (params: {
    type: SuggestionType;
    from: number;
    to: number;
    newContent?: string;
    originalContent?: string;
  }) => string;

  /** Accept a suggestion by ID */
  acceptSuggestion: (id: string) => void;

  /** Reject a suggestion by ID */
  rejectSuggestion: (id: string) => void;

  /** Accept all pending suggestions */
  acceptAll: () => void;

  /** Reject all pending suggestions */
  rejectAll: () => void;

  /** Focus a specific suggestion */
  focusSuggestion: (id: string | null) => void;

  /** Navigate to next suggestion */
  navigateNext: () => void;

  /** Navigate to previous suggestion */
  navigatePrevious: () => void;

  /** Get suggestions sorted by position */
  getSortedSuggestions: () => AiSuggestion[];

  /** Get suggestion by ID */
  getSuggestion: (id: string) => AiSuggestion | undefined;

  /** Clear all suggestions (used on document change) */
  clearAll: () => void;
}

const initialState: AiSuggestionState = {
  suggestions: new Map(),
  focusedSuggestionId: null,
};

let suggestionCounter = 0;

function generateSuggestionId(): string {
  return `ai-suggestion-${++suggestionCounter}-${Date.now()}`;
}

export const useAiSuggestionStore = create<AiSuggestionState & AiSuggestionActions>(
  (set, get) => ({
    ...initialState,

    addSuggestion: (params) => {
      const id = generateSuggestionId();
      const suggestion: AiSuggestion = {
        id,
        type: params.type,
        from: params.from,
        to: params.to,
        newContent: params.newContent,
        originalContent: params.originalContent,
        createdAt: Date.now(),
      };

      set((state) => {
        const newSuggestions = new Map(state.suggestions);
        newSuggestions.set(id, suggestion);
        return {
          suggestions: newSuggestions,
          // Auto-focus first suggestion if none focused
          focusedSuggestionId: state.focusedSuggestionId ?? id,
        };
      });

      // Dispatch event for plugin to create decorations
      window.dispatchEvent(
        new CustomEvent("ai-suggestion:added", { detail: { id, suggestion } })
      );

      return id;
    },

    acceptSuggestion: (id) => {
      const suggestion = get().suggestions.get(id);
      if (!suggestion) return;

      // Dispatch event BEFORE removing from store so plugin can apply the change
      window.dispatchEvent(
        new CustomEvent("ai-suggestion:accept", { detail: { id, suggestion } })
      );

      set((state) => {
        const newSuggestions = new Map(state.suggestions);
        newSuggestions.delete(id);

        // Update focus to next available suggestion
        let newFocusedId: string | null = null;
        if (state.focusedSuggestionId === id && newSuggestions.size > 0) {
          const sorted = Array.from(newSuggestions.values()).sort(
            (a, b) => a.from - b.from
          );
          newFocusedId = sorted[0]?.id ?? null;
        } else if (state.focusedSuggestionId !== id) {
          newFocusedId = state.focusedSuggestionId;
        }

        return {
          suggestions: newSuggestions,
          focusedSuggestionId: newFocusedId,
        };
      });
    },

    rejectSuggestion: (id) => {
      const suggestion = get().suggestions.get(id);
      if (!suggestion) return;

      // Dispatch event BEFORE removing from store so plugin can restore content
      window.dispatchEvent(
        new CustomEvent("ai-suggestion:reject", { detail: { id, suggestion } })
      );

      set((state) => {
        const newSuggestions = new Map(state.suggestions);
        newSuggestions.delete(id);

        // Update focus to next available suggestion
        let newFocusedId: string | null = null;
        if (state.focusedSuggestionId === id && newSuggestions.size > 0) {
          const sorted = Array.from(newSuggestions.values()).sort(
            (a, b) => a.from - b.from
          );
          newFocusedId = sorted[0]?.id ?? null;
        } else if (state.focusedSuggestionId !== id) {
          newFocusedId = state.focusedSuggestionId;
        }

        return {
          suggestions: newSuggestions,
          focusedSuggestionId: newFocusedId,
        };
      });
    },

    acceptAll: () => {
      // Process in reverse position order to maintain correct positions
      const sorted = get().getSortedSuggestions().reverse();
      for (const suggestion of sorted) {
        get().acceptSuggestion(suggestion.id);
      }
    },

    rejectAll: () => {
      // Process in reverse position order to maintain correct positions
      const sorted = get().getSortedSuggestions().reverse();
      for (const suggestion of sorted) {
        get().rejectSuggestion(suggestion.id);
      }
    },

    focusSuggestion: (id) => {
      set({ focusedSuggestionId: id });
      if (id) {
        window.dispatchEvent(
          new CustomEvent("ai-suggestion:focus-changed", { detail: { id } })
        );
      }
    },

    navigateNext: () => {
      const { focusedSuggestionId, suggestions } = get();
      if (suggestions.size === 0) return;

      const sorted = get().getSortedSuggestions();
      if (sorted.length === 0) return;

      const currentIndex = focusedSuggestionId
        ? sorted.findIndex((s) => s.id === focusedSuggestionId)
        : -1;

      const nextIndex = (currentIndex + 1) % sorted.length;
      get().focusSuggestion(sorted[nextIndex].id);
    },

    navigatePrevious: () => {
      const { focusedSuggestionId, suggestions } = get();
      if (suggestions.size === 0) return;

      const sorted = get().getSortedSuggestions();
      if (sorted.length === 0) return;

      const currentIndex = focusedSuggestionId
        ? sorted.findIndex((s) => s.id === focusedSuggestionId)
        : 0;

      const prevIndex = currentIndex <= 0 ? sorted.length - 1 : currentIndex - 1;
      get().focusSuggestion(sorted[prevIndex].id);
    },

    getSortedSuggestions: () => {
      return Array.from(get().suggestions.values()).sort((a, b) => a.from - b.from);
    },

    getSuggestion: (id) => {
      return get().suggestions.get(id);
    },

    clearAll: () => {
      set({ suggestions: new Map(), focusedSuggestionId: null });
      window.dispatchEvent(new CustomEvent("ai-suggestion:cleared"));
    },
  })
);
