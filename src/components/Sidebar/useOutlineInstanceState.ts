/**
 * useOutlineInstanceState (WI-9.3)
 *
 * Purpose: outline presentation state — collapsed heading keys, filter query,
 * scroll offset — held PER (workspace instance, tab) so it switches with the
 * workspace rail, with a local-state fallback (rail off / no tab) that is
 * behaviorally identical to the historical in-component useState.
 *
 * Key decisions:
 *   - Collapsed keys stay heading-identity strings (`level:line:text`), the
 *     same scheme OutlineView always used; `pruneCollapsedKeys` drops keys the
 *     current document no longer produces (edited/removed headings).
 *   - `activeHeadingLine` is deliberately NOT here — it is recomputed, never
 *     restored (plan D2).
 *   - Scroll writes are trailing-throttled like the file-tree adapter.
 *
 * @coordinates-with OutlineView.tsx — consumes this API
 * @coordinates-with stores/workspaceInstanceUiStore.ts — persisted branch
 * @module components/Sidebar/useOutlineInstanceState
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceInstanceUiStore } from "@/stores/workspaceInstanceUiStore";

const SCROLL_THROTTLE_MS = 150;

export interface OutlineStateApi {
  filterQuery: string;
  setFilterQuery: (query: string) => void;
  collapsedKeys: ReadonlySet<string>;
  toggleCollapsedKey: (key: string) => void;
  /** Drop collapsed keys the current document no longer produces. */
  pruneCollapsedKeys: (validKeys: ReadonlySet<string>) => void;
  /** Throttled scroll persistence (persisted mode only). */
  handleScroll: (scrollTop: number) => void;
  /** Restore the persisted scroll offset onto the outline scroller. */
  restoreScrollTo: (el: HTMLElement | null) => void;
}

export function useOutlineInstanceState(
  instanceId: string | null,
  tabId: string | null,
): OutlineStateApi {
  const persisted = Boolean(instanceId && tabId);

  // Persisted branch — reactive subscription to this (instance, tab) slice.
  const persistedState = useWorkspaceInstanceUiStore((state) =>
    persisted ? state.instanceUiStates[instanceId!]?.outlineByTabId[tabId!] : undefined,
  );

  // Fallback branch — plain local state (identical to pre-rail OutlineView).
  const [localFilter, setLocalFilter] = useState("");
  const [localCollapsed, setLocalCollapsed] = useState<Set<string>>(new Set());

  const filterQuery = persisted ? (persistedState?.filterQuery ?? "") : localFilter;

  const collapsedKeys = useMemo<ReadonlySet<string>>(
    () => (persisted ? new Set(persistedState?.collapsedKeys ?? []) : localCollapsed),
    [persisted, persistedState?.collapsedKeys, localCollapsed],
  );

  const setFilterQuery = useCallback(
    (query: string) => {
      if (persisted) {
        useWorkspaceInstanceUiStore
          .getState()
          .updateOutlineTabState(instanceId!, tabId!, { filterQuery: query });
      } else {
        setLocalFilter(query);
      }
    },
    [persisted, instanceId, tabId],
  );

  const toggleCollapsedKey = useCallback(
    (key: string) => {
      if (persisted) {
        const current = new Set(
          useWorkspaceInstanceUiStore.getState().getInstanceUiState(instanceId!)
            .outlineByTabId[tabId!]?.collapsedKeys ?? [],
        );
        if (current.has(key)) current.delete(key);
        else current.add(key);
        useWorkspaceInstanceUiStore
          .getState()
          .updateOutlineTabState(instanceId!, tabId!, { collapsedKeys: [...current] });
      } else {
        setLocalCollapsed((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
      }
    },
    [persisted, instanceId, tabId],
  );

  const pruneCollapsedKeys = useCallback(
    (validKeys: ReadonlySet<string>) => {
      if (persisted) {
        const current =
          useWorkspaceInstanceUiStore.getState().getInstanceUiState(instanceId!)
            .outlineByTabId[tabId!]?.collapsedKeys ?? [];
        const kept = current.filter((key) => validKeys.has(key));
        if (kept.length === current.length) return;
        useWorkspaceInstanceUiStore
          .getState()
          .updateOutlineTabState(instanceId!, tabId!, { collapsedKeys: kept });
      } else {
        setLocalCollapsed((prev) => {
          const kept = [...prev].filter((key) => validKeys.has(key));
          return kept.length === prev.size ? prev : new Set(kept);
        });
      }
    },
    [persisted, instanceId, tabId],
  );

  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScrollRef = useRef<number | null>(null);

  const handleScroll = useCallback(
    (scrollTop: number) => {
      if (!persisted) return;
      pendingScrollRef.current = scrollTop;
      if (scrollTimerRef.current) return;
      scrollTimerRef.current = setTimeout(() => {
        scrollTimerRef.current = null;
        const offset = pendingScrollRef.current;
        pendingScrollRef.current = null;
        if (offset === null || !Number.isFinite(offset)) return;
        useWorkspaceInstanceUiStore
          .getState()
          .updateOutlineTabState(instanceId!, tabId!, { scrollOffset: offset });
      }, SCROLL_THROTTLE_MS);
    },
    [persisted, instanceId, tabId],
  );

  useEffect(
    () => () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    },
    [],
  );

  const restoreScrollTo = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !persisted) return;
      const offset = useWorkspaceInstanceUiStore
        .getState()
        .getInstanceUiState(instanceId!).outlineByTabId[tabId!]?.scrollOffset;
      if (offset === undefined || !Number.isFinite(offset)) return;
      el.scrollTop = offset;
    },
    [persisted, instanceId, tabId],
  );

  return {
    filterQuery,
    setFilterQuery,
    collapsedKeys,
    toggleCollapsedKey,
    pruneCollapsedKeys,
    handleScroll,
    restoreScrollTo,
  };
}
