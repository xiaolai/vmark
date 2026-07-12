/**
 * Browser automation lease — AI vs human arbitration (WI-1.9 / R11).
 *
 * Purpose: a single lease per browser tab that decides who is allowed to drive
 * the page — the AI or the human — plus a per-tab navigation generation used to
 * reject stale driver commands. This is the correctness rule that separates "the
 * AI clicked Publish" from "the AI clicked Publish on a page the human had
 * already navigated away from" (Codex D2-8).
 *
 * Rules encoded here (all unit-tested; the native side wires the real event
 * sources in WI-1.2/1.8):
 *   - Human input ALWAYS reclaims the lease (`reclaimForHuman`), immediately and
 *     unconditionally — the AI can only acquire a *free* tab.
 *   - Every driver command carries an envelope `{holder, generation}`. `validate`
 *     rejects it as `lease-lost` if the tab's holder changed, or `stale` if the
 *     page navigated since the command was issued (generation bumped).
 *   - Reclaiming and navigating both cancel the AI's in-flight step via a
 *     registered canceller, and the canceller fires at most once.
 *
 * The watchdog rule this supports (WI-1.8): an eval timeout abandons the *result*;
 * a late result must never be applied to a page that has since navigated — the
 * generation check is what enforces that.
 *
 * @coordinates-with (future) src-tauri driver command envelope — carries holder+generation
 * @coordinates-with (future) browser tab chrome — subscribes to render the "AI is controlling" state
 * @module services/browser/lease
 */

import { create } from "zustand";

/** Who holds a tab's automation lease. */
export type LeaseHolder = "ai" | "human";

/** Outcome of validating a driver-command envelope against the current lease. */
export type LeaseValidation = "ok" | "lease-lost" | "stale";

interface TabLease {
  holder: LeaseHolder | null;
  /** Navigation generation; bumped on navigation and on human reclaim. */
  generation: number;
}

interface LeaseState {
  /** Per-tab lease record, keyed by browser tab id. */
  leases: Record<string, TabLease>;
  /** Per-tab canceller for the AI's in-flight driver step, if any. */
  inflightCancel: Record<string, (() => void) | undefined>;
}

interface LeaseActions {
  /** AI requests control. Succeeds only if the tab is free or already AI-held
   *  (a human holder always wins). Returns whether the AI now holds the lease. */
  acquireForAi: (tabId: string) => boolean;
  /** Human input reclaims the lease unconditionally: bumps the generation and
   *  cancels the AI's in-flight step. Always succeeds. */
  reclaimForHuman: (tabId: string) => void;
  /** Release the lease if (and only if) `holder` currently holds it. */
  release: (tabId: string, holder: LeaseHolder) => void;
  /** A navigation occurred: bump the generation (invalidating in-flight AI
   *  commands) and cancel the AI's in-flight step. */
  bumpGeneration: (tabId: string) => void;
  /** Register (or clear, with `null`) the canceller for the AI's in-flight step. */
  setInflightCancel: (tabId: string, cancel: (() => void) | null) => void;
  /** Validate a driver-command envelope against the current lease. */
  validate: (tabId: string, holder: LeaseHolder, generation: number) => LeaseValidation;
  /** Current lease holder for `tabId`, or null when free/unknown. */
  currentHolder: (tabId: string) => LeaseHolder | null;
  /** Current navigation generation for `tabId` (0 when unknown). */
  generationOf: (tabId: string) => number;
  /** Drop all lease + in-flight state for a closed tab. */
  removeTab: (tabId: string) => void;
}

const EMPTY_LEASE: TabLease = { holder: null, generation: 0 };

/** Fire and clear a tab's in-flight canceller (idempotent). Returns the next
 *  `inflightCancel` map with that entry removed. */
function fireCancel(
  inflight: Record<string, (() => void) | undefined>,
  tabId: string,
): Record<string, (() => void) | undefined> {
  const cancel = inflight[tabId];
  if (!cancel) return inflight;
  cancel();
  const next = { ...inflight };
  delete next[tabId];
  return next;
}

/** Manages the per-tab automation lease (R11). Use selectors, not destructuring. */
export const useBrowserLeaseStore = create<LeaseState & LeaseActions>((set, get) => ({
  leases: {},
  inflightCancel: {},

  acquireForAi: (tabId) => {
    const lease = get().leases[tabId] ?? EMPTY_LEASE;
    if (lease.holder === "human") return false;
    set((state) => ({
      leases: { ...state.leases, [tabId]: { ...lease, holder: "ai" } },
    }));
    return true;
  },

  reclaimForHuman: (tabId) => {
    set((state) => {
      const lease = state.leases[tabId] ?? EMPTY_LEASE;
      return {
        leases: { ...state.leases, [tabId]: { holder: "human", generation: lease.generation + 1 } },
        inflightCancel: fireCancel(state.inflightCancel, tabId),
      };
    });
  },

  release: (tabId, holder) => {
    set((state) => {
      const lease = state.leases[tabId];
      if (!lease || lease.holder !== holder) return state;
      return { leases: { ...state.leases, [tabId]: { ...lease, holder: null } } };
    });
  },

  bumpGeneration: (tabId) => {
    set((state) => {
      const lease = state.leases[tabId] ?? EMPTY_LEASE;
      return {
        leases: { ...state.leases, [tabId]: { ...lease, generation: lease.generation + 1 } },
        inflightCancel: fireCancel(state.inflightCancel, tabId),
      };
    });
  },

  setInflightCancel: (tabId, cancel) => {
    set((state) => {
      const next = { ...state.inflightCancel };
      if (cancel) next[tabId] = cancel;
      else delete next[tabId];
      return { inflightCancel: next };
    });
  },

  validate: (tabId, holder, generation) => {
    const lease = get().leases[tabId];
    if (!lease || lease.holder !== holder) return "lease-lost";
    if (lease.generation !== generation) return "stale";
    return "ok";
  },

  currentHolder: (tabId) => get().leases[tabId]?.holder ?? null,

  generationOf: (tabId) => get().leases[tabId]?.generation ?? 0,

  removeTab: (tabId) => {
    set((state) => {
      const leases = { ...state.leases };
      const inflightCancel = { ...state.inflightCancel };
      delete leases[tabId];
      delete inflightCancel[tabId];
      return { leases, inflightCancel };
    });
  },
}));
