/**
 * Large File Session Store
 *
 * Purpose: Tracks which tabs were auto-routed to Source mode because of a
 * large-file open. Lets the StatusBar offer an explicit "Switch to WYSIWYG"
 * upgrade only on those tabs.
 *
 * Scope is deliberately per-session (in-memory). Reopening the file starts
 * fresh from the size-tier decision; we do not persist a per-file override
 * because user intent can change across sessions.
 *
 * @coordinates-with hooks/useFileOpen.ts — marks the tab on size-based routing.
 * @coordinates-with hooks/useFinderFileOpen.ts — marks tabs opened from Finder.
 * @coordinates-with components/StatusBar/SourceModeUpgrade.tsx — reads the marker.
 * @module stores/largeFileSessionStore
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
