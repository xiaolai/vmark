/**
 * Large-file session state — tracks which tabs were auto-opened in Source
 * mode because the file exceeded the WYSIWYG threshold. Used to prevent
 * unintended mode flips during the session.
 *
 * @module stores/documentStore/largeFileSession
 */

import { create } from "zustand";

interface LargeFileSessionState {
  /** Tab IDs that were auto-opened in Source mode because of size. */
  forcedSourceTabs: Record<string, true>;
  markForcedSource: (tabId: string) => void;
  clearForcedSource: (tabId: string) => void;
  isForcedSource: (tabId: string) => boolean;
}

export const useLargeFileSessionStore = create<LargeFileSessionState>((set, get) => ({
  forcedSourceTabs: {},
  markForcedSource: (tabId) =>
    set((state) => ({ forcedSourceTabs: { ...state.forcedSourceTabs, [tabId]: true } })),
  clearForcedSource: (tabId) =>
    set((state) => {
      if (!state.forcedSourceTabs[tabId]) return state;
      const next = { ...state.forcedSourceTabs };
      delete next[tabId];
      return { forcedSourceTabs: next };
    }),
  isForcedSource: (tabId) => Boolean(get().forcedSourceTabs[tabId]),
}));
