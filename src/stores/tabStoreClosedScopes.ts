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
import { onInstanceRekeyed } from "./instanceRekeyBus";
import { useSettingsStore } from "./settingsStore";
import { useWorkspaceInstancesStore } from "./workspaceInstancesStore";
import {
  BROWSER_SCOPE,
  partitionWindowTabs,
} from "@/services/workspaces/workspaceOwnershipKernel";
import {
  isValidClosedEntry,
  normalizeAcceptedEntry,
  type ClosedTabEntry,
} from "./tabStoreClosedScopesValidation";

export type { ClosedTabEntry } from "./tabStoreClosedScopesValidation";

/** Scope for closed tabs with no owning instance (incl. rail-off mode). */
export const WINDOW_ALL_SCOPE = "window:all" as const;

const MAX_PER_SCOPE = 10;

/** Hydrated closedSeq values need increment headroom — see audit #14. */
const SAFE_SEQ_HEADROOM = Number.MAX_SAFE_INTEGER - 1_000_000;


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
  /** Drop ONE scope's closed history (WI-TS2.3): called when its workspace
   *  instance leaves the window (close/move) — without this, per-instance
   *  scopes leaked forever (removeWindowClosedScopes has no per-instance
   *  counterpart and zero production callers). */
  removeClosedScope: (windowLabel: string, scopeKey: string) => void;
  /** Follow a loose-instance identity re-key (audit 20260831 #9): merge the
   *  old scope's history into the new key, newest-first, capped. Without
   *  this the reopen history was orphaned under an id nothing reads. */
  rekeyClosedScope: (windowLabel: string, oldId: string, newId: string) => void;
  removeWindowClosedScopes: (windowLabel: string) => void;
  /** WI-9.4: rehydrate a window's scopes from a hot-exit payload (validated). */
  hydrateWindowClosedScopes: (
    windowLabel: string,
    scopes: Record<string, unknown>,
  ) => void;
  resetClosedScopes: () => void;
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
  // Fallback for an unowned tab: the ACTIVE instance's scope — unless that
  // instance is a placeholder (R2-8, audit round 2). A placeholder is evicted
  // the moment a real workspace arrives, and removeClosedScope drops its
  // history with it, so recording under a placeholder id orphans the entry.
  // WINDOW_ALL_SCOPE is the reachable home for ownerless history.
  const activeId = windowState?.activeWorkspaceInstanceId ?? null;
  const activeRecord = activeId ? state.instances[activeId] : undefined;
  const activeScope =
    activeRecord && activeRecord.kind !== "placeholder" ? activeId : null;
  return ownerOf.get(tab.id) ?? activeScope ?? WINDOW_ALL_SCOPE;
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
      // Scope keys are whitelisted (R3-4): the two well-known scopes, or a
      // workspace instance THIS window actually has. Instances hydrate before
      // closed scopes in the restore sequence (instanceContextState.ts, the
      // same ordering R2-F16's instance-ui whitelist relies on), so a key
      // this rejects is junk or cross-window — history nothing could ever
      // reopen, retained and re-persisted forever.
      const windowInstanceIds = new Set(
        useWorkspaceInstancesStore.getState().windows[windowLabel]
          ?.workspaceInstanceIds ?? [],
      );
      for (const [scopeKey, rawEntries] of Object.entries(scopes)) {
        if (!Array.isArray(rawEntries)) continue;
        if (
          scopeKey !== WINDOW_ALL_SCOPE &&
          scopeKey !== BROWSER_SCOPE &&
          !windowInstanceIds.has(scopeKey)
        ) {
          continue;
        }
        const candidates = rawEntries
          .filter((raw): raw is ClosedTabEntry => isValidClosedEntry(raw, scopeKey))
          // A closedSeq at the integer ceiling would break the monotonic
          // nextSeq derived below (audit 20260831 #14) — reject entries with
          // no increment headroom rather than corrupt ordering forever.
          .filter((entry) => entry.closedSeq < SAFE_SEQ_HEADROOM)
          // The store contract is newest-first; a reordered persisted payload
          // must not decide which entries survive the cap (audit #13).
          .sort((a, b) => b.closedSeq - a.closedSeq);
        // One scope per id across the whole payload (exclusivity) — marked at
        // ACCEPTANCE, not while filtering (R2-9, audit round 2): an id whose
        // only occurrence in this scope falls beyond the cap must not be
        // suppressed from every later scope by an entry that never survived.
        const entries: ClosedTabEntry[] = [];
        for (const entry of candidates) {
          if (entries.length >= MAX_PER_SCOPE) break;
          if (seenIds.has(entry.tab.id)) continue;
          seenIds.add(entry.tab.id);
          entries.push(normalizeAcceptedEntry(entry));
        }
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

  removeClosedScope: (windowLabel, scopeKey) =>
    set((state) => {
      const windowScopes = state.scopesByWindow[windowLabel];
      if (!windowScopes || !(scopeKey in windowScopes)) return {};
      const { [scopeKey]: _removed, ...rest } = windowScopes;
      return {
        scopesByWindow: { ...state.scopesByWindow, [windowLabel]: rest },
      };
    }),

  rekeyClosedScope: (windowLabel, oldId, newId) =>
    set((state) => {
      const windowScopes = state.scopesByWindow[windowLabel];
      const oldEntries = windowScopes?.[oldId];
      if (!windowScopes || !oldEntries) return {};
      const { [oldId]: _moved, ...rest } = windowScopes;
      const merged = [...(rest[newId] ?? []), ...oldEntries]
        .sort((a, b) => b.closedSeq - a.closedSeq)
        .slice(0, MAX_PER_SCOPE);
      return {
        scopesByWindow: {
          ...state.scopesByWindow,
          [windowLabel]: { ...rest, [newId]: merged },
        },
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

// A loose-instance identity re-key must carry its reopen history with it
// (audit 20260831 #9) — bus-driven because this store imports the instances
// store, so a direct call back would be an import cycle.
onInstanceRekeyed((windowLabel, oldId, newId) => {
  useClosedTabScopesStore.getState().rekeyClosedScope(windowLabel, oldId, newId);
});
