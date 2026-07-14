/**
 * Browser automation lease — AI vs human arbitration (WI-1.9 / R11).
 *
 * Purpose: a single lease per browser tab that decides who is allowed to drive
 * the page — the AI or the human — plus a per-tab navigation generation used to
 * reject stale driver commands. This is the correctness rule that separates "the
 * AI clicked Publish" from "the AI clicked Publish on a page the human had
 * already navigated away from" (Codex D2-8).
 *
 * ⚠️ **NOT WIRED. This module has no production importers.** `browser.ts` (the MCP bridge)
 * neither acquires nor validates a lease, and nothing calls `reclaimForHuman`, so none of
 * the guarantees below are in force today. The rules are correct and unit-tested; they are
 * simply not connected to anything, which makes this a specification, not a control.
 *
 * That distinction is the point. A security control that is written, tested and documented
 * but never called reads as done and protects nothing — the same failure as the R7a
 * same-document callback that named a selector WebKit never invokes (WI-S0.11). Wiring it
 * is tracked in the plan; until then, do not cite this file as a reason an action is safe.
 *
 * Rules encoded here (all unit-tested; the native side wires the real event
 * sources in WI-1.2/1.8):
 *   - Human input ALWAYS reclaims the lease (`reclaimForHuman`), immediately and
 *     unconditionally — the AI can only acquire a *free* tab.
 *   - Every driver command carries an envelope `{holder, generation}`. `validate`
 *     rejects it as `lease-lost` if the tab's holder changed, or `stale` if the
 *     page navigated since the command was issued (generation bumped).
 *   - Every transition that ends the AI's authority over the current page —
 *     reclaim, navigation, release, tab close — cancels its in-flight step via
 *     the registered canceller, which fires at most once. A canceller may only
 *     be registered while the AI holds the lease, so a late registration cannot
 *     re-install an operation a reclaim just cancelled.
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
import { browserWarn } from "@/utils/debug";

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

/**
 * Run a canceller. Called only OUTSIDE a `set` updater: a canceller is foreign
 * code (it aborts a driver step), so it may throw or re-enter the store. Running
 * it inside the updater would let a throw abort the lease transition — human
 * reclaim is unconditional and must land regardless — and let a re-entrant write
 * be silently overwritten by the outer update.
 */
function runCancel(cancel: (() => void) | undefined): void {
  if (!cancel) return;
  try {
    cancel();
  } catch (error) {
    browserWarn("browser lease: in-flight canceller threw; the transition still stands", error);
  }
}

/** Manages the per-tab automation lease (R11). Use selectors, not destructuring. */
export const useBrowserLeaseStore = create<LeaseState & LeaseActions>((set, get) => {
  /** Detach the tab's in-flight canceller and return it (so it fires at most
   *  once — the state is committed before the callback runs). */
  const detachCancel = (tabId: string): (() => void) | undefined => {
    const cancel = get().inflightCancel[tabId];
    if (!cancel) return undefined;
    set((state) => {
      const inflightCancel = { ...state.inflightCancel };
      delete inflightCancel[tabId];
      return { inflightCancel };
    });
    return cancel;
  };

  /**
   * The one invalidation transition shared by human reclaim and navigation:
   * detach the in-flight canceller, bump the generation (invalidating every
   * outstanding AI envelope), optionally move the holder, then fire the
   * canceller against the already-committed state.
   */
  const invalidate = (tabId: string, holder: LeaseHolder | "keep"): void => {
    const cancel = detachCancel(tabId);
    set((state) => {
      const lease = state.leases[tabId] ?? EMPTY_LEASE;
      return {
        leases: {
          ...state.leases,
          [tabId]: {
            holder: holder === "keep" ? lease.holder : holder,
            generation: lease.generation + 1,
          },
        },
      };
    });
    runCancel(cancel);
  };

  return {
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

    reclaimForHuman: (tabId) => invalidate(tabId, "human"),

    bumpGeneration: (tabId) => invalidate(tabId, "keep"),

    release: (tabId, holder) => {
      const lease = get().leases[tabId];
      if (!lease || lease.holder !== holder) return;
      // No lease → no in-flight AI step: releasing must not leave a driver
      // operation running (or a stale canceller a later reclaim would fire).
      const cancel = detachCancel(tabId);
      set((state) => {
        const current = state.leases[tabId];
        if (!current || current.holder !== holder) return state;
        return { leases: { ...state.leases, [tabId]: { ...current, holder: null } } };
      });
      runCancel(cancel);
    },

    setInflightCancel: (tabId, cancel) => {
      // Only the AI holds in-flight steps, and only one per tab. A registration
      // that lands after a human reclaim would otherwise re-install the very
      // operation the reclaim just cancelled — refuse it and cancel it at once.
      if (cancel && get().leases[tabId]?.holder !== "ai") {
        runCancel(cancel);
        return;
      }
      const previous = get().inflightCancel[tabId];
      set((state) => {
        const next = { ...state.inflightCancel };
        if (cancel) next[tabId] = cancel;
        else delete next[tabId];
        return { inflightCancel: next };
      });
      // Replacing a live canceller abandons its step — cancel it, never orphan it.
      // Clearing with `null` means the step completed on its own: nothing to cancel.
      if (cancel && previous && previous !== cancel) runCancel(previous);
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
      // The surface is gone: an in-flight step would act on a destroyed webview
      // (or, worse, a reused tab id) — cancel it as part of the teardown.
      const cancel = detachCancel(tabId);
      set((state) => {
        const leases = { ...state.leases };
        const inflightCancel = { ...state.inflightCancel };
        delete leases[tabId];
        delete inflightCancel[tabId];
        return { leases, inflightCancel };
      });
      runCancel(cancel);
    },
  };
});
