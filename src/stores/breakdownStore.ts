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
  /** Provenance confidence of the recording transformation (R28). */
  confidence: "exact" | "inferred" | "unknown";
  state: EdgeStateLabel;
  /** D3.4: historical waiver count on this edge ("previously waived xN"). */
  prior_waivers: number;
  /**
   * The downstream is FROZEN history — a finished record that later upstream
   * edits cannot invalidate, so it must not interrupt. Orthogonal to `state`,
   * which stays truthful about what the edge actually is.
   */
  frozen_downstream?: boolean;
  /**
   * How this edge's section anchor stands against the upstream's current text.
   * Absent when the edge is unanchored (whole-file behaviour, the default).
   */
  anchor_status?: "anchor-unchanged" | "anchor-changed" | "anchor-lost";
}

/** Mirror of the Rust `LogCheck` (coherence logbook). */
export interface LogCheck {
  time: string;
  verdict: string;
  confidence: number;
  /** What the model actually concluded when tau downgraded it to `unknown`. */
  downgradedVerdict?: string | null;
  downgradeReason?: string | null;
}

/** Mirror of the Rust `FlagJudgment` — the owner's M2 datum. */
export interface FlagJudgment {
  time: string;
  judgment: "relevant" | "noise" | "unsure";
  note: string;
}

/** Mirror of the Rust `LogEntry` — one edge's whole life. */
export interface LogEntry {
  txf: string;
  input: number;
  firstActivity: string;
  /** >1 means the edge REOPENED and was paid for again (the churn signal). */
  resolutions: number;
  lastResolution?: string | null;
  checks: LogCheck[];
  judgment?: FlagJudgment | null;
}

/** Mirror of the Rust `LogbookView`. */
export interface LogbookView {
  rows: LogEntry[];
  m2: { relevant: number; noise: number; unsure: number; unjudged: number };
  reopenedEdges: number;
}

/** Mirror of the Rust `ProvenanceCandidate` (WI-3.2). */
export interface ProvenanceCandidate {
  path: string;
  proposed: number;
}

/** Mirror of the Rust `ProposedInput` (WI-3.2). */
export interface ProposedInput {
  path: string;
  role: "direct" | "contextual";
}

/** Mirror of the Rust `DelegationRow` (WI-3.4). */
export interface DelegationRow {
  grant: string;
  delegate: string;
  scope: string[];
  expires: string;
}

/** Mirror of the Rust `MergeNotice` (WI-3.7). */
export interface MergeNotice {
  sha: string;
  time: string;
}

/** Mirror of the Rust `BranchCandidate` (WI-3.6). */
export interface BranchCandidate {
  branch: string;
  context: string | null;
  contextName: string | null;
  ambiguous: boolean;
}

/** Mirror of the Rust `ContextRow` (camelCase — serde rename_all). */
export interface ContextRow {
  id: string;
  name: string;
  parent: string | null;
  enforcement: "enforcing" | "greenhouse";
  visibleClaims: number;
  errors: string[];
}

interface BreakdownState {
  /** Rust-owned live rows — refreshed on demand, never persisted. */
  rows: EdgeRow[];
  /** Known contexts (WI-2b.7); the implicit default is always present. */
  contexts: ContextRow[];
  /** The context the breakdown projects; null = the implicit default. */
  selectedContext: string | null;
  /** Orphaned-but-recoverable artifacts (WI-3.2, pull-only). */
  provenance: ProvenanceCandidate[];
  /** Live agent delegations (WI-3.4). */
  delegations: DelegationRow[];
  /** Pull-only branch-context candidate for THIS branch (WI-3.6), or null. */
  branchCandidate: BranchCandidate | null;
  /** Latest completed-merge notice for the dismissible banner (WI-3.7). */
  mergeNotice: MergeNotice | null;
  /** Whether the Breakdown panel is open in THIS window. */
  panelOpen: boolean;
  /** A refresh is in flight. */
  loading: boolean;
  /** Last refresh/resolve failure, or null. */
  error: string | null;
  setRows: (rows: EdgeRow[]) => void;
  setContexts: (contexts: ContextRow[]) => void;
  setProvenance: (candidates: ProvenanceCandidate[]) => void;
  setDelegations: (rows: DelegationRow[]) => void;
  setBranchCandidate: (c: BranchCandidate | null) => void;
  setMergeNotice: (m: MergeNotice | null) => void;
  setSelectedContext: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  reset: () => void;
}

// No persistence (audit T17): `rows` is Rust-owned live data; `panelOpen`
// is per-window ephemeral UI state — a shared storage key would leak
// open-state across windows, and a pull-based panel has nothing worth
// resurrecting on reload.
export const useBreakdownStore = create<BreakdownState>()((set) => ({
  rows: [],
  contexts: [],
  selectedContext: null,
  provenance: [],
  delegations: [],
  branchCandidate: null,
  mergeNotice: null,
  panelOpen: false,
  loading: false,
  error: null,
  setRows: (rows) => set({ rows }),
  setContexts: (contexts) => set({ contexts }),
  setProvenance: (provenance) => set({ provenance }),
  setDelegations: (delegations) => set({ delegations }),
  setBranchCandidate: (branchCandidate) => set({ branchCandidate }),
  setMergeNotice: (mergeNotice) => set({ mergeNotice }),
  setSelectedContext: (selectedContext) => set({ selectedContext }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  reset: () =>
    set({
      rows: [],
      contexts: [],
      selectedContext: null,
      provenance: [],
      delegations: [],
      branchCandidate: null,
      mergeNotice: null,
      panelOpen: false,
      loading: false,
      error: null,
    }),
}));

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
