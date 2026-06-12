/**
 * AI Suggestion store — pending AI suggestions for the editor.
 *
 * Tracks add/accept/reject/navigate lifecycle and emits CustomEvents so
 * the ProseMirror plugin can apply transactions before store mutation.
 *
 * @module stores/aiStore/suggestion
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
    /** Explicit whole-document replace marker (see AiSuggestion.wholeDoc). */
    wholeDoc?: boolean;
  }) => string;

  /** Accept a suggestion by ID. */
  acceptSuggestion: (id: string) => void;

  /** Reject a suggestion by ID. */
  rejectSuggestion: (id: string) => void;

  /** Remove a suggestion without dispatching accept/reject events. */
  removeSuggestion: (id: string) => void;

  /**
   * Batch-update suggestion ranges after a document change (position
   * remapping). A `null` range dismisses the suggestion — its target text
   * was edited or deleted, so the suggestion is stale. No accept/reject
   * events are dispatched.
   */
  updateSuggestionRanges: (
    updates: ReadonlyArray<{ id: string; range: { from: number; to: number } | null }>
  ) => void;

  /** Accept all pending suggestions. */
  acceptAll: () => void;

  /** Reject all pending suggestions. */
  rejectAll: () => void;

  /** Focus a specific suggestion. */
  focusSuggestion: (id: string | null) => void;

  /** Navigate to next suggestion. */
  navigateNext: () => void;

  /** Navigate to previous suggestion. */
  navigatePrevious: () => void;

  /** Get suggestions sorted by position. */
  getSortedSuggestions: () => AiSuggestion[];

  /** Get suggestion by ID. */
  getSuggestion: (id: string) => AiSuggestion | undefined;

  /** Clear suggestions for a specific tab (used on tab switch). */
  clearForTab: (tabId: string) => void;

  /** Clear all suggestions (used on document/tab change). */
  clearAll: () => void;
}

const initialSuggestionState: AiSuggestionState = {
  suggestions: new Map(),
  focusedSuggestionId: null,
};

let suggestionCounter = 0;

function generateSuggestionId(): string {
  return `ai-suggestion-${++suggestionCounter}-${Date.now()}`;
}

/** Delete a suggestion and update focus to the next available. */
function deleteAndUpdateFocus(state: AiSuggestionState, id: string): AiSuggestionState {
  const newSuggestions = new Map(state.suggestions);
  newSuggestions.delete(id);

  let newFocusedId: string | null = null;
  if (state.focusedSuggestionId === id && newSuggestions.size > 0) {
    const sorted = Array.from(newSuggestions.values()).sort(
      (a, b) => a.from - b.from
    );
    /* v8 ignore next -- @preserve sorted has at least one element because newSuggestions.size > 0 */
    newFocusedId = sorted[0]?.id ?? null;
  } else if (state.focusedSuggestionId !== id) {
    newFocusedId = state.focusedSuggestionId;
  }

  return {
    suggestions: newSuggestions,
    focusedSuggestionId: newFocusedId,
  };
}

/** Manages AI-generated content suggestions pending user approval. Use selectors, not destructuring. */
export const useAiSuggestionStore = create<AiSuggestionState & AiSuggestionActions>(
  (set, get) => ({
    ...initialSuggestionState,

    addSuggestion: (params) => {
      const id = generateSuggestionId();
      const suggestion: AiSuggestion = {
        id,
        tabId: params.tabId,
        type: params.type,
        wholeDoc: params.wholeDoc ?? false,
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

      window.dispatchEvent(
        new CustomEvent(AI_SUGGESTION_EVENTS.ACCEPT, { detail: { id, suggestion } })
      );

      set((state) => deleteAndUpdateFocus(state, id));
    },

    rejectSuggestion: (id) => {
      const suggestion = get().suggestions.get(id);
      if (!suggestion) return;

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

    updateSuggestionRanges: (updates) => {
      if (updates.length === 0) return;
      const { suggestions, focusedSuggestionId } = get();
      let changed = false;
      const next = new Map(suggestions);
      for (const { id, range } of updates) {
        const existing = next.get(id);
        if (!existing) continue;
        if (range === null) {
          next.delete(id);
          changed = true;
        } else if (range.from !== existing.from || range.to !== existing.to) {
          next.set(id, { ...existing, from: range.from, to: range.to });
          changed = true;
        }
      }
      if (!changed) return;
      let focusedId = focusedSuggestionId;
      if (focusedId && !next.has(focusedId)) {
        const sorted = Array.from(next.values()).sort((a, b) => a.from - b.from);
        focusedId = sorted[0]?.id ?? null;
      }
      set({ suggestions: next, focusedSuggestionId: focusedId });
    },

    acceptAll: () => {
      const sorted = get().getSortedSuggestions().reverse();
      if (sorted.length === 0) return;

      window.dispatchEvent(
        new CustomEvent(AI_SUGGESTION_EVENTS.ACCEPT_ALL, {
          detail: { suggestions: sorted },
        })
      );

      set({ suggestions: new Map(), focusedSuggestionId: null });
    },

    rejectAll: () => {
      const sorted = get().getSortedSuggestions().reverse();
      if (sorted.length === 0) return;

      window.dispatchEvent(
        new CustomEvent(AI_SUGGESTION_EVENTS.REJECT_ALL, {
          detail: { suggestions: sorted },
        })
      );

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
      /* v8 ignore next -- @preserve double-guard; suggestions.size > 0 guarantees getSortedSuggestions is non-empty */
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
      /* v8 ignore next -- @preserve double-guard; suggestions.size > 0 guarantees getSortedSuggestions is non-empty */
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

// Clear suggestions on tab switch — prevents stale suggestions mutating
// wrong document. Initialized lazily by initSuggestionTabWatcher() to
// avoid circular imports.
let _tabWatcherInitialized = false;
let _prevActiveTabIds: Record<string, string | null> = {};

/** Reset module-level singletons and store state. Test-only. */
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
    for (const [label, tabId] of Object.entries(state.activeTabId)) {
      const prevTabId = _prevActiveTabIds[label] ?? null;
      if (prevTabId !== null && tabId !== prevTabId) {
        useAiSuggestionStore.getState().clearForTab(prevTabId);
      }
    }
    _prevActiveTabIds = { ...state.activeTabId };
  });
}
