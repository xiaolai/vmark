/**
 * AI Suggestion Types
 *
 * Purpose: Shared type definitions and event name constants for the AI suggestion
 * approval system — used by the store, tiptap plugin, and MCP bridge.
 *
 * @coordinates-with tiptap.ts — consumes AiSuggestion for decoration rendering
 * @coordinates-with stores/aiSuggestionStore.ts — stores AiSuggestion instances
 * @module plugins/aiSuggestion/types
 */

/** The kind of modification an AI suggestion represents. */
export type SuggestionType = "insert" | "replace" | "delete";

/**
 * Event names for AI suggestion system.
 * Use these constants instead of magic strings.
 */
export const AI_SUGGESTION_EVENTS = {
  ADDED: "ai-suggestion:added",
  ACCEPT: "ai-suggestion:accept",
  REJECT: "ai-suggestion:reject",
  ACCEPT_ALL: "ai-suggestion:accept-all",
  REJECT_ALL: "ai-suggestion:reject-all",
  FOCUS_CHANGED: "ai-suggestion:focus-changed",
} as const;

export interface AiSuggestion {
  /** Unique identifier for this suggestion */
  id: string;
  /** Tab that owns this suggestion */
  tabId: string;
  /** Type of modification */
  type: SuggestionType;
  /** Start position in document */
  /**
   * Explicit whole-document marker. Accept clamps `to` to the live doc
   * size and edits never dismiss it. `from === 0` is NOT a safe sentinel —
   * a first-block suggestion legitimately starts at 0 (cross-model review
   * finding, audit 20260612 remediation).
   */
  wholeDoc?: boolean;
  from: number;
  /** End position in document */
  to: number;
  /** New content for insert/replace operations */
  newContent?: string;
  /** Original content for replace/delete operations (used to restore on reject) */
  originalContent?: string;
  /** Timestamp when suggestion was created */
  createdAt: number;
}

/**
 * The pending-suggestion registry this plugin decorates — the plugin's PORT.
 *
 * Declared here rather than imported from the app's AI store (ADR-015).
 * Suggestions are PRODUCED by the host — a model writes them — and this
 * plugin only paints them and applies the accept/reject the user chooses.
 * Deliberately narrower than the store: `addSuggestion`, `clearForTab` and
 * `getSortedSuggestions` are the producer's half and are not in the
 * painter's vocabulary.
 */
interface AiSuggestionPort {
  suggestions: Map<string, AiSuggestion>;
  focusedSuggestionId: string | null;
  acceptSuggestion: (id: string) => void;
  rejectSuggestion: (id: string) => void;
  removeSuggestion: (id: string) => void;
  updateSuggestionRanges: (
    updates: ReadonlyArray<{ id: string; range: { from: number; to: number } | null }>
  ) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  focusSuggestion: (id: string | null) => void;
  navigateNext: () => void;
  navigatePrevious: () => void;
  getSuggestion: (id: string) => AiSuggestion | undefined;
}

/** A store-like handle over that state. */
export interface AiSuggestionStore {
  getState: () => AiSuggestionPort;
  subscribe: (listener: () => void) => () => void;
}

export interface AiSuggestionOptions {
  /**
   * Required — a port gets no default.
   *
   * There is no honest stand-in for "the user's pending suggestions", so the
   * extension throws at wiring time rather than rendering an editor that
   * silently swallows every accept. That failure would look like a model bug
   * and be debugged in the wrong place.
   */
  store: AiSuggestionStore | null;
}

/** Read the wired store, or fail with a message that names the fix. */
export function requireSuggestionStore(store: AiSuggestionStore | null): AiSuggestionStore {
  if (!store) {
    throw new Error(
      "aiSuggestionExtension requires a `store` option — configure it with the host's suggestion store."
    );
  }
  return store;
}
