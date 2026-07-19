/**
 * Claim panel state (WI-2b.6) — mirror of the Rust claim listing plus
 * panel UI state. Never persisted: the ledger is the source of truth;
 * rows are refreshed on demand (pull, like the breakdown).
 *
 * @coordinates-with services/claims/claimService.ts — the IPC seam
 * @module stores/claimStore
 */
import { create } from "zustand";

/** Mirror of the Rust `ClaimRow` (camelCase — serde rename_all). */
export interface ClaimRow {
  claim: string;
  entryId: string;
  statement: string;
  maturity: "draft" | "established";
  invalidAt: string | null;
  /** Visible in the default context (D2.4). */
  visible: boolean;
}

interface ClaimState {
  rows: ClaimRow[];
  panelOpen: boolean;
  loading: boolean;
  error: string | null;
  /** Statement prefill handed over by extract-from-selection. */
  draftStatement: string | null;
  /** Source path for the pending extraction's provenance. */
  draftSourcePath: string | null;
  setRows: (rows: ClaimRow[]) => void;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setDraft: (statement: string | null, sourcePath: string | null) => void;
  reset: () => void;
}

export const useClaimStore = create<ClaimState>((set) => ({
  rows: [],
  panelOpen: false,
  loading: false,
  error: null,
  draftStatement: null,
  draftSourcePath: null,
  setRows: (rows) => set({ rows }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setDraft: (draftStatement, draftSourcePath) =>
    set({ draftStatement, draftSourcePath, panelOpen: true }),
  reset: () =>
    set({
      rows: [],
      panelOpen: false,
      loading: false,
      error: null,
      draftStatement: null,
      draftSourcePath: null,
    }),
}));
