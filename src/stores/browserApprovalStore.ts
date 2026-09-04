/** Browser approval store — standing grants and page-scoped ephemeral approvals (R5/R7a). */

import { create } from "zustand";
import { performHumanTabAttach, consumeOnceAttachment } from "@/services/browser/humanTabAttach";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import {
  addGrant,
  decideApproval,
  isApprovableOperation,
  isGrantableOperation,
  revokeOrigin,
  type ApprovalDecision,
  type StandingGrant,
} from "@/lib/browser/approval/grants";
import { isOriginGranted, isOriginPattern } from "@/lib/browser/origin/originGuard";
import {
  KNOWN_OPERATIONS,
  approvalBindings,
  sameTarget,
  grantPatternFor,
} from "./browserApprovalStore.helpers";
import { resolveNonAttach } from "./browserApprovalStore.resolve";
import { beginAttach, settleAttach } from "./browserApprovalStore.attach";
import type {
  ActionTarget,
  PendingApproval,
  ApprovalOutcome,
  OneShotApproval,
  HumanTabAttachment,
  ProfileOpenApproval,
} from "./browserApprovalStore.types";

// Re-exported so consumers keep importing these from `@/stores/browserApprovalStore`.
export type {
  ApprovalOutcome,
  OneShotApproval,
  ProfileOpenApproval,
} from "./browserApprovalStore.types";

/** requestApproval outcome: queued / already-pending id / unknown operation
 *  (`rejected`) / queue full (`overloaded` — untrusted-client flooding). */
type BrowserRequestApprovalResult = "queued" | "existing" | "rejected" | "overloaded";

export { MAX_PENDING_APPROVALS } from "./browserApprovalStore.constants";
import { MAX_PENDING_APPROVALS } from "./browserApprovalStore.constants";

interface BrowserApprovalState {
  grants: StandingGrant[];
  pending: PendingApproval[];
  /** Prompts whose approval IPC (attach) is in flight — the dialog disables its
   *  buttons for these and the store ignores a second decision. */
  resolving: string[];
  oneShots: OneShotApproval[];
  attachments: HumanTabAttachment[];
  profileOpens: ProfileOpenApproval[];
}

interface BrowserApprovalActions {
  /** Decide whether the AI may perform `operation` on `targetUrl` right now.
   *  An operation outside the known set is `denied` — never silently approvable. */
  decide: (targetUrl: string, operation: string) => ApprovalDecision;
  /** Add (or extend) a standing grant for an origin pattern. Returns whether it
   *  was accepted: a malformed pattern, an empty operation list, or ANY operation
   *  that cannot be a standing grant (unknown, never-automatable, per-call-only)
   *  rejects the whole grant and stores NOTHING (fail closed — a sanitized subset
   *  would be authority the user never reviewed, and `true` over it was a lie). */
  grant: (originPattern: string, operations: string[]) => boolean;
  /** Revoke all grants for an origin pattern. */
  revoke: (originPattern: string) => void;
  /** Revoke EVERY standing grant — the browser was switched off, and "withdraws
   *  the AI automation surface" must include the authority it accumulated. */
  revokeAll: () => void;
  /** Queue a pending approval request. Callers MUST NOT advertise
   *  `needsApproval` on `rejected`/`overloaded` — no prompt exists then. */
  requestApproval: (
    id: string,
    targetUrl: string,
    operation: string,
    target: ActionTarget | undefined,
    tabId: string,
    /** The tab's generation NOW — the page the user is being shown. See
     *  `PendingApproval.generation`. */
    generation: number,
    /** The exact script (for `style`/`eval`) the user is approving — shown in the
     *  prompt and bound into the one-shot. Omit for target-based ops. */
    script?: string,
    /** The workflow run that raised this prompt (WI-NB5.3), so ending the run
     *  can withdraw it. Omit for a one-off act's prompt. */
    runId?: string,
    /** Display-only summary of a bound payload (`Text: "…"`, `Key: Enter`). */
    payloadSummary?: string,
  ) => BrowserRequestApprovalResult;
  /** Withdraw every pending prompt raised by `runId` (WI-NB5.3) — end-of-run
   *  cleanup that closes the late-Allow race. No-op for runless prompts. */
  withdrawByRun: (runId: string) => void;
  /** Resolve a pending request: `remember` promotes it to a standing grant scoped
   *  to the target's origin; `once` mints a single-use authorization for that
   *  (origin, operation); `deny` just clears it. No-op if the id is unknown. */
  resolveApproval: (id: string, outcome: ApprovalOutcome) => void;
  /** Spend a one-shot authorizing `operation` on `targetUrl` against `target`, if
   *  one exists. Returns whether the action is authorized. The target must match
   *  what the user approved (a one-shot for "click Publish" refuses "click Delete").
   *  Consuming is the point: a one-shot authorizes exactly one action, so this must
   *  be called only when about to act. */
  consumeOneShot: (
    targetUrl: string,
    operation: string,
    target: ActionTarget | undefined,
    tabId: string,
    /** The exact script (for `style`/`eval`/`type`/`key`/`scroll`); must equal what
     *  the one-shot bound, so an approved script A refuses a substituted script B.
     *  Omit for operations that bind no payload. */
    script?: string,
    /** The tab's CURRENT generation. When supplied, a one-shot minted against an
     *  older page does not match — the driver enforces this authoritatively; the
     *  mirror agreeing keeps the two layers from disagreeing about a stale shot. */
    generation?: number,
  ) => boolean;
  /**
   * The tab navigated: drop its pending prompts and its unspent one-shots (R7a).
   *
   * A prompt describes an action on a *specific page*. Once the tab has moved on,
   * answering it would authorize that action against whatever loaded instead — the
   * user would be consenting to something they were never shown. The same is true of
   * an unspent one-shot. The authoritative driver already clears its own one-shots on
   * navigation-start; this keeps the frontend's advisory copy honest rather than
   * letting the two layers disagree.
   *
   * Standing grants are NOT touched: the user chose those deliberately and they are
   * scoped to an origin, not to a page instance.
   */
  dismissForNavigation: (tabId: string) => void;
  /** Drop approvals that are valid only for the current app/browser session. */
  clearEphemeral: () => void;
  isHumanTabAttached: (tabId: string, generation: number) => boolean;
  consumeHumanTabAttachment: (tabId: string, generation: number) => void;
}

/** The tab's generation NOW — `0` before its first commit, which is how the bridge
 *  stamps a prompt (`browserHelpers.ts`) — or undefined for a tab no window holds. */
function browserTabGeneration(tabId: string): number | undefined {
  const tab = useTabStore.getState().findTabById(tabId);
  return tab && isBrowserTab(tab) ? (tab.generation ?? 0) : undefined;
}

/** Standing grants + pending approvals for AI browser actions (R5). Use selectors. */
export const useBrowserApprovalStore = create<BrowserApprovalState & BrowserApprovalActions>(
  (set, get) => ({
    grants: [],
    pending: [],
    resolving: [],
    oneShots: [],
    attachments: [],
    profileOpens: [],

    decide: (targetUrl, operation) => {
      if (!KNOWN_OPERATIONS.has(operation)) return "denied";
      return decideApproval(targetUrl, operation, get().grants);
    },

    grant: (originPattern, operations) => {
      if (!isOriginPattern(originPattern)) return false;
      if (operations.length === 0) return false;
      if (!operations.every(isGrantableOperation)) return false;
      set((state) => ({ grants: addGrant(state.grants, { originPattern, operations }) }));
      return true;
    },

    revoke: (originPattern) => {
      set((state) => ({ grants: revokeOrigin(state.grants, originPattern) }));
    },

    revokeAll: () => set({ grants: [] }),

    requestApproval: (id, targetUrl, operation, target, tabId, generation, script, runId, payloadSummary) => {
      if (!isApprovableOperation(operation)) return "rejected";
      // Duplicate ids would let `resolveApproval` authorize one action while
      // dropping the other; and the UNTRUSTED client must not grow the queue
      // unboundedly (each pending may retain a full script). (Sec review P5.)
      if (get().pending.some((p) => p.id === id)) return "existing";
      if (get().pending.length >= MAX_PENDING_APPROVALS) return "overloaded";
      const req = {
        id,
        targetUrl,
        operation,
        tabId,
        generation,
        ...(runId !== undefined ? { runId } : {}),
        ...approvalBindings(target, script, payloadSummary),
      };
      set((state) => ({ pending: [...state.pending, req] }));
      return "queued";
    },

    // WI-NB5.3: end-of-run cleanup. A workflow run ending (completed, cancelled,
    // lease-lost) withdraws its own pending prompts, so a "Allow" clicked after
    // the run is gone cannot mint a one-shot for a run that will never use it.
    withdrawByRun: (runId) =>
      set((state) => ({
        pending: state.pending.filter((p) => p.runId !== runId),
        // An "Allow once" that won the race against the cancellation minted a
        // one-shot the run will never spend; it must not stay consumable.
        oneShots: state.oneShots.filter((s) => s.runId !== runId),
      })),

    resolveApproval: (id, outcome) => {
      const request = get().pending.find((p) => p.id === id);
      if (!request) return;
      // An opaque origin (about:/data:) yields no pattern — it can be neither
      // remembered nor authorized once. Fail closed.
      const pattern = grantPatternFor(request.targetUrl);
      if (request.operation === "attach") {
        // A denial is final and local. An APPROVAL depends on an IPC that can
        // fail, so the prompt stays raised until the attach is CONFIRMED —
        // dropping it first left a failure with no prompt, no attachment and no
        // message (audit 20260815-163607 #24).
        // Single-flight: while the attach IPC is pending the prompt is still
        // raised, so a second click used to launch a second attach whose completion
        // order decided the final authority — and a Deny could drop the prompt while
        // the attach still succeeded. The dialog disables its buttons on
        // `resolving`; this is the guard behind it, for every outcome.
        if (get().resolving.includes(id)) return;
        if (outcome === "deny") return set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }));
        // The entry captured at the click is the TOKEN the outcome is judged against
        // (#153): a late success records the mirror only if that very entry is still
        // pending and the tab is still on the prompt's generation; a failure marks the
        // entry and re-enables the buttons. See browserApprovalStore.attach.ts.
        const { patch, token } = beginAttach(get(), request);
        set(patch);
        const once = outcome === "once";
        void performHumanTabAttach(token.tabId, token.generation, once).then((ok) =>
          set((s) => settleAttach(s, token, ok, once, browserTabGeneration)),
        );
        return;
      }
      set((state) => resolveNonAttach(state, request, outcome, pattern));
    },

    consumeOneShot: (targetUrl, operation, target, tabId, script, generation) => {
      if (!isApprovableOperation(operation)) return false;
      const { oneShots } = get();
      // Origin matching goes through the SAME guard as standing grants (no implicit
      // subdomain wildcarding); the tab, generation (when the caller knows it),
      // target, AND script must match the exact action approved, so the two layers
      // agree with the authoritative driver. The script comparison is what refuses
      // an approved-A / run-B substitution for the payload-binding ops; it is
      // `undefined === undefined` for ops that bind no payload.
      const index = oneShots.findIndex(
        (s) =>
          s.operation === operation &&
          s.tabId === tabId &&
          (generation === undefined || s.generation === generation) &&
          sameTarget(s.target, target) &&
          s.script === script &&
          isOriginGranted(targetUrl, [s.originPattern]),
      );
      if (index === -1) return false;
      set((state) => ({
        oneShots: state.oneShots.filter((_, i) => i !== index),
      }));
      return true;
    },

    dismissForNavigation: (tabId) => {
      set((state) => ({
        pending: state.pending.filter((p) => p.tabId !== tabId),
        oneShots: state.oneShots.filter((s) => s.tabId !== tabId),
        attachments: state.attachments.filter((a) => a.tabId !== tabId),
      }));
    },

    clearEphemeral: () => set({ pending: [], resolving: [], oneShots: [], attachments: [], profileOpens: [] }),

    isHumanTabAttached: (tabId, generation) =>
      get().attachments.some((a) => a.tabId === tabId && a.generation === generation),

    consumeHumanTabAttachment: (tabId, generation) =>
      set((s) => ({ attachments: consumeOnceAttachment(s.attachments, tabId, generation) })),
  }),
);
