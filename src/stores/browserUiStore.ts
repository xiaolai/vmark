/**
 * browserUiStore — transient, per-tab browser navigation UI state (WI-S1.1 / ADR-5).
 *
 * The browser's address-bar text (`urlInput`) and `loading` flag used to live in
 * `BrowserSurface`'s local `useState`. Once the nav chrome moves into the bottom
 * `StatusBar` (ADR-4), two components need the same per-tab state without
 * prop-drilling across the shell: `BrowserSurface` (which owns the native webview
 * and receives nav-delegate events) writes it; the `StatusBar` omnibox reads it for
 * the active browser tab.
 *
 * This state is deliberately NOT persisted — `urlInput` is an in-progress edit and
 * `loading` is a live flag; the committed URL lives on the `BrowserTab` in
 * `tabStore`. Entries are seeded on surface mount and dropped on tab close.
 *
 * @coordinates-with components/Browser/BrowserSurface — writes from nav events, seeds on mount
 * @coordinates-with components/Browser/BrowserOmnibox — reads for the active browser tab
 * @coordinates-with services/browser/browserNavigation — updates urlInput/loading on navigate
 * @module stores/browserUiStore
 */
import { create } from "zustand";

/** Per-tab transient browser UI state. */
export interface BrowserUiEntry {
  /** The address-bar text — editable by the user, re-synced on navigation. */
  urlInput: string;
  /** True while a load is in flight (drives the reload↔stop control + spinner). */
  loading: boolean;
  /** WKWebView's back/forward-list state (WI-S1.6). The omnibox disables its
   *  history controls from these — without them they are no-op buttons. */
  canGoBack: boolean;
  canGoForward: boolean;
  /**
   * The native view is currently hidden by an occluder (WI-SOC.1b).
   *
   * Hiding it leaves a BLANK rect, which shows through a translucent backdrop or
   * beside a small popup. `BrowserSurface` paints an opaque placeholder while this
   * is true, so every overlay — translucent, partial or full — composites over a
   * real surface instead of a hole. This is what makes hide-only freeze correct
   * without a page snapshot.
   */
  frozen: boolean;
}

interface BrowserUiState {
  entries: Record<string, BrowserUiEntry>;
}

interface BrowserUiActions {
  /** Seed a tab's entry on surface mount. No-op if the tab already has one, so a
   *  StrictMode double-mount (or a late create) never resets live state. */
  ensureEntry: (tabId: string, initialUrl: string) => void;
  /** Set the address-bar text for a tab (guarded — no-op if the tab is unknown). */
  setUrlInput: (tabId: string, urlInput: string) => void;
  /** Set the loading flag for a tab (guarded — no-op if the tab is unknown). */
  setLoading: (tabId: string, loading: boolean) => void;
  /** Record the webview's back/forward-list state (guarded). Driven by the nav
   *  delegate, which reads it off the live WKWebView on every nav event. */
  setHistory: (tabId: string, canGoBack: boolean, canGoForward: boolean) => void;
  /** Record whether the native view is hidden (guarded). Driven ONLY by
   *  `browserOcclusion`, which owns the occluder reference counts. */
  setFrozen: (tabId: string, frozen: boolean) => void;
  /** Drop a tab's entry on close. */
  clearForTab: (tabId: string) => void;
}

/** Guard a keyed update: no-op if the tab has no entry (convention §1). */
function updateEntry(
  state: BrowserUiState,
  tabId: string,
  updater: (entry: BrowserUiEntry) => BrowserUiEntry,
): BrowserUiState {
  const entry = state.entries[tabId];
  if (!entry) return state;
  return { entries: { ...state.entries, [tabId]: updater(entry) } };
}

/** Holds transient browser nav UI state per tab. Use selectors, not destructuring. */
export const useBrowserUiStore = create<BrowserUiState & BrowserUiActions>((set) => ({
  entries: {},

  ensureEntry: (tabId, initialUrl) =>
    set((state) =>
      state.entries[tabId]
        ? state
        : {
            entries: {
              ...state.entries,
              // A fresh tab has no back/forward list yet.
              [tabId]: {
                urlInput: initialUrl,
                loading: true,
                canGoBack: false,
                canGoForward: false,
                frozen: false,
              },
            },
          },
    ),

  setUrlInput: (tabId, urlInput) =>
    set((state) => updateEntry(state, tabId, (e) => ({ ...e, urlInput }))),

  setLoading: (tabId, loading) =>
    set((state) => updateEntry(state, tabId, (e) => ({ ...e, loading }))),

  setHistory: (tabId, canGoBack, canGoForward) =>
    set((state) => updateEntry(state, tabId, (e) => ({ ...e, canGoBack, canGoForward }))),

  setFrozen: (tabId, frozen) =>
    set((state) => updateEntry(state, tabId, (e) => ({ ...e, frozen }))),

  clearForTab: (tabId) =>
    set((state) => {
      if (!state.entries[tabId]) return state;
      const { [tabId]: _removed, ...rest } = state.entries;
      return { entries: rest };
    }),
}));
