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

/** Closed operation vocabulary; upload is intentionally never grantable. */
const KNOWN_OPERATIONS = new Set(["read", "attach", "click", "type", "navigate", "publish"]);

/** The specific element an `act` targets — its ARIA role + accessible name.
 *  Absent for `read`, which snapshots the whole page rather than one element. */
export interface ActionTarget {
  role: string;
  name: string;
}

/** A raised-but-unresolved approval request. */
export interface PendingApproval {
  id: string;
  targetUrl: string;
  operation: string;
  /** The element the AI asked to act on, so the approval binds to it. */
  target?: ActionTarget;
  /** The browser tab the action targets. The driver binds the one-shot to it +
   *  the tab's committed generation, so authority lapses on navigation (R7a). */
  tabId: string;
  /**
   * The tab's navigation generation AT THE MOMENT THE PROMPT WAS RAISED — i.e. the page
   * the user is actually being shown and asked about.
   *
   * Carried explicitly because the driver used to stamp the one-shot with whatever
   * generation was current when the mint arrived. Between raising the prompt and the user
   * clicking "Allow once" the page can navigate, and the approval would then be bound to a
   * page the user never saw. `dismissForNavigation` narrows that window but cannot close
   * it — the resolve and the navigation event are independent messages. (Audit, High.)
   */
  generation: number;
}

/** How the user (or a policy) resolved a pending approval. */
export type ApprovalOutcome = "once" | "remember" | "deny";

/** A single-use authorization minted by "Allow once". */
export interface OneShotApproval {
  /** Canonical bare origin pattern the approval was granted on. */
  originPattern: string;
  operation: string;
  /** The generation the user approved against — see `PendingApproval.generation`. */
  generation: number;
  /**
   * The exact element the user approved. A one-shot for "click Publish" must not
   * authorize "click Delete" on the same origin — the AI chooses what it retries
   * with, so without this it could escalate to a different element inside the
   * single-action window. Enforced on both sides: this frontend copy (advisory)
   * and the authoritative driver one-shot, which also binds the tab + committed
   * generation so authority cannot survive a navigation.
   */
  target?: ActionTarget;
  /** The tab the approval was granted for. Carried so the mint (browser_add_one_shot)
   *  can bind the driver one-shot to it; the advisory frontend consume also matches
   *  it so the two layers agree in the common case. */
  tabId: string;
}

export interface HumanTabAttachment {
  tabId: string;
  generation: number;
  once: boolean;
}

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

    requestApproval: (id, targetUrl, operation, target, tabId, generation) => {
      if (!KNOWN_OPERATIONS.has(operation)) return;
      set((state) =>
        // A duplicate id would let `resolveApproval` authorize one action while
        // dropping the other — keep the first, ignore the collision.
        state.pending.some((p) => p.id === id)
          ? state
          : { pending: [...state.pending, { id, targetUrl, operation, target, tabId, generation }] },
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
              },
            ]
          : state.oneShots,
        pending: state.pending.filter((p) => p.id !== id),
      }));
    },

    consumeOneShot: (targetUrl, operation, target, tabId) => {
      if (!KNOWN_OPERATIONS.has(operation)) return false;
      const { oneShots } = get();
      // Origin matching goes through the SAME guard as standing grants (no implicit
      // subdomain wildcarding); the tab and target must match the exact action
      // approved, so the two layers agree with the authoritative driver.
      const index = oneShots.findIndex(
        (s) =>
          s.operation === operation &&
          s.tabId === tabId &&
          sameTarget(s.target, target) &&
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

    clearEphemeral: () => set({ pending: [], oneShots: [], attachments: [] }),

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
