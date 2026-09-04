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
 * Every entry carries the page GENERATION it last accepted, and every mutator that
 * mirrors page state takes an optional generation stamp (audit round 3, #154). Nav
 * events cross the IPC boundary and can arrive out of order: a late `loaded` for a
 * page the tab has left used to rewrite the omnibox and the spinner, because only
 * the handler in `browserTabEvents` guarded it and only the tab record refused it.
 * The store now refuses a stamp OLDER than the entry's generation itself, whole,
 * and advances to a stamp that is current or newer. An UNSTAMPED call (a user
 * edit in the omnibox, a command's own error, a dialog) applies without moving the
 * generation — those are not page events and carry none.
 *
 * @coordinates-with services/browser/browserTabEvents — writes from nav events, stamped with the page generation
 * @coordinates-with components/Browser/BrowserOmnibox — reads for the active browser tab, writes unstamped edits
 * @coordinates-with services/browser/browserNavigation — updates urlInput/loading on navigate (unstamped)
 * @module stores/browserUiStore
 */
import { create } from "zustand";

/** How the native side is recovering from a content-process crash (WI-1.8):
 *  it is already reloading, or the user has to act. */
export type CrashAction = "auto-reload" | "manual";

/** A page JS dialog. Only a `confirm` can be answered, and answering needs the
 *  native completion-handler `id` — so the two travel together or not at all. */
export type BrowserDialog =
  | { kind: "alert"; message: string }
  | { kind: "confirm"; message: string; id: number };

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
  /**
   * The last failure on this tab, or null (WI-S0.9).
   *
   * Every browser command used to swallow its rejection (`.catch(() => {})`), so a
   * failed create or navigate produced a blank viewport and a stale address bar with
   * no signal whatsoever. Silence is the worst report available: the user cannot tell
   * a slow page from a dead one, and neither can a support thread.
   */
  error: string | null;
  /**
   * The last popup the page tried to open and VMark blocked (audit 2026-09-03
   * X-03), or null. `window.open` / `target=_blank` are refused by the UI
   * delegate; before this the URL was discarded with a debug log and neither the
   * user nor the AI learned that a click had led anywhere. The chrome offers to
   * open it as a new tab; an act that raised it reports it.
   */
  blockedPopup: { url: string; at: number } | null;
  /**
   * Non-null while a page JS dialog (`alert`/`confirm`) is open (WI-1.7). Held in
   * the store, not in the surface component (audit 2026-09-03): the event arrives
   * for whichever tab the page belongs to, mounted or not, and a `confirm()` parks
   * the page's JS until someone answers — so the tab is brought forward and the
   * surface renders the dialog from here when it mounts.
   */
  dialog: BrowserDialog | null;
  /** Non-null while the web content process is down (WI-1.8). Same reasoning. */
  crash: { action: CrashAction } | null;
  /**
   * The navigation generation of the newest page event this entry accepted
   * (audit round 3, #154). Monotonic: a stamped mutator older than this is refused
   * in the store, so a late event for a page the tab has left cannot rewrite the
   * omnibox, spinner, history flags, error, popup, dialog or crash state.
   */
  generation: number;
}

interface BrowserUiState {
  entries: Record<string, BrowserUiEntry>;
}

/**
 * The page generation a mutation is stamped with. Omit it for a change that is not
 * a page event (a user edit, a command's own failure, a dialog): it applies and
 * moves nothing. Supply it for one that is: it is refused when older than the
 * entry's generation and advances the entry otherwise.
 */
type Stamp = number | undefined;

interface BrowserUiActions {
  /** Seed a tab's entry on surface mount, at `generation` (0 when unknown). No-op if
   *  the tab already has one, so a StrictMode double-mount (or a late create) never
   *  resets live state. */
  ensureEntry: (tabId: string, initialUrl: string, generation?: number) => void;
  /** Set the address-bar text for a tab (guarded — no-op if the tab is unknown). */
  setUrlInput: (tabId: string, urlInput: string, generation?: Stamp) => void;
  /** Set the loading flag for a tab (guarded — no-op if the tab is unknown). */
  setLoading: (tabId: string, loading: boolean, generation?: Stamp) => void;
  /** Record the webview's back/forward-list state (guarded). Driven by the nav
   *  delegate, which reads it off the live WKWebView on every nav event. */
  setHistory: (tabId: string, canGoBack: boolean, canGoForward: boolean, generation?: Stamp) => void;
  /** Record whether the native view is hidden (guarded). Driven ONLY by
   *  `browserOcclusion`, which owns the occluder reference counts — not a page
   *  event, so it takes no stamp. */
  setFrozen: (tabId: string, frozen: boolean) => void;
  /** Record a failure (or clear it with null). Setting an error also stops the
   *  spinner — a load that died is not a load still running. Guarded. */
  setError: (tabId: string, error: string | null, generation?: Stamp) => void;
  /** Record (or clear with null) the last blocked popup for a tab (guarded). */
  setBlockedPopup: (tabId: string, popup: { url: string; at: number } | null, generation?: Stamp) => void;
  /** Record (or clear with null) the open page dialog for a tab (guarded). */
  setDialog: (tabId: string, dialog: BrowserDialog | null, generation?: Stamp) => void;
  /** Record (or clear with null) the crash state for a tab (guarded). */
  setCrash: (tabId: string, crash: { action: CrashAction } | null, generation?: Stamp) => void;
  /** Drop a tab's entry on close. */
  clearForTab: (tabId: string) => void;
}

/**
 * Guard a keyed update: no-op if the tab has no entry (convention §1), and no-op
 * if the update is stamped with a generation older than the entry's — the whole
 * patch describes a page the tab has left. A current or newer stamp is recorded.
 */
function updateEntry(
  state: BrowserUiState,
  tabId: string,
  generation: Stamp,
  updater: (entry: BrowserUiEntry) => BrowserUiEntry,
): BrowserUiState {
  // `hasOwn`: a tab id such as "constructor" or "toString" must not resolve an
  // inherited property into an entry.
  const entry = Object.hasOwn(state.entries, tabId) ? state.entries[tabId] : undefined;
  if (!entry) return state;
  if (generation !== undefined && generation < entry.generation) return state;
  const next = updater(entry);
  return {
    entries: {
      ...state.entries,
      [tabId]: generation === undefined ? next : { ...next, generation },
    },
  };
}

/** Holds transient browser nav UI state per tab. Use selectors, not destructuring. */
export const useBrowserUiStore = create<BrowserUiState & BrowserUiActions>((set) => ({
  entries: {},

  ensureEntry: (tabId, initialUrl, generation = 0) =>
    set((state) =>
      Object.hasOwn(state.entries, tabId)
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
                error: null,
                blockedPopup: null,
                dialog: null,
                crash: null,
                generation,
              },
            },
          },
    ),

  setUrlInput: (tabId, urlInput, generation) =>
    set((state) => updateEntry(state, tabId, generation, (e) => ({ ...e, urlInput }))),

  setLoading: (tabId, loading, generation) =>
    set((state) => updateEntry(state, tabId, generation, (e) => ({ ...e, loading }))),

  setHistory: (tabId, canGoBack, canGoForward, generation) =>
    set((state) => updateEntry(state, tabId, generation, (e) => ({ ...e, canGoBack, canGoForward }))),

  setFrozen: (tabId, frozen) =>
    set((state) => updateEntry(state, tabId, undefined, (e) => ({ ...e, frozen }))),

  setError: (tabId, error, generation) =>
    set((state) =>
      updateEntry(state, tabId, generation, (e) => ({
        ...e,
        error,
        // A failed load is not a loading one. Clearing this here means no caller can
        // forget to, and leave a spinner turning over a page that will never arrive.
        loading: error === null ? e.loading : false,
      })),
    ),

  setBlockedPopup: (tabId, popup, generation) =>
    set((state) => updateEntry(state, tabId, generation, (e) => ({ ...e, blockedPopup: popup }))),

  setDialog: (tabId, dialog, generation) =>
    set((state) => updateEntry(state, tabId, generation, (e) => ({ ...e, dialog }))),

  setCrash: (tabId, crash, generation) =>
    set((state) => updateEntry(state, tabId, generation, (e) => ({ ...e, crash }))),

  clearForTab: (tabId) =>
    set((state) => {
      if (!Object.hasOwn(state.entries, tabId)) return state;
      const { [tabId]: _removed, ...rest } = state.entries;
      return { entries: rest };
    }),
}));
