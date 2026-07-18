/**
 * Breakdown store (WI-1.9b).
 *
 * Holds the pull-based coherence breakdown: the live stale/diverged
 * dependency edges of the current workspace, as returned by the Rust
 * `coherence_breakdown` command. The data is owned by Rust
 * (`src-tauri/src/coherence`); this store is a passive mirror written by
 * `services/breakdown/breakdownService`. Components MUST use selectors.
 *
 * @coordinates-with src-tauri/src/coherence/index_query.rs — EdgeRow source of truth
 * @coordinates-with services/breakdown/breakdownService.ts — the only writer
 * @module stores/breakdownStore
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { createSafeStorage } from "@/services/persistence/safeStorage";

/**
 * Serialized edge states the breakdown lists (Rust `state_label`). The
 * breakdown never returns `fresh*` states — only live, non-fresh edges.
 */
export type EdgeStateLabel =
  | "version-stale"
  | "stale-valid"
  | "stale-contradicted"
  | "stale-unknown"
  | "waived"
  | "diverged"
  | "diverged-multi-head"
  | "unpinnable";

/** Mirror of the Rust `EdgeRow` (snake_case — serde default field names). */
export interface EdgeRow {
  txf: string;
  input: number;
  upstream: string;
  upstream_path: string | null;
  pinned: string;
  downstream: string;
  downstream_path: string | null;
  downstream_rev: string;
  state: EdgeStateLabel;
}

interface BreakdownState {
  /** Rust-owned live rows — refreshed on demand, never persisted. */
  rows: EdgeRow[];
  /** Whether the Breakdown panel is open in THIS window. */
  panelOpen: boolean;
  /** A refresh is in flight. */
  loading: boolean;
  /** Last refresh/resolve failure, or null. */
  error: string | null;
  setRows: (rows: EdgeRow[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  reset: () => void;
}

export const useBreakdownStore = create<BreakdownState>()(
  persist(
    (set) => ({
      rows: [],
      panelOpen: false,
      loading: false,
      error: null,
      setRows: (rows) => set({ rows }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
      setPanelOpen: (panelOpen) => set({ panelOpen }),
      reset: () => set({ rows: [], panelOpen: false, loading: false, error: null }),
    }),
    {
      name: "vmark-breakdown",
      storage: createJSONStorage(() => createSafeStorage()),
      // Persist ONLY the panel preference. `rows` is Rust-owned live data
      // re-fetched on every panel open — persisting it would resurrect a
      // stale snapshot on reload; loading/error are transient by nature.
      partialize: (s) => ({ panelOpen: s.panelOpen }),
    },
  ),
);

/* Selectors — components MUST use these (no store destructuring). */
export const selectRows = (s: BreakdownState): EdgeRow[] => s.rows;
export const selectPanelOpen = (s: BreakdownState): boolean => s.panelOpen;
export const selectLoading = (s: BreakdownState): boolean => s.loading;
export const selectError = (s: BreakdownState): string | null => s.error;

/** One artifact's group in the breakdown list. */
export interface BreakdownGroup {
  /** `downstream_path` when known, else the downstream object id. */
  artifact: string;
  rows: EdgeRow[];
}

/**
 * Pure grouping of edge rows by their downstream artifact, in
 * first-appearance order. Missing paths fall back to the object id so an
 * unregistered artifact still gets a stable, visible group key.
 */
export function selectRowsGroupedByArtifact(rows: EdgeRow[]): BreakdownGroup[] {
  const byArtifact = new Map<string, BreakdownGroup>();
  for (const row of rows) {
    const artifact = row.downstream_path ?? row.downstream;
    let group = byArtifact.get(artifact);
    if (!group) {
      group = { artifact, rows: [] };
      byArtifact.set(artifact, group);
    }
    group.rows.push(row);
  }
  return Array.from(byArtifact.values());
}
