/**
 * Scoped closed-tab history (WI-11.1 / plan D4).
 *
 * Purpose: THE closed-tab metadata structure — replaces tabStore's old flat
 * per-window pool. Entries hold the full closed Tab plus a monotonic close
 * sequence, keyed by `scopeKey`:
 *   - a workspace instance id (rail on, document tabs),
 *   - `BROWSER_SCOPE` (browser tabs — window-global, plan D1),
 *   - `WINDOW_ALL_SCOPE` (rail off, or no owning instance).
 *
 * One cap policy (10) applies PER SCOPE, so an inactive workspace's history
 * cannot be evicted by closes in another workspace. Reopen (WI-11.2) compares
 * the active instance's head with the browser-global head by sequence.
 * Instance records' persisted `closedTabIds` derive from these scopes at
 * hot-exit capture — this store is the lookup structure, not the records.
 *
 * Fed by the tab-removal bus: reason "close" records; "detach" does not.
 *
 * @coordinates-with stores/tabRemovalBus.ts — close/detach events
 * @coordinates-with services/workspaces/workspaceOwnershipKernel.ts — scope resolution
 * @coordinates-with services/persistence/hotExit/workspaceInstances.ts — capture projection
 * @module stores/tabStoreClosedScopes
 */
import { create } from "zustand";
import type { Tab } from "@/stores/tabStoreTypes";
import { onTabRemoved } from "./tabRemovalBus";
import { useSettingsStore } from "./settingsStore";
import { useWorkspaceInstancesStore } from "./workspaceInstancesStore";
import {
  BROWSER_SCOPE,
  partitionWindowTabs,
} from "@/services/workspaces/workspaceOwnershipKernel";
import { canonicalizeBrowserUrl } from "@/lib/browser/url";

/** Scope for closed tabs with no owning instance (incl. rail-off mode). */
export const WINDOW_ALL_SCOPE = "window:all" as const;

const MAX_PER_SCOPE = 10;

export interface ClosedTabEntry {
  tab: Tab;
  /** Monotonic close order across ALL scopes of the app session. */
  closedSeq: number;
}

interface ClosedTabScopesState {
  /** windowLabel → scopeKey → entries, newest first. */
  scopesByWindow: Record<string, Record<string, ClosedTabEntry[]>>;
  nextSeq: number;
  recordClosedTab: (windowLabel: string, tab: Tab) => void;
  /** Remove and return a specific closed tab from a scope (reopen). */
  takeClosedTab: (windowLabel: string, scopeKey: string, tabId: string) => Tab | null;
  /** Newest entry across the given scopes, by close sequence. */
  newestEntry: (
    windowLabel: string,
    scopeKeys: readonly string[],
  ) => { scopeKey: string; entry: ClosedTabEntry } | null;
  closedIdsForScope: (windowLabel: string, scopeKey: string) => string[];
  removeWindowClosedScopes: (windowLabel: string) => void;
  /** WI-9.4: rehydrate a window's scopes from a hot-exit payload (validated). */
  hydrateWindowClosedScopes: (
    windowLabel: string,
    scopes: Record<string, unknown>,
  ) => void;
  resetClosedScopes: () => void;
}

/**
 * Shape guard for a persisted closed-tab entry (audit R2-F13/F14): per-kind
 * validation — a document needs a string-or-null filePath; a browser entry
 * needs a CANONICAL http(s) URL (the same gate the live browser applies), so
 * a hand-edited hot-exit payload can never smuggle `javascript:`/`file://`
 * into a later reopen. Kind/scope coherence is enforced at hydrate.
 */
function isValidClosedEntry(raw: unknown, scopeKey: string): raw is ClosedTabEntry {
  if (typeof raw !== "object" || raw === null) return false;
  const e = raw as {
    tab?: { id?: unknown; kind?: unknown; filePath?: unknown; url?: unknown };
    closedSeq?: unknown;
  };
  if (
    typeof e.closedSeq !== "number" ||
    !Number.isSafeInteger(e.closedSeq) ||
    e.closedSeq < 0 ||
    typeof e.tab !== "object" ||
    e.tab === null ||
    typeof e.tab.id !== "string"
  ) {
    return false;
  }
  if (e.tab.kind === "document") {
    // Documents never hydrate into the browser-global scope.
    if (scopeKey === BROWSER_SCOPE) return false;
    return e.tab.filePath === null || typeof e.tab.filePath === "string";
  }
  if (e.tab.kind === "browser") {
    // Browser entries ONLY in the browser-global scope, with a safe URL.
    if (scopeKey !== BROWSER_SCOPE) return false;
    return typeof e.tab.url === "string" && canonicalizeBrowserUrl(e.tab.url) !== null;
  }
  return false;
}

/** Resolve which scope a closing tab's history belongs to. */
function resolveScopeKey(windowLabel: string, tab: Tab): string {
  if (tab.kind === "browser") return BROWSER_SCOPE;
  const railEnabled =
    useSettingsStore.getState().general?.workspaceRailMode ?? false;
  if (!railEnabled) return WINDOW_ALL_SCOPE;

  const state = useWorkspaceInstancesStore.getState();
  const windowState = state.windows[windowLabel];
  const instances = (windowState?.workspaceInstanceIds ?? [])
    .map((id) => state.instances[id])
    .filter((instance): instance is NonNullable<typeof instance> => Boolean(instance));
  const { ownerOf } = partitionWindowTabs(
    [tab],
    instances,
    windowState?.activeWorkspaceInstanceId ?? null,
  );
  return (
    ownerOf.get(tab.id) ??
    windowState?.activeWorkspaceInstanceId ??
    WINDOW_ALL_SCOPE
  );
}

export const useClosedTabScopesStore = create<ClosedTabScopesState>()((set, get) => ({
  scopesByWindow: {},
  nextSeq: 1,

  recordClosedTab: (windowLabel, tab) =>
    set((state) => {
      const scopeKey = resolveScopeKey(windowLabel, tab);
      const windowScopes = state.scopesByWindow[windowLabel] ?? {};
      const entries = windowScopes[scopeKey] ?? [];
      const next = [{ tab, closedSeq: state.nextSeq }, ...entries].slice(0, MAX_PER_SCOPE);
      return {
        nextSeq: state.nextSeq + 1,
        scopesByWindow: {
          ...state.scopesByWindow,
          [windowLabel]: { ...windowScopes, [scopeKey]: next },
        },
      };
    }),

  takeClosedTab: (windowLabel, scopeKey, tabId) => {
    const entries = get().scopesByWindow[windowLabel]?.[scopeKey] ?? [];
    const found = entries.find((entry) => entry.tab.id === tabId);
    if (!found) return null;
    set((state) => {
      const windowScopes = state.scopesByWindow[windowLabel] ?? {};
      return {
        scopesByWindow: {
          ...state.scopesByWindow,
          [windowLabel]: {
            ...windowScopes,
            [scopeKey]: (windowScopes[scopeKey] ?? []).filter(
              (entry) => entry.tab.id !== tabId,
            ),
          },
        },
      };
    });
    return found.tab;
  },

  newestEntry: (windowLabel, scopeKeys) => {
    const windowScopes = get().scopesByWindow[windowLabel] ?? {};
    let best: { scopeKey: string; entry: ClosedTabEntry } | null = null;
    for (const scopeKey of scopeKeys) {
      const head = windowScopes[scopeKey]?.[0];
      if (head && (!best || head.closedSeq > best.entry.closedSeq)) {
        best = { scopeKey, entry: head };
      }
    }
    return best;
  },

  closedIdsForScope: (windowLabel, scopeKey) =>
    (get().scopesByWindow[windowLabel]?.[scopeKey] ?? []).map((entry) => entry.tab.id),

  hydrateWindowClosedScopes: (windowLabel, scopes) =>
    set((state) => {
      const valid: Record<string, ClosedTabEntry[]> = {};
      const seenIds = new Set<string>();
      let maxSeq = state.nextSeq - 1;
      for (const [scopeKey, rawEntries] of Object.entries(scopes)) {
        if (!Array.isArray(rawEntries)) continue;
        const entries = rawEntries
          .filter((raw): raw is ClosedTabEntry => isValidClosedEntry(raw, scopeKey))
          // One scope per id across the whole payload (exclusivity).
          .filter((entry) => !seenIds.has(entry.tab.id) && (seenIds.add(entry.tab.id), true))
          .slice(0, MAX_PER_SCOPE);
        if (entries.length === 0) continue;
        valid[scopeKey] = entries;
        for (const entry of entries) maxSeq = Math.max(maxSeq, entry.closedSeq);
      }
      // Audit R2-F15: hydration REPLACES the window's scopes — an empty or
      // wholly-invalid payload clears rather than leaking prior state.
      return {
        nextSeq: maxSeq + 1,
        scopesByWindow: { ...state.scopesByWindow, [windowLabel]: valid },
      };
    }),

  removeWindowClosedScopes: (windowLabel) =>
    set((state) => {
      if (!(windowLabel in state.scopesByWindow)) return {};
      const { [windowLabel]: _removed, ...rest } = state.scopesByWindow;
      return { scopesByWindow: rest };
    }),

  resetClosedScopes: () => set({ scopesByWindow: {}, nextSeq: 1 }),
}));

// Closed (not detached) tabs enter the scoped reopen history at the removal
// choke point — the same event every other tab-lifecycle store consumes.
onTabRemoved((windowLabel, _tabId, info) => {
  if (info?.reason === "close") {
    useClosedTabScopesStore.getState().recordClosedTab(windowLabel, info.tab);
  }
});
