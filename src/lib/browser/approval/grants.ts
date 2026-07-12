/**
 * Operation-based approval + scoped standing grants (WI-2.6 / R5).
 *
 * Purpose: decide whether an AI-initiated browser action may proceed without a
 * fresh human approval. A **standing grant** scopes what the AI may do
 * autonomously to a specific origin pattern and an explicit set of operations —
 * so "read + click on my blog" never silently becomes "publish + upload
 * anywhere". Origin scoping reuses the audited origin guard (no implicit
 * wildcarding, IDN-safe); one operation is hard-denied regardless of any grant.
 *
 * Separation of concerns: this answers "may the AI do X here?" (approval). Once
 * allowed, `workflow/safety.ts` governs *how* a write executes (postconditions,
 * no double-post). Approval and write-safety are independent gates.
 *
 * @coordinates-with lib/browser/origin/originGuard.ts — isOriginGranted scoping
 * @coordinates-with lib/browser/workflow/safety.ts — the separate write-safety gate
 * @module lib/browser/approval/grants
 */

import { isOriginGranted } from "../origin/originGuard";

/** A scoped standing grant: an origin pattern + the operations it authorizes. */
export interface StandingGrant {
  /** Origin pattern understood by the origin guard (`https://host`,
   *  `https://host:port`, or `https://*.host`). */
  originPattern: string;
  /** Operations authorized on that origin, e.g. `["read","click","type"]`. */
  operations: string[];
}

/** Verdict for an AI-initiated action. */
export type ApprovalDecision = "allowed" | "needs-approval" | "denied";

/** Operations the AI may NEVER perform autonomously, even with a grant. An
 *  AI-chosen file upload is an exfiltration path — upload targets are always
 *  human-chosen (WI-1.7). */
const NEVER_AUTOMATED = new Set(["upload"]);

/**
 * Decide whether the AI may perform `operation` on `targetUrl` given the current
 * standing grants. `denied` for never-automatable operations; `allowed` when a
 * matching-origin grant lists the operation; otherwise `needs-approval`.
 */
export function decideApproval(
  targetUrl: string,
  operation: string,
  grants: readonly StandingGrant[],
): ApprovalDecision {
  if (NEVER_AUTOMATED.has(operation)) return "denied";
  for (const grant of grants) {
    if (grant.operations.includes(operation) && isOriginGranted(targetUrl, [grant.originPattern])) {
      return "allowed";
    }
  }
  return "needs-approval";
}

/**
 * Add a grant, returning a new array. If a grant for the same origin pattern
 * already exists, its operations are unioned (deduped) rather than duplicated.
 */
export function addGrant(
  grants: readonly StandingGrant[],
  grant: StandingGrant,
): StandingGrant[] {
  const idx = grants.findIndex((g) => g.originPattern === grant.originPattern);
  if (idx === -1) return [...grants, { ...grant, operations: [...grant.operations] }];
  const merged = new Set([...grants[idx].operations, ...grant.operations]);
  return grants.map((g, i) =>
    i === idx ? { originPattern: g.originPattern, operations: [...merged] } : g,
  );
}

/** Remove every grant for `originPattern`, returning a new array. */
export function revokeOrigin(
  grants: readonly StandingGrant[],
  originPattern: string,
): StandingGrant[] {
  return grants.filter((g) => g.originPattern !== originPattern);
}
