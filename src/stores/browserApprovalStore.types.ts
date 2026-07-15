/**
 * Types for the browser approval store (R5/R7a) — the standing-grant and
 * page-scoped one-shot authorization model. Split from `browserApprovalStore.ts`
 * so the store file stays within the size limit; the store re-exports these, so
 * consumers still import them from `@/stores/browserApprovalStore`.
 *
 * @module stores/browserApprovalStore.types
 */

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
  /**
   * The EXACT script this approval authorizes, for the payload-binding operations
   * (`style`/`eval`). Shown to the user so they approve the real payload — not just
   * "run eval on this site" — and bound into the one-shot so an approved script A
   * cannot be spent on a substituted script B. Absent for target-based ops (a click
   * binds role+name instead). (Security review P5, High #1.)
   */
  script?: string;
  /** For a profile-OPEN approval (WI-P6.1 H1): the named profile the AI wants to
   *  open. Present only for that approval kind; on "Allow once" it mints a
   *  ProfileOpenApproval instead of a tab-bound one-shot. */
  profile?: string;
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
  /** The exact script authorized, for `style`/`eval` (see `PendingApproval.script`).
   *  Passed to the driver mint so it binds the payload hash, and matched by the
   *  advisory `consumeOneShot` so a substituted retry is refused here too. */
  script?: string;
}

export interface HumanTabAttachment {
  tabId: string;
  generation: number;
  once: boolean;
}

/** A single-use grant to open a named persistent context (WI-P6.1 H1), bound to
 *  (profile, origin). Minted from a per-use approval, mirrored to the driver, and
 *  consumed authoritatively by `browser_ai_create` before the profile is applied. */
export interface ProfileOpenApproval {
  profile: string;
  originPattern: string;
}
