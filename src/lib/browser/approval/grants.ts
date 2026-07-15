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

import { describeOriginPattern, isOriginGranted } from "../origin/originGuard";

/** Every operation the AI can ask to perform in the browser. An operation string
 *  is an authorization token, so the vocabulary is closed: anything outside this
 *  list is rejected rather than silently becoming a standing permission. */
const BROWSER_OPERATIONS = [
  "read", "attach", "click", "type", "scroll", "key", "style", "navigate", "publish", "upload", "eval",
] as const;

type BrowserOperation = (typeof BROWSER_OPERATIONS)[number];

const KNOWN_OPERATIONS: ReadonlySet<string> = new Set(BROWSER_OPERATIONS);

/** Operations the AI may NEVER perform autonomously, even with a grant. An
 *  AI-chosen file upload is an exfiltration path — upload targets are always
 *  human-chosen (WI-1.7). */
const NEVER_AUTOMATED: ReadonlySet<string> = new Set<BrowserOperation>(["upload"]);

/** Operations that are known and one-shot-able (approved per call) but can NEVER
 *  become a standing grant — an origin can't be "remembered" for them. Raw
 *  isolated-world `eval` (`execute_js`) is too powerful to grant once and reuse
 *  silently; every call raises a fresh approval showing the script (ADR-A6). */
export const NEVER_GRANTABLE: ReadonlySet<string> = new Set<BrowserOperation>(["eval"]);

/** Is `operation` a known browser operation? Misspellings and case variants
 *  (`"Upload"`) are NOT — treating them as opaque strings is how a hard denial
 *  gets bypassed. */
function isBrowserOperation(operation: string): operation is BrowserOperation {
  return KNOWN_OPERATIONS.has(operation);
}

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

/**
 * Canonical identity of a grant pattern, or null if the pattern is not one.
 *
 * Grant identity must be the *origin* it denotes, not the string that spells it:
 * `https://EXAMPLE.com`, `https://example.com/` and `https://example.com:443` are
 * one grant, and revoking any spelling must revoke all of them. The wildcard flag
 * is part of the identity — `https://*.a.test` is NOT `https://a.test`.
 */
function patternIdentity(pattern: string): string | null {
  const info = describeOriginPattern(pattern);
  if (info === null) return null;
  return `${info.scheme}://${info.wildcard ? "*." : ""}${info.host}:${info.port}`;
}

/** Known, grantable operations only — deduped, order-preserving. Excludes
 *  never-automatable (`upload`) AND never-grantable (`eval`) ops, so a standing
 *  grant can never carry them. */
function sanitizeOperations(operations: readonly string[]): string[] {
  return [
    ...new Set(
      operations.filter(
        (op) => isBrowserOperation(op) && !NEVER_AUTOMATED.has(op) && !NEVER_GRANTABLE.has(op),
      ),
    ),
  ];
}

/**
 * Decide whether the AI may perform `operation` on `targetUrl` given the current
 * standing grants. `denied` for unknown and never-automatable operations;
 * `allowed` when a matching-origin grant lists the operation; otherwise
 * `needs-approval`.
 */
export function decideApproval(
  targetUrl: string,
  operation: string,
  grants: readonly StandingGrant[],
): ApprovalDecision {
  // Fail closed on anything outside the vocabulary: an unknown operation has no
  // defined effect, so it can never be pre-authorized.
  if (!isBrowserOperation(operation)) return "denied";
  if (NEVER_AUTOMATED.has(operation)) return "denied";
  // A never-grantable op (`eval`) is always per-call: never allowed via a grant.
  if (NEVER_GRANTABLE.has(operation)) return "needs-approval";
  for (const grant of grants) {
    if (grant.operations.includes(operation) && isOriginGranted(targetUrl, [grant.originPattern])) {
      return "allowed";
    }
  }
  return "needs-approval";
}

/**
 * Add a grant, returning a new array. Grants for the canonically same origin are
 * merged (operations unioned, deduped) — including any duplicates already present
 * in the input, so the one-grant-per-origin invariant is restored, not assumed.
 *
 * A grant with an invalid pattern, or with no operation left after forbidden and
 * unknown ones are filtered out, is NOT stored: inert authorization state is
 * misleading, and a pattern the guard cannot parse authorizes nothing anyway.
 */
export function addGrant(
  grants: readonly StandingGrant[],
  grant: StandingGrant,
): StandingGrant[] {
  // SECURITY: read the caller-supplied fields EXACTLY ONCE. `grant` may be a getter- or
  // Proxy-backed object that returns a narrow origin to the validator here and a broader
  // one when stored below — a validation-to-use authorization bypass. Everything downstream
  // uses these snapshots, never `grant` again (mirrors the registry's snapshotManifest).
  const originPattern = grant.originPattern;
  const identity = patternIdentity(originPattern);
  const operations = sanitizeOperations(grant.operations);
  if (identity === null || operations.length === 0) return [...grants];

  const merged = new Set(operations);
  const out: StandingGrant[] = [];
  let slot = -1;
  for (const existing of grants) {
    if (patternIdentity(existing.originPattern) !== identity) {
      out.push(existing);
      continue;
    }
    for (const op of sanitizeOperations(existing.operations)) merged.add(op);
    if (slot === -1) {
      // Every equivalent entry collapses into the first one's slot, keeping the
      // pattern as the user originally spelled it.
      slot = out.length;
      out.push(existing);
    }
  }
  if (slot === -1) {
    out.push({ originPattern, operations: [...merged] });
  } else {
    out[slot] = { originPattern: out[slot].originPattern, operations: [...merged] };
  }
  return out;
}

/**
 * Remove every grant for `originPattern`, returning a new array. Matching is by
 * canonical identity, so revoking one spelling cannot leave an equivalent grant
 * behind. An unparseable pattern falls back to exact-string removal — legacy or
 * hand-edited state must still be revocable.
 */
export function revokeOrigin(
  grants: readonly StandingGrant[],
  originPattern: string,
): StandingGrant[] {
  const identity = patternIdentity(originPattern);
  if (identity === null) return grants.filter((g) => g.originPattern !== originPattern);
  return grants.filter((g) => patternIdentity(g.originPattern) !== identity);
}
