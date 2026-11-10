/**
 * Browser automation lease — AI vs human arbitration (R11).
 *
 * Purpose: a single lease per browser tab deciding who drives the page — the AI
 * (a multi-step workflow run) or the human. WIRED: the workflow
 * runner acquires/releases it around a run, browser-chrome interaction and the
 * native page-input signal (`browser://user-input`) reclaim it for the human,
 * tab close clears it via `tabRemovalBus`, and the tab chrome renders the
 * "AI is controlling" state from `currentHolder`.
 *
 * The `epoch` is the TAKEOVER clock, and it moves ONLY on authority
 * transitions — reclaim and release — never on navigation. v1 of this module
 * bumped it on every navigation, which would have cancelled a workflow's own
 * `navigate to` steps (Codex review C3): per-page staleness is a DIFFERENT
 * clock, the driver's navigation generation, checked per act in Rust
 * (`authorize.rs`). One clock per question.
 *
 * Rules (all unit-tested):
 *   - Human input reclaims an AI-held lease immediately and unconditionally —
 *     the AI can only acquire a *free* tab. A human hold is the INTERRUPTION of an
 *     AI tenure, nothing more: reclaiming a tab the AI does not hold is a no-op, and
 *     the run service releases the hold (`release(tab, "human")`) when the
 *     interrupted run ends. It used to be permanent —
 *     nothing released it, so one accidental scroll refused every later
 *     `workflow_run` on that tab until it was closed.
 *   - A run's envelope carries `{holder, epoch}`. `validate` rejects it as
 *     `lease-lost` when the holder changed, `stale` when the epoch moved (the
 *     authority was reclaimed/released and re-granted since).
 *   - Every transition that ends the AI's authority — reclaim, release, tab
 *     close — cancels its in-flight step via the registered canceller, which
 *     fires at most once. A canceller may only be registered while the AI holds
 *     the lease, so a late registration cannot re-install an operation a
 *     reclaim just cancelled.
 *
 * The state arithmetic lives in `leaseTransitions.ts` as pure functions;
 * the state itself lives in `stores/browserLeaseStore.ts`, which holds data
 * only. This file owns SEQUENCING — record the new state first, run the canceller
 * after, outside any `set` — so it is the one writer of that store.
 *
 * @coordinates-with services/browser/leaseTransitions.ts — the pure transitions composed here
 * @coordinates-with stores/browserLeaseStore.ts — the state this service writes
 * @coordinates-with services/browser/browserLeaseWiring.ts — event sources (chrome, native input, tab close)
 * @coordinates-with components/Browser/BrowserChrome.tsx — renders the AI-control state
 * @module services/browser/lease
 */

import { browserWarn } from "@/utils/debug";
import { useBrowserLeaseStore } from "@/stores/browserLeaseStore";
import {
  detachCanceller,
  grantToAi,
  invalidateLease,
  leaseOf,
  validateEnvelope,
  withCanceller,
  withoutTab,
  type LeaseHolder,
  type LeaseValidation,
} from "./leaseTransitions";

interface BrowserLease {
  /** AI requests control. Succeeds only if the tab is free or already AI-held
   *  (a human holder always wins). Returns whether the AI now holds the lease. */
  acquireForAi: (tabId: string) => boolean;
  /** Human input reclaims an AI-held lease: bumps the epoch, moves the holder to
   *  the human and cancels the AI's in-flight step. A no-op when the AI does not
   *  hold the tab — there is nothing to interrupt, and a hold nothing will release
   *  would lock the tab (W-04). */
  reclaimForHuman: (tabId: string) => void;
  /** Release the lease if (and only if) `holder` currently holds it — bumps the
   *  epoch, so envelopes from the ended tenure cannot validate again. */
  release: (tabId: string, holder: LeaseHolder) => void;
  /** Register (or clear, with `null`) the canceller for the AI's in-flight step. */
  setInflightCancel: (tabId: string, cancel: (() => void) | null) => void;
  /** Validate a run envelope against the current lease. */
  validate: (tabId: string, holder: LeaseHolder, epoch: number) => LeaseValidation;
  /** Current lease holder for `tabId`, or null when free/unknown. */
  currentHolder: (tabId: string) => LeaseHolder | null;
  /** Current takeover epoch for `tabId` (0 when unknown). */
  epochOf: (tabId: string) => number;
  /** Drop all lease + in-flight state for a closed tab. */
  removeTab: (tabId: string) => void;
}

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

const read = useBrowserLeaseStore.getState;
const write = useBrowserLeaseStore.setState;

/** Detach the tab's in-flight canceller and return it (so it fires at most
 *  once — the state is recorded before the callback runs). */
function detachCancel(tabId: string): (() => void) | undefined {
  const { cancellers, cancel } = detachCanceller(read().inflightCancel, tabId);
  if (cancel) write({ inflightCancel: cancellers });
  return cancel;
}

/**
 * The one authority transition shared by reclaim and release: detach the
 * in-flight canceller, bump the epoch (invalidating every outstanding run
 * envelope), move the holder, then fire the canceller against the
 * already-recorded state.
 */
function invalidate(tabId: string, holder: LeaseHolder | null): void {
  const cancel = detachCancel(tabId);
  write((state) => ({ leases: invalidateLease(state.leases, tabId, holder) }));
  runCancel(cancel);
}

/** The per-tab automation lease (R11) — the only writer of browserLeaseStore. */
export const browserLease: BrowserLease = {
  acquireForAi: (tabId) => {
    const leases = grantToAi(read().leases, tabId);
    if (!leases) return false;
    write({ leases });
    return true;
  },

  reclaimForHuman: (tabId) => {
    if (read().leases[tabId]?.holder !== "ai") return;
    invalidate(tabId, "human");
  },

  release: (tabId, holder) => {
    if (leaseOf(read().leases, tabId).holder !== holder) return;
    // An authority transition like reclaim: the epoch moves so envelopes
    // from the ended tenure cannot validate after a re-acquire, and the
    // in-flight step is never left running (or a stale canceller left for a
    // later reclaim to fire).
    invalidate(tabId, null);
  },

  setInflightCancel: (tabId, cancel) => {
    // Only the AI holds in-flight steps, and only one per tab. A registration
    // that lands after a human reclaim would otherwise re-install the very
    // operation the reclaim just cancelled — refuse it and cancel it at once.
    if (cancel && read().leases[tabId]?.holder !== "ai") {
      runCancel(cancel);
      return;
    }
    const previous = read().inflightCancel[tabId];
    write((state) => ({ inflightCancel: withCanceller(state.inflightCancel, tabId, cancel) }));
    // Replacing a live canceller abandons its step — cancel it, never orphan it.
    // Clearing with `null` means the step completed on its own: nothing to cancel.
    if (cancel && previous && previous !== cancel) runCancel(previous);
  },

  validate: (tabId, holder, epoch) => validateEnvelope(read().leases, tabId, holder, epoch),

  currentHolder: (tabId) => leaseOf(read().leases, tabId).holder,

  epochOf: (tabId) => leaseOf(read().leases, tabId).epoch,

  removeTab: (tabId) => {
    // The surface is gone: an in-flight step would act on a destroyed webview
    // (or, worse, a reused tab id) — cancel it as part of the teardown.
    const cancel = detachCancel(tabId);
    write((state) => ({
      leases: withoutTab(state.leases, tabId),
      inflightCancel: withoutTab(state.inflightCancel, tabId),
    }));
    runCancel(cancel);
  },
};
