/**
 * The state transitions for resolving a non-attach approval (split from
 * `browserApprovalStore.ts` for the file-size gate; split again into its three
 * transitions in audit round 3, #150). Pure: each takes the current slice and the
 * request, returns the next slice — the SAME array when nothing changes, so a
 * subscriber sees no spurious update.
 *
 * `resolveNonAttach` composes them and drops the prompt in the same update:
 * never expose a state where the grant exists but the request is still pending
 * (subscribers — grantSync — would see it and push twice).
 *
 * `pattern` is the request's grant pattern, or null for an opaque origin
 * (about:/data:) that can be neither remembered nor authorized once — every
 * transition fails closed on it.
 *
 * @coordinates-with stores/browserApprovalStore.ts — the only consumer
 * @coordinates-with src-tauri browser/mint.rs — the driver's one-shot cap this mirrors
 * @module stores/browserApprovalStore.resolve
 */
import { addGrant, type StandingGrant } from "@/lib/browser/approval/grants";
import { MAX_ONE_SHOTS, MAX_PENDING_APPROVALS } from "./browserApprovalStore.constants";
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
 * Profile-OPEN (WI-P6.1 H1): "Allow once" mints a single-use grant bound to
 * (profile, origin) — never a standing grant, so `remember` mints nothing. Capped
 * and de-duplicated so a stream of approvals cannot grow `profileOpens` without
 * bound (mirrors the pending cap and the Rust-side profile-open cap).
 */
export function resolveProfileOpen(
  profileOpens: ProfileOpenApproval[],
  request: PendingApproval,
  outcome: ApprovalOutcome,
  pattern: string | null,
): ProfileOpenApproval[] {
  const profile = request.profile;
  if (profile === undefined || outcome !== "once" || pattern === null) return profileOpens;
  if (profileOpens.length >= MAX_PENDING_APPROVALS) return profileOpens;
  if (profileOpens.some((g) => g.profile === profile && g.originPattern === pattern)) return profileOpens;
  return [...profileOpens, { profile, originPattern: pattern }];
}

/** "Remember" promotes the request's operation to a standing grant on its origin. */
export function rememberStandingGrant(
  grants: StandingGrant[],
  request: PendingApproval,
  outcome: ApprovalOutcome,
  pattern: string | null,
): StandingGrant[] {
  if (outcome !== "remember" || pattern === null) return grants;
  return addGrant(grants, { originPattern: pattern, operations: [request.operation] });
}

/**
 * "Allow once" mints a single-use authorization bound to everything the user was
 * shown: the origin, the operation, the tab, the generation the prompt was RAISED
 * against (not whatever is current when the driver receives the mint — audit,
 * High), the element and the exact script (so a substituted retry is refused), and
 * the run that raised it, when one did. At the cap the OLDEST unspent one-shot
 * goes (see MAX_ONE_SHOTS).
 */
export function mintOneShot(
  oneShots: OneShotApproval[],
  request: PendingApproval,
  outcome: ApprovalOutcome,
  pattern: string | null,
): OneShotApproval[] {
  if (outcome !== "once" || pattern === null) return oneShots;
  const kept = oneShots.length >= MAX_ONE_SHOTS ? oneShots.slice(1) : oneShots;
  return [
    ...kept,
    {
      originPattern: pattern,
      operation: request.operation,
      tabId: request.tabId,
      generation: request.generation,
      ...(request.runId !== undefined ? { runId: request.runId } : {}),
      ...approvalBindings(request.target, request.script),
    },
  ];
}

/** Resolve `request` (not an `attach`) with `outcome`: the partial state to set. */
export function resolveNonAttach(
  state: ResolveSlices,
  request: PendingApproval,
  outcome: ApprovalOutcome,
  pattern: string | null,
): Partial<ResolveSlices> {
  const pending = state.pending.filter((p) => p.id !== request.id);
  if (request.profile !== undefined) {
    return { profileOpens: resolveProfileOpen(state.profileOpens, request, outcome, pattern), pending };
  }
  return {
    grants: rememberStandingGrant(state.grants, request, outcome, pattern),
    oneShots: mintOneShot(state.oneShots, request, outcome, pattern),
    pending,
  };
}
