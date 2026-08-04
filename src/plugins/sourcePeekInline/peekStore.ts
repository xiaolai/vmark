/**
 * Purpose: the Source Peek state this plugin drives — its PORT and binder.
 *
 * A binder rather than an extension option, unusually, and for a concrete
 * reason: `sourcePeekActions` exports plain functions that the editor KEYMAP
 * calls (`openSourcePeekInline`, `revertAndCloseSourcePeek`,
 * `isSourcePeekOpen`), several call frames from any extension. Threading a
 * store parameter through all of them would push this plugin's state into the
 * keymap's signature, which is the coupling moved rather than removed.
 *
 * The default is NOT a stub: it is a working in-memory peek state, the same
 * shape the app's store implements. That is the right default here because
 * `isOpen` is read on every decoration pass — a throw would make any editor
 * built without the app's assembly unusable, and "no peek is open" is an
 * honest answer for a standalone plugin. The app still overrides it, so its
 * React chrome and the plugin observe one state rather than two.
 *
 * @coordinates-with plugins/sourcePeekInline/sourcePeekActions.ts — the reader
 * @coordinates-with services/assembly/bindHostSettings.ts — the app's binding
 * @module plugins/sourcePeekInline/peekStore
 */

import type { StoreApi } from "zustand";

/** Where in the document a peek is editing. */
interface SourcePeekRange {
  from: number;
  to: number;
}

/** The peek state, as the plugin declares it. */
interface SourcePeekState {
  isOpen: boolean;
  range: SourcePeekRange | null;
  markdown: string;
  /** The content captured at open — the REVERT target, never rebaselined. */
  originalMarkdown: string | null;
  /**
   * The last-saved content — the DIRTY-CHECK baseline.
   *
   * Distinct from `originalMarkdown` on purpose: `markSaved` moves this one
   * so the unsaved-changes flag re-baselines, while the revert target stays
   * where the peek opened. Conflating the two makes `hasUnsavedChanges` wrong
   * after the first save.
   */
  savedMarkdown: string | null;
  parseError: string | null;
  livePreview: boolean;
  hasUnsavedChanges: boolean;
  blockTypeName: string | null;
  open: (payload: { markdown: string; range: SourcePeekRange; blockTypeName?: string }) => void;
  close: () => void;
  setMarkdown: (markdown: string) => void;
  setParseError: (error: string | null) => void;
  toggleLivePreview: () => void;
  markSaved: () => void;
}

/** A store over that state, including the `setState` the range-remap needs. */
export type SourcePeekStore = StoreApi<SourcePeekState>;

const CLOSED = {
  isOpen: false,
  range: null,
  markdown: "",
  originalMarkdown: null,
  savedMarkdown: null,
  parseError: null,
  livePreview: false,
  hasUnsavedChanges: false,
  blockTypeName: null,
} satisfies Omit<
  SourcePeekState,
  "open" | "close" | "setMarkdown" | "setParseError" | "toggleLivePreview" | "markSaved"
>;

/** A standalone peek state — the whole implementation, not a stub. */
function createStandalonePeekStore(): SourcePeekStore {
  let state: SourcePeekState;
  const listeners = new Set<(s: SourcePeekState, prev: SourcePeekState) => void>();
  const set = (patch: Partial<SourcePeekState>) => {
    const prev = state;
    state = { ...state, ...patch };
    for (const l of listeners) l(state, prev);
  };
  state = {
    ...CLOSED,
    // Each action mirrors its counterpart in `stores/sourcePeekStore.ts`
    // field for field. Any divergence here is a bug: the same plugin code runs
    // against both, so they must be indistinguishable.
    open: ({ markdown, range, blockTypeName }) =>
      set({
        // Spread CLOSED first, mirroring the app's `...initialSourcePeek`: a
        // reopen must not inherit the previous session's live-preview mode.
        ...CLOSED,
        isOpen: true,
        markdown,
        range,
        blockTypeName: blockTypeName ?? null,
        originalMarkdown: markdown,
        savedMarkdown: markdown,
        parseError: null,
        hasUnsavedChanges: false,
      }),
    close: () => set({ ...CLOSED }),
    setMarkdown: (markdown) =>
      set({
        markdown,
        // Against the SAVED baseline, not the revert target.
        hasUnsavedChanges: markdown !== state.savedMarkdown,
        parseError: null,
      }),
    setParseError: (parseError) => set({ parseError }),
    toggleLivePreview: () => set({ livePreview: !state.livePreview }),
    // Rebaselines the dirty check; `originalMarkdown` deliberately untouched.
    markSaved: () => set({ savedMarkdown: state.markdown, hasUnsavedChanges: false }),
  };
  return {
    getState: () => state,
    setState: (patch: Partial<SourcePeekState> | ((s: SourcePeekState) => Partial<SourcePeekState>)) =>
      set(typeof patch === "function" ? patch(state) : patch),
    subscribe: (listener: (s: SourcePeekState, prev: SourcePeekState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getInitialState: () => state,
  } as unknown as SourcePeekStore;
}

let bound: SourcePeekStore = createStandalonePeekStore();

/** Bind the host's peek state. Called once, at app startup. */
export function bindSourcePeekStore(store: SourcePeekStore): void {
  bound = store;
}

/** The bound peek state. */
export function peekStore(): SourcePeekStore {
  return bound;
}
