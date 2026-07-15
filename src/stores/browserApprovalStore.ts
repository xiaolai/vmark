/** Browser approval store — standing grants and page-scoped ephemeral approvals (R5/R7a). */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  addGrant,
  decideApproval,
  revokeOrigin,
  type ApprovalDecision,
  type StandingGrant,
} from "@/lib/browser/approval/grants";
import {
  canonicalizeOrigin,
  isOriginGranted,
  isOriginPattern,
} from "@/lib/browser/origin/originGuard";
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
  ActionTarget,
  PendingApproval,
  ApprovalOutcome,
  OneShotApproval,
  HumanTabAttachment,
  ProfileOpenApproval,
} from "./browserApprovalStore.types";

/** Closed operation vocabulary; upload is intentionally never grantable. */
const KNOWN_OPERATIONS = new Set(["read", "attach", "click", "type", "scroll", "key", "style", "navigate", "publish", "eval", "session"]);

/** Cap on queued approval prompts. The AI client is untrusted and each pending
 *  entry may hold a full script; beyond this a further request is dropped rather
 *  than growing the store unbounded. Only one prompt shows at a time anyway. */
const MAX_PENDING_APPROVALS = 64;

/** Same element? Both target-less (a read), or both naming the same role+name. */
function sameTarget(a: ActionTarget | undefined, b: ActionTarget | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.role === b.role && a.name === b.name;
}

interface BrowserApprovalState {
  grants: StandingGrant[];
  pending: PendingApproval[];
  oneShots: OneShotApproval[];
  attachments: HumanTabAttachment[];
  profileOpens: ProfileOpenApproval[];
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
  ) => void;
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
    /** The exact script (for `style`/`eval`); must equal what the one-shot bound,
     *  so an approved script A refuses a substituted script B. Omit otherwise. */
    script?: string,
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
  /** Record a successful human-tab attachment for the current generation. */
  attachHumanTab: (tabId: string, generation: number, once: boolean) => void;
  isHumanTabAttached: (tabId: string, generation: number) => boolean;
  consumeHumanTabAttachment: (tabId: string, generation: number) => void;
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
      if (!operations.every((op) => KNOWN_OPERATIONS.has(op))) return false;
      set((state) => ({ grants: addGrant(state.grants, { originPattern, operations }) }));
      return true;
    },

    revoke: (originPattern) => {
      set((state) => ({ grants: revokeOrigin(state.grants, originPattern) }));
    },

    requestApproval: (id, targetUrl, operation, target, tabId, generation, script) => {
      if (!KNOWN_OPERATIONS.has(operation)) return;
      set((state) =>
        // A duplicate id would let `resolveApproval` authorize one action while
        // dropping the other — keep the first, ignore the collision. And the AI
        // client is UNTRUSTED: cap the queue so a flood of unique requests cannot
        // grow the store without bound (each pending may retain a full script).
        // (Security review P5 re-verify — High #1 availability.)
        state.pending.some((p) => p.id === id) || state.pending.length >= MAX_PENDING_APPROVALS
          ? state
          : {
              pending: [...state.pending, { id, targetUrl, operation, target, tabId, generation, script }],
            },
      );
    },

    resolveApproval: (id, outcome) => {
      const request = get().pending.find((p) => p.id === id);
      if (!request) return;
      // An opaque origin (about:/data:) yields no pattern — it can be neither
      // remembered nor authorized once. Fail closed.
      const pattern = grantPatternFor(request.targetUrl);
      if (request.operation === "attach") {
        set((state) => ({ pending: state.pending.filter((p) => p.id !== id) }));
        if (outcome !== "deny") {
          get().attachHumanTab(request.tabId, request.generation, outcome === "once");
        }
        return;
      }
      // Profile-OPEN (WI-P6.1 H1): "Allow once" mints a single-use grant bound to
      // (profile, origin) — never a standing grant.
      if (request.profile !== undefined) {
        const p = request.profile;
        set((state) => ({
          profileOpens:
            outcome === "once" && pattern !== null
              ? [...state.profileOpens, { profile: p, originPattern: pattern }]
              : state.profileOpens,
          pending: state.pending.filter((r) => r.id !== id),
        }));
        return;
      }
      const remember = outcome === "remember" && pattern !== null;
      const once = outcome === "once" && pattern !== null;
      // One update: never expose a state where the grant exists but the request
      // is still pending (subscribers — grantSync — would see it and push twice).
      set((state) => ({
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
                target: request.target,
                tabId: request.tabId,
                // The generation the prompt was RAISED against — not whatever is current
                // when the driver eventually receives the mint. (Audit, High.)
                generation: request.generation,
                // The exact script the user saw and approved — bound so a substituted
                // retry is refused on both layers. (Security review P5, High #1.)
                script: request.script,
              },
            ]
          : state.oneShots,
        pending: state.pending.filter((p) => p.id !== id),
      }));
    },

    consumeOneShot: (targetUrl, operation, target, tabId, script) => {
      if (!KNOWN_OPERATIONS.has(operation)) return false;
      const { oneShots } = get();
      // Origin matching goes through the SAME guard as standing grants (no implicit
      // subdomain wildcarding); the tab, target, AND script must match the exact
      // action approved, so the two layers agree with the authoritative driver. The
      // script comparison is what refuses an approved-A / run-B substitution for
      // `style`/`eval`; it is `undefined === undefined` for target-based ops.
      const index = oneShots.findIndex(
        (s) =>
          s.operation === operation &&
          s.tabId === tabId &&
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

    clearEphemeral: () => set({ pending: [], oneShots: [], attachments: [], profileOpens: [] }),

    attachHumanTab: (tabId, generation, once) => {
      void Promise.resolve(invoke("browser_ai_attach", { tabId, generation, once })).then(
        () => set((state) => ({
          attachments: [
            ...state.attachments.filter((a) => a.tabId !== tabId),
            { tabId, generation, once },
          ],
        })),
        () => {},
      );
    },

    isHumanTabAttached: (tabId, generation) =>
      get().attachments.some((a) => a.tabId === tabId && a.generation === generation),

    consumeHumanTabAttachment: (tabId, generation) => {
      set((state) => ({
        attachments: state.attachments.filter(
          (attachment) =>
            !(attachment.tabId === tabId &&
              attachment.generation === generation &&
              attachment.once),
        ),
      }));
    },
  }),
);
