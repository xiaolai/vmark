/**
 * Browser approval store — standing grants + pending approvals (WI-2.5 / R5).
 *
 * Purpose: the reactive state behind the operation-based approval gate. It holds
 * the user's scoped standing grants and the queue of pending approval requests
 * that the MCP browser tools raise before the AI acts. The decision logic itself
 * is the pure `approval/grants.ts` (origin-scoped, upload hard-denied); this
 * store adds persistence-shaped state + the request/resolve lifecycle the
 * approval UI (WI-2.6) and the `vmark.browser` act tools (WI-2.5) drive.
 *
 * "Remember" resolves to a standing grant scoped to the target's *origin*
 * (any path), so approving one click on a site authorizes that operation there
 * without re-prompting — but never widens the operation set or the origin.
 *
 * @coordinates-with lib/browser/approval/grants.ts — the pure decision logic
 * @coordinates-with lib/browser/origin/originGuard.ts — origin canonicalization
 * @module stores/browserApprovalStore
 */

import { create } from "zustand";
import {
  addGrant,
  decideApproval,
  revokeOrigin,
  type ApprovalDecision,
  type StandingGrant,
} from "@/lib/browser/approval/grants";
import { canonicalizeOrigin, isOriginPattern } from "@/lib/browser/origin/originGuard";

/**
 * The operations the browser act tools can actually perform, and therefore the
 * ONLY ones a standing grant may name.
 *
 * SECURITY: the act tool maps every non-`type` operation to a *click* script, so
 * an operation outside this set that ever reached "allowed" would click the page
 * under a label the user never understood ("scroll", say). Grants and pending
 * requests are the two ways an operation becomes authority — both are checked
 * against this set here, at the boundary where MCP-supplied strings enter state.
 * `upload` is deliberately absent: it is never automatable (grants.ts), so it
 * must never be *grantable* either.
 */
const KNOWN_OPERATIONS = new Set(["read", "click", "type"]);

/** A raised-but-unresolved approval request. */
export interface PendingApproval {
  id: string;
  targetUrl: string;
  operation: string;
}

/** How the user (or a policy) resolved a pending approval. */
export type ApprovalOutcome = "once" | "remember" | "deny";

interface BrowserApprovalState {
  grants: StandingGrant[];
  pending: PendingApproval[];
}

interface BrowserApprovalActions {
  /** Decide whether the AI may perform `operation` on `targetUrl` right now.
   *  An operation outside the known set is `denied` — never silently approvable. */
  decide: (targetUrl: string, operation: string) => ApprovalDecision;
  /** Add (or extend) a standing grant for an origin pattern. Returns whether it
   *  was accepted: a malformed pattern, an empty operation list, or ANY unknown /
   *  never-automatable operation rejects the whole grant (fail closed — a partial
   *  grant is authority the user never reviewed). */
  grant: (originPattern: string, operations: string[]) => boolean;
  /** Revoke all grants for an origin pattern. */
  revoke: (originPattern: string) => void;
  /** Queue a pending approval request for the UI to resolve. Ignores an unknown
   *  operation and a duplicate id (one id must map to exactly one action). */
  requestApproval: (id: string, targetUrl: string, operation: string) => void;
  /** Resolve a pending request: `remember` promotes it to a standing grant
   *  scoped to the target's origin; `once`/`deny` just clear it. No-op if the
   *  id is unknown. */
  resolveApproval: (id: string, outcome: ApprovalOutcome) => void;
}

/** Bare origin pattern (`scheme://host[:port]`) for a URL, or null if opaque. */
function grantPatternFor(url: string): string | null {
  const origin = canonicalizeOrigin(url);
  if (!origin) return null;
  const defaultPort = origin.scheme === "https" ? 443 : 80;
  return origin.port === defaultPort
    ? `${origin.scheme}://${origin.host}`
    : `${origin.scheme}://${origin.host}:${origin.port}`;
}

/** Standing grants + pending approvals for AI browser actions (R5). Use selectors. */
export const useBrowserApprovalStore = create<BrowserApprovalState & BrowserApprovalActions>(
  (set, get) => ({
    grants: [],
    pending: [],

    decide: (targetUrl, operation) => {
      if (!KNOWN_OPERATIONS.has(operation)) return "denied";
      return decideApproval(targetUrl, operation, get().grants);
    },

    grant: (originPattern, operations) => {
      if (!isOriginPattern(originPattern)) return false;
      if (operations.length === 0) return false;
      if (!operations.every((op) => KNOWN_OPERATIONS.has(op))) return false;
      set((state) => ({ grants: addGrant(state.grants, { originPattern, operations }) }));
      return true;
    },

    revoke: (originPattern) => {
      set((state) => ({ grants: revokeOrigin(state.grants, originPattern) }));
    },

    requestApproval: (id, targetUrl, operation) => {
      if (!KNOWN_OPERATIONS.has(operation)) return;
      set((state) =>
        // A duplicate id would let `resolveApproval` authorize one action while
        // dropping the other — keep the first, ignore the collision.
        state.pending.some((p) => p.id === id)
          ? state
          : { pending: [...state.pending, { id, targetUrl, operation }] },
      );
    },

    resolveApproval: (id, outcome) => {
      const request = get().pending.find((p) => p.id === id);
      if (!request) return;
      const pattern = outcome === "remember" ? grantPatternFor(request.targetUrl) : null;
      // One update: never expose a state where the grant exists but the request
      // is still pending (subscribers — grantSync — would see it and push twice).
      set((state) => ({
        grants: pattern
          ? addGrant(state.grants, { originPattern: pattern, operations: [request.operation] })
          : state.grants,
        pending: state.pending.filter((p) => p.id !== id),
      }));
    },
  }),
);
