/**
 * browserHistoryStore — per-window browsing history (WI-S2.2).
 *
 * "A visited list from nav events" is not a specification. It can mean commit history,
 * finish history, redirect history, or per-tab history, and each produces a visibly
 * different list (Codex v3, D4#1). So the schema and the reducer rules are written down
 * here, and `browserHistoryStore.test.ts` is their truth table.
 *
 * The rules, and why:
 *
 * - **A reload collapses.** It commits the same url again; appending would fill the list
 *   with one page.
 * - **A redirect folds into the entry it came from.** A chain commits every hop, but the
 *   user went to ONE place. The entry ends up naming where they landed while remembering
 *   how they set off (typed, not redirected) — the transition kind describes the user's
 *   intent, not the last mechanical step.
 * - **A revisit after leaving does NOT collapse.** Going back to a page you left is a
 *   real event in the story of a session, not a duplicate.
 * - **The title arrives late.** It comes on finish, after the commit that created the
 *   entry, so it is attached afterwards — and only if the tab is still on that url. A
 *   slow finish for a page you already left must not retitle the page you are on.
 * - **Capped.** A long session cannot grow without bound.
 *
 * **Session-only, deliberately.** A browsing history on disk is sensitive, and nothing
 * should make that decision by accident — persisting it is a separate, opt-in choice.
 * Per-window, because browser events are window-routed (ADR-6): one window's browsing is
 * not another window's business.
 *
 * @coordinates-with components/Browser/BrowserSurface — records commits + titles
 * @coordinates-with components/Browser/BrowserHistoryView — renders it
 * @module stores/browserHistoryStore
 */
import { create } from "zustand";

/** How the user got to a page. Describes *intent*, not the last mechanical hop. */
export type TransitionKind = "typed" | "link" | "reload" | "back-forward" | "redirect";

export interface HistoryEntry {
  id: string;
  tabId: string;
  url: string;
  /** Empty until the page finishes loading and reports one. */
  title: string;
  committedAt: number;
  transitionKind: TransitionKind;
}

/** A session's worth, not a lifetime's. Oldest are evicted. */
const MAX_ENTRIES = 200;

/** What a caller supplies; the store stamps the rest. */
export interface HistoryCommit {
  tabId: string;
  url: string;
  transitionKind: TransitionKind;
}

interface BrowserHistoryState {
  /** Newest first, per window. */
  byWindow: Record<string, HistoryEntry[]>;
}

interface BrowserHistoryActions {
  /** Record a committed navigation, applying the reducer rules above. */
  record: (windowLabel: string, commit: HistoryCommit) => void;
  /** Attach a title that arrived on load-finish, if the tab is still on that url. */
  setTitle: (windowLabel: string, tabId: string, url: string, title: string) => void;
  /** Drop a window's history. */
  clear: (windowLabel: string) => void;
}

let nextId = 0;
const makeId = () => `h${++nextId}`;

export const useBrowserHistoryStore = create<BrowserHistoryState & BrowserHistoryActions>(
  (set) => ({
    byWindow: {},

    record: (windowLabel, commit) =>
      set((state) => {
        const list = state.byWindow[windowLabel] ?? [];
        const head = list[0];
        const now = Date.now();

        // Same tab, and the head is the page we are committing again (a reload), or the
        // page we just redirected away from. Either way the user made ONE move.
        if (head && head.tabId === commit.tabId) {
          const isReload = head.url === commit.url;
          const isRedirect = commit.transitionKind === "redirect";
          if (isReload || isRedirect) {
            const merged: HistoryEntry = {
              ...head,
              // A redirect means the entry now names where we actually landed.
              url: commit.url,
              // ...but the transition still describes how the user set off. A redirect is
              // something the SITE did; it does not overwrite the user's intent.
              transitionKind: isRedirect ? head.transitionKind : commit.transitionKind,
              committedAt: now,
              // The url changed under it, so any title we had describes the old page.
              title: isRedirect && head.url !== commit.url ? "" : head.title,
            };
            return {
              byWindow: { ...state.byWindow, [windowLabel]: [merged, ...list.slice(1)] },
            };
          }
        }

        const entry: HistoryEntry = {
          id: makeId(),
          tabId: commit.tabId,
          url: commit.url,
          title: "",
          committedAt: now,
          transitionKind: commit.transitionKind,
        };
        return {
          byWindow: {
            ...state.byWindow,
            [windowLabel]: [entry, ...list].slice(0, MAX_ENTRIES),
          },
        };
      }),

    setTitle: (windowLabel, tabId, url, title) =>
      set((state) => {
        const list = state.byWindow[windowLabel];
        if (!list) return state;
        // The most recent entry for THIS tab AND this url. A finish event that arrives
        // after the tab moved on describes a page we already left, and must not retitle
        // the one we are on.
        const index = list.findIndex((e) => e.tabId === tabId && e.url === url);
        if (index === -1) return state;
        const next = [...list];
        next[index] = { ...next[index], title };
        return { byWindow: { ...state.byWindow, [windowLabel]: next } };
      }),

    clear: (windowLabel) =>
      set((state) => ({ byWindow: { ...state.byWindow, [windowLabel]: [] } })),
  }),
);
