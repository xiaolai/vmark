/**
 * AI Suggestion Store
 *
 * Purpose: Manages AI-generated content suggestions (insertions, replacements,
 *   deletions) that require user approval before being applied to the document.
 *
 * Pipeline: AI genie response → addSuggestion() → ProseMirror decoration shows
 *   diff → user accepts/rejects → CustomEvent dispatched → aiSuggestion plugin
 *   applies or reverts the change.
 *
 * Key decisions:
 *   - Uses CustomEvent pattern (not direct editor API calls) so the store stays
 *     decoupled from ProseMirror — events are dispatched BEFORE removing from
 *     store so the plugin can read suggestion data during the apply.
 *   - acceptAll/rejectAll emit a single batched event with suggestions in
 *     reverse position order so position offsets don't cascade.
 *   - Tab watcher (initSuggestionTabWatcher) clears stale suggestions when
 *     switching tabs to prevent mutations to the wrong document.
 *   - Focus auto-advances to next suggestion after accept/reject for fast review.
 *
 * @coordinates-with aiSuggestion plugin — ProseMirror decorations and event handlers
 * @coordinates-with GeniePicker component — triggers AI invocation that produces suggestions
 * @module stores/aiSuggestionStore
 */

import { create } from "zustand";
import type { AiSuggestion, SuggestionType } from "@/plugins/aiSuggestion/types";
import { AI_SUGGESTION_EVENTS } from "@/plugins/aiSuggestion/types";

interface AiSuggestionState {
  suggestions: Map<string, AiSuggestion>;
  focusedSuggestionId: string | null;
}

interface AiSuggestionActions {
  /** Add a new suggestion. Returns the generated ID. */
  addSuggestion: (params: {
    tabId: string;
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

  /** Remove a suggestion without dispatching accept/reject events.
   *  Used by button handlers that apply changes directly. */
  removeSuggestion: (id: string) => void;

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

  /** Clear suggestions for a specific tab (used on tab switch) */
  clearForTab: (tabId: string) => void;

  /** Clear all suggestions (used on document/tab change) */
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

/**
 * Delete a suggestion and update focus to the next available.
 * Shared by acceptSuggestion, rejectSuggestion, and removeSuggestion.
 */
function deleteAndUpdateFocus(state: AiSuggestionState, id: string): AiSuggestionState {
  const newSuggestions = new Map(state.suggestions);
  newSuggestions.delete(id);

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
}

export const useAiSuggestionStore = create<AiSuggestionState & AiSuggestionActions>(
  (set, get) => ({
    ...initialState,

    addSuggestion: (params) => {
      const id = generateSuggestionId();
      const suggestion: AiSuggestion = {
        id,
        tabId: params.tabId,
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

      window.dispatchEvent(
        new CustomEvent(AI_SUGGESTION_EVENTS.ADDED, { detail: { id, suggestion } })
      );

      return id;
    },

    acceptSuggestion: (id) => {
      const suggestion = get().suggestions.get(id);
      if (!suggestion) return;

      // Dispatch event BEFORE removing from store so plugin can apply the change
      window.dispatchEvent(
        new CustomEvent(AI_SUGGESTION_EVENTS.ACCEPT, { detail: { id, suggestion } })
      );

      set((state) => deleteAndUpdateFocus(state, id));
    },

    rejectSuggestion: (id) => {
      const suggestion = get().suggestions.get(id);
      if (!suggestion) return;

      // Dispatch event BEFORE removing from store so plugin can restore content
      window.dispatchEvent(
        new CustomEvent(AI_SUGGESTION_EVENTS.REJECT, { detail: { id, suggestion } })
      );

      set((state) => deleteAndUpdateFocus(state, id));
    },

    removeSuggestion: (id) => {
      if (!get().suggestions.has(id)) return;
      const oldFocusedId = get().focusedSuggestionId;
      set((state) => deleteAndUpdateFocus(state, id));
      const newFocusedId = get().focusedSuggestionId;
      if (newFocusedId && newFocusedId !== oldFocusedId) {
        window.dispatchEvent(
          new CustomEvent(AI_SUGGESTION_EVENTS.FOCUS_CHANGED, { detail: { id: newFocusedId } })
        );
      }
    },

    acceptAll: () => {
      // Get suggestions in reverse position order (for correct position handling)
      const sorted = get().getSortedSuggestions().reverse();
      if (sorted.length === 0) return;

      // Emit single event with all suggestions for batched transaction
      window.dispatchEvent(
        new CustomEvent(AI_SUGGESTION_EVENTS.ACCEPT_ALL, {
          detail: { suggestions: sorted },
        })
      );

      // Clear all from store
      set({ suggestions: new Map(), focusedSuggestionId: null });
    },

    rejectAll: () => {
      // Get suggestions in reverse position order
      const sorted = get().getSortedSuggestions().reverse();
      if (sorted.length === 0) return;

      // Emit single event for batched rejection (just clears decorations)
      window.dispatchEvent(
        new CustomEvent(AI_SUGGESTION_EVENTS.REJECT_ALL, {
          detail: { suggestions: sorted },
        })
      );

      // Clear all from store
      set({ suggestions: new Map(), focusedSuggestionId: null });
    },

    focusSuggestion: (id) => {
      set({ focusedSuggestionId: id });
      if (id) {
        window.dispatchEvent(
          new CustomEvent(AI_SUGGESTION_EVENTS.FOCUS_CHANGED, { detail: { id } })
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

    clearForTab: (tabId) => {
      const { suggestions, focusedSuggestionId } = get();
      const filtered = new Map<string, AiSuggestion>();
      let focusCleared = false;
      for (const [id, s] of suggestions) {
        if (s.tabId === tabId) {
          if (id === focusedSuggestionId) focusCleared = true;
        } else {
          filtered.set(id, s);
        }
      }
      if (filtered.size !== suggestions.size) {
        set({
          suggestions: filtered,
          focusedSuggestionId: focusCleared ? null : focusedSuggestionId,
        });
      }
    },

    clearAll: () => {
      set({ suggestions: new Map(), focusedSuggestionId: null });
    },
  })
);

// Clear suggestions on tab switch to prevent stale suggestions mutating wrong document.
// Initialized lazily by initSuggestionTabWatcher() to avoid circular imports.
let _tabWatcherInitialized = false;
let _prevActiveTabIds: Record<string, string | null> = {};

/**
 * Reset module-level singletons and store state.
 * For use in tests only — ensures a clean slate between test runs.
 */
export function resetAiSuggestionStore(): void {
  suggestionCounter = 0;
  _tabWatcherInitialized = false;
  _prevActiveTabIds = {};
  useAiSuggestionStore.setState({ suggestions: new Map(), focusedSuggestionId: null });
}

/** Start watching for tab changes. Call once at app startup. */
export function initSuggestionTabWatcher(
  tabStoreSubscribe: (cb: (state: { activeTabId: Record<string, string | null> }) => void) => () => void
): void {
  if (_tabWatcherInitialized) return;
  _tabWatcherInitialized = true;

  tabStoreSubscribe((state) => {
    // Clear suggestions scoped to the previous tab when any window switches tabs.
    // This avoids wiping suggestions that belong to a different window's active tab.
    for (const [label, tabId] of Object.entries(state.activeTabId)) {
      const prevTabId = _prevActiveTabIds[label] ?? null;
      if (prevTabId !== null && tabId !== prevTabId) {
        useAiSuggestionStore.getState().clearForTab(prevTabId);
      }
    }
    _prevActiveTabIds = { ...state.activeTabId };
  });
}
