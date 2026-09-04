/**
 * Pure transitions for the browser automation lease (audit round 3, #92).
 *
 * Purpose: the state arithmetic `lease.ts` composes — who may take a tab, how the
 * takeover epoch moves, how an envelope validates, and how the per-tab canceller
 * map is edited. Nothing here runs a canceller, touches a store or logs: each
 * function takes a record and returns a new one, so the invariants (epoch moves by
 * exactly one on an authority transition and by zero otherwise; other tabs are
 * never touched; a detached canceller is gone) are testable without the store.
 *
 * @coordinates-with services/browser/lease.ts — the only consumer; owns sequencing and side effects
 * @module services/browser/leaseTransitions
 */

/** Who holds a tab's automation lease. */
export type LeaseHolder = "ai" | "human";

/** Outcome of validating a driver-command envelope against the current lease. */
export type LeaseValidation = "ok" | "lease-lost" | "stale";

export interface TabLease {
  holder: LeaseHolder | null;
  /** Takeover epoch; bumped on reclaim and release — never on navigation. */
  epoch: number;
}

/** Per-tab lease record, keyed by browser tab id. */
export type Leases = Readonly<Record<string, TabLease>>;
/** Per-tab canceller for the AI's in-flight driver step, if any. */
export type Cancellers = Readonly<Record<string, (() => void) | undefined>>;

export const EMPTY_LEASE: TabLease = { holder: null, epoch: 0 };

/** The tab's lease, or the empty one when it has never been leased. */
export function leaseOf(leases: Leases, tabId: string): TabLease {
  return leases[tabId] ?? EMPTY_LEASE;
}

/** The AI takes a free (or already AI-held) tab at the SAME epoch — acquiring is
 *  not an authority transition. Returns null when a human holds it: the human
 *  always wins over the run they interrupted. */
export function grantToAi(leases: Leases, tabId: string): Leases | null {
  const lease = leaseOf(leases, tabId);
  if (lease.holder === "human") return null;
  return { ...leases, [tabId]: { ...lease, holder: "ai" } };
}

/** The one authority transition shared by reclaim and release: move the holder
 *  and bump the epoch by exactly one, invalidating every outstanding envelope. */
export function invalidateLease(leases: Leases, tabId: string, holder: LeaseHolder | null): Leases {
  const lease = leaseOf(leases, tabId);
  return { ...leases, [tabId]: { holder, epoch: lease.epoch + 1 } };
}

/** Validate a run envelope: `lease-lost` when the holder differs (or the tab is
 *  free/unknown), `stale` when the epoch moved, `ok` otherwise. */
export function validateEnvelope(leases: Leases, tabId: string, holder: LeaseHolder, epoch: number): LeaseValidation {
  const lease = leases[tabId];
  if (!lease || lease.holder !== holder) return "lease-lost";
  if (lease.epoch !== epoch) return "stale";
  return "ok";
}

/** The record without `tabId`; every other value keeps its identity. */
export function withoutTab<T>(record: Readonly<Record<string, T>>, tabId: string): Record<string, T> {
  const { [tabId]: _removed, ...rest } = record;
  return rest;
}

/** Take the tab's canceller out of the map. The caller runs it AFTER committing
 *  the map, so it fires at most once; a missing one returns the same map. */
export function detachCanceller(
  cancellers: Cancellers,
  tabId: string,
): { cancellers: Cancellers; cancel: (() => void) | undefined } {
  const cancel = cancellers[tabId];
  if (!cancel) return { cancellers, cancel: undefined };
  return { cancellers: withoutTab(cancellers, tabId), cancel };
}

/** Install (or, with `null`, clear) the tab's canceller. */
export function withCanceller(cancellers: Cancellers, tabId: string, cancel: (() => void) | null): Cancellers {
  return cancel ? { ...cancellers, [tabId]: cancel } : withoutTab(cancellers, tabId);
}
