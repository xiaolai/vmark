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
import { canonicalizeOrigin } from "@/lib/browser/origin/originGuard";

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
  /** Decide whether the AI may perform `operation` on `targetUrl` right now. */
  decide: (targetUrl: string, operation: string) => ApprovalDecision;
  /** Add (or extend) a standing grant for an origin pattern. */
  grant: (originPattern: string, operations: string[]) => void;
  /** Revoke all grants for an origin pattern. */
  revoke: (originPattern: string) => void;
  /** Queue a pending approval request for the UI to resolve. */
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

    decide: (targetUrl, operation) => decideApproval(targetUrl, operation, get().grants),

    grant: (originPattern, operations) => {
      set((state) => ({ grants: addGrant(state.grants, { originPattern, operations }) }));
    },

    revoke: (originPattern) => {
      set((state) => ({ grants: revokeOrigin(state.grants, originPattern) }));
    },

    requestApproval: (id, targetUrl, operation) => {
      set((state) => ({ pending: [...state.pending, { id, targetUrl, operation }] }));
    },

    resolveApproval: (id, outcome) => {
      const request = get().pending.find((p) => p.id === id);
      if (!request) return;
      if (outcome === "remember") {
        const pattern = grantPatternFor(request.targetUrl);
        if (pattern) {
          set((state) => ({
            grants: addGrant(state.grants, {
              originPattern: pattern,
              operations: [request.operation],
            }),
          }));
        }
      }
      set((state) => ({ pending: state.pending.filter((p) => p.id !== id) }));
    },
  }),
);
