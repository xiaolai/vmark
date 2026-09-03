/**
 * The state transition for resolving a non-attach approval (split from
 * `browserApprovalStore.ts` for the file-size gate). Pure: takes the current
 * state slices and the request, returns the partial state to set.
 *
 * @coordinates-with stores/browserApprovalStore.ts — the only consumer
 * @module stores/browserApprovalStore.resolve
 */
import { addGrant, type StandingGrant } from "@/lib/browser/approval/grants";
import { MAX_PENDING_APPROVALS } from "./browserApprovalStore.constants";
import { approvalBindings } from "./browserApprovalStore.helpers";
import type {
  ApprovalOutcome,
  OneShotApproval,
  PendingApproval,
  ProfileOpenApproval,
} from "./browserApprovalStore.types";

interface ResolveSlices {
  grants: StandingGrant[];
  pending: PendingApproval[];
  oneShots: OneShotApproval[];
  profileOpens: ProfileOpenApproval[];
}

/**
 * Resolve `request` (not an `attach`) with `outcome`. `pattern` is the request's
 * grant pattern, or null for an opaque origin (about:/data:) that can be neither
 * remembered nor authorized once — fail closed.
 */
export function resolveNonAttach(
  state: ResolveSlices,
  request: PendingApproval,
  outcome: ApprovalOutcome,
  pattern: string | null,
): Partial<ResolveSlices> {
  const id = request.id;
  // Profile-OPEN (WI-P6.1 H1): "Allow once" mints a single-use grant bound to
  // (profile, origin) — never a standing grant. Capped and de-duplicated so a
  // stream of approvals can't grow `profileOpens` without bound (mirrors the
  // pending cap and the Rust-side profile-open cap). (Re-verify WI-P6.1.)
  if (request.profile !== undefined) {
    const p = request.profile;
    return {
      profileOpens:
        outcome === "once" &&
        pattern !== null &&
        state.profileOpens.length < MAX_PENDING_APPROVALS &&
        !state.profileOpens.some((g) => g.profile === p && g.originPattern === pattern)
          ? [...state.profileOpens, { profile: p, originPattern: pattern }]
          : state.profileOpens,
      pending: state.pending.filter((r) => r.id !== id),
    };
  }
  const remember = outcome === "remember" && pattern !== null;
  const once = outcome === "once" && pattern !== null;
  // One update: never expose a state where the grant exists but the request
  // is still pending (subscribers — grantSync — would see it and push twice).
  return {
    grants: remember
      ? addGrant(state.grants, {
          originPattern: pattern as string,
          operations: [request.operation],
        })
      : state.grants,
    oneShots: once
      ? [
          ...state.oneShots,
          {
            originPattern: pattern as string,
            operation: request.operation,
            tabId: request.tabId,
            // The generation the prompt was RAISED against — not whatever is current
            // when the driver eventually receives the mint. (Audit, High.)
            generation: request.generation,
            // Element + exact script approved, so a substituted retry is refused.
            ...approvalBindings(request.target, request.script),
          },
        ]
      : state.oneShots,
    pending: state.pending.filter((p) => p.id !== id),
  };
}
