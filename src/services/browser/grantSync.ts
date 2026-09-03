/**
 * Grant sync — mirror the user's standing grants into the Rust driver (WI-2.1).
 *
 * Purpose: the driver (`src-tauri/src/browser/origin_guard.rs`) is the
 * **authoritative** enforcement point for R4/R5/R7a — it refuses any `browser_eval`
 * whose committed origin does not grant the operation. Its grant set is therefore
 * the one that matters, and it must track the user's approvals rather than be
 * supplied by whoever happens to be calling.
 *
 * This subscribes to the approval store and pushes the grant list on every change,
 * so:
 *   - a revocation reaches the driver immediately (a stale permissive copy would
 *     be a security bug, not a staleness annoyance);
 *   - a caller cannot influence what the driver believes it may do — the grants
 *     flow only from the user's approvals.
 *
 * Default-deny holds if this never runs: the driver starts with an empty set.
 *
 * It is also the ONE mint path for single-use approvals (audit 2026-09-03 A-04):
 * the subscription mints each new one-shot and records the promise, and callers
 * await that mint through `mintOneShotConfirmed` instead of minting a second copy.
 *
 * @coordinates-with stores/browserApprovalStore.ts — the source of truth for grants
 * @coordinates-with src-tauri browser_set_grants — the driver's mirror
 * @module services/browser/grantSync
 */

import { invoke } from "@tauri-apps/api/core";
import {
  useBrowserApprovalStore,
  type OneShotApproval,
  type ProfileOpenApproval,
} from "@/stores/browserApprovalStore";
import type { StandingGrant } from "@/lib/browser/approval/grants";
import { browserWarn } from "@/utils/debug";
import { makeSerializedPusher, type SerializedPusher } from "./serializedPusher";

/** How many times a failed grant push is retried before giving up loudly. Bounds
 *  a permanently-unreachable driver from spinning while still healing the common
 *  transient failure — the next legitimate change re-pushes the full state anyway. */

/**
 * The grant pusher: the driver must hold exactly the frontend's standing grants.
 * A shared `makeSerializedPusher` — sends are serialized so an older snapshot
 * can never land after a newer revocation, only the latest snapshot is sent,
 * and a failed push is retried with backoff until it converges or the session is
 * disposed. The bounded three-try version this replaced gave up and left the
 * driver on a possibly stale (permissive) grant set for the rest of the session.
 */
function makeGrantPusher(): SerializedPusher<StandingGrant[]> {
  return makeSerializedPusher(
    sendGrants,
    (error, attempt) => browserWarn(`grant sync failed (attempt ${attempt}); retrying`, error),
  );
}

/** Grant sends still in the air, across every sync session in this window. */
let grantSendsInFlight = 0;
/** The most recent grant send, settled or not. */
let grantSendTail: Promise<unknown> = Promise.resolve();

/**
 * One grant send, ordered ACROSS sessions as well as within one (#91): a disposed
 * session cannot cancel a send already in flight, and Tauri does not promise
 * call-order completion — so a restarted session's first push (possibly a
 * revocation) is chained behind whatever the previous session still has in the
 * air and lands after it. With nothing in flight the send starts synchronously,
 * exactly as before.
 */
function sendGrants(grants: StandingGrant[]): Promise<void> {
  const run = grantSendsInFlight === 0 ? invoke("browser_set_grants", { grants }) : grantSendTail.then(() => invoke("browser_set_grants", { grants }));
  grantSendsInFlight += 1;
  const settle = () => {
    grantSendsInFlight -= 1;
  };
  // Registered BEFORE the caller's own handlers, so the count is already down when
  // a serialized pusher decides how to start its next send.
  grantSendTail = run.then(settle, settle);
  return run.then(() => undefined);
}

/** The identity of a one-shot mint: every field the driver binds. Two mints with
 *  the same key are the same authorization, whichever path asked for them. */
function oneShotKey(shot: OneShotApproval): string {
  return JSON.stringify([
    shot.tabId,
    shot.generation,
    shot.originPattern,
    shot.operation,
    shot.target ?? null,
    shot.script ?? null,
  ]);
}

/** Bound on remembered mint outcomes: a stale entry costs a handful of bytes,
 *  and every entry is pruned the moment its result is consumed. */
const MAX_PENDING_MINTS = 256;

/**
 * Every mint in flight or settled-but-unconsumed, by identity.
 *
 * ONE mint path (audit 2026-09-03 A-04). The subscription used to fire-and-forget
 * `browser_add_one_shot` while the workflow executor minted the same approval a
 * second time to be able to await it — so every approved run step left an orphan
 * one-shot in the driver, and on the one-off act path a fast retry could reach
 * the driver before the mint did. Now the subscription is the only minter, it
 * records the promise here, and `mintOneShotConfirmed` awaits THAT promise
 * instead of minting again. A caller that arrives with no recorded mint (the
 * subscription is not running, e.g. in a test harness) mints once itself.
 */
const pendingMints = new Map<string, Promise<boolean>>();

async function mint(shot: OneShotApproval): Promise<boolean> {
  try {
    // The driver binds the one-shot to (tab, generation, origin, operation, target,
    // payload hash). The generation is the one the APPROVAL WAS RAISED AGAINST,
    // sent explicitly: the driver refuses a mint whose generation is no longer
    // current, turning the prompt-then-navigate race into a refusal instead of an
    // escalation. (Audit, High.) `evalScript` is the exact script for every
    // payload-binding operation (style, eval, session, type, key, scroll) — the
    // driver REQUIRES it for those, so a missing script means "Allow once"
    // authorizes nothing rather than the wrong thing.
    await invoke("browser_add_one_shot", {
      tabId: shot.tabId,
      generation: shot.generation,
      originPattern: shot.originPattern,
      operation: shot.operation,
      target: shot.target,
      evalScript: shot.script,
    });
    return true;
  } catch (error) {
    browserWarn("one-shot mint refused by the driver; the action will not be authorized", error);
    return false;
  }
}

/** Record and start the mint for a newly minted "Allow once" (subscription path).
 *  One-shots are ADDED, never wholesale replaced: the driver consumes them as
 *  actions are performed, so pushing the full list would resurrect spent authority. */
function pushOneShot(shot: OneShotApproval): void {
  const key = oneShotKey(shot);
  if (pendingMints.has(key)) return; // the same approval is already on its way
  if (pendingMints.size >= MAX_PENDING_MINTS) {
    const oldest = pendingMints.keys().next().value;
    if (oldest !== undefined) pendingMints.delete(oldest);
  }
  pendingMints.set(key, mint(shot));
}

/**
 * Await the driver's confirmation that `shot` is minted (WI-NB5.3, reworked).
 *
 * Callers consume their frontend one-shot and then MUST await this before
 * invoking the driver: acting before the mint lands gets refused as unauthorized
 * (Codex review F4), and re-minting instead of awaiting left a duplicate behind
 * (audit A-04). Resolves `false` when the driver refused (a stale generation, a
 * missing script): the action must fail, never proceed unauthorized. The recorded
 * outcome is consumed here, so a later identical approval is a fresh mint.
 */
export async function mintOneShotConfirmed(shot: OneShotApproval): Promise<boolean> {
  const key = oneShotKey(shot);
  const recorded = pendingMints.get(key);
  if (recorded) {
    pendingMints.delete(key);
    return recorded;
  }
  return mint(shot);
}

/** Test-only: forget every recorded mint. */
export function __resetPendingMints(): void {
  pendingMints.clear();
  pendingProfileMints.clear();
}

/** Send a newly minted profile-open grant (WI-P6.1 H1) to the driver, which is the
 *  authority: `browser_ai_create` consumes a matching (profile, origin) before it
 *  applies a named profile. Without this leg, an approved profile-open authorizes the
 *  frontend and is then refused by the driver. */
function pushProfileOpen(grant: ProfileOpenApproval): void {
  const key = profileOpenKey(grant);
  if (pendingProfileMints.has(key)) return;
  if (pendingProfileMints.size >= MAX_PENDING_MINTS) {
    const oldest = pendingProfileMints.keys().next().value;
    if (oldest !== undefined) pendingProfileMints.delete(oldest);
  }
  pendingProfileMints.set(key, mintProfileOpen(grant));
}

/** The identity of a profile-open grant: the (profile, origin pattern) the driver binds. */
function profileOpenKey(grant: ProfileOpenApproval): string {
  return JSON.stringify([grant.profile, grant.originPattern]);
}

/** Every profile-open mint in flight or settled-but-unconsumed, by identity — the
 *  same discipline as `pendingMints`: `browserOpen` awaits the driver's confirmation
 *  before it spends the frontend grant and creates the tab, so a fast create can no
 *  longer race the mint, fail PROFILE_NOT_APPROVED and lose the user's approval. */
const pendingProfileMints = new Map<string, Promise<boolean>>();

async function mintProfileOpen(grant: ProfileOpenApproval): Promise<boolean> {
  try {
    await invoke("browser_add_profile_open", {
      profile: grant.profile,
      originPattern: grant.originPattern,
    });
    return true;
  } catch (error) {
    browserWarn("profile-open sync failed; the driver will refuse the open", error);
    return false;
  }
}

/** Await the driver's confirmation that `grant` is minted; mints once itself when
 *  no subscription recorded one (a test harness). The recorded outcome is consumed. */
export async function mintProfileOpenConfirmed(grant: ProfileOpenApproval): Promise<boolean> {
  const key = profileOpenKey(grant);
  const recorded = pendingProfileMints.get(key);
  if (recorded) {
    pendingProfileMints.delete(key);
    return recorded;
  }
  return mintProfileOpen(grant);
}

/**
 * Start mirroring the user's authorizations to the driver — the authoritative
 * gate. Pushes grants once immediately (so a driver that just started is not left
 * denying grants the user already made), then on every change, and forwards each
 * newly minted one-shot.
 *
 * Without the one-shot leg, "Allow once" authorizes the frontend and is then
 * REFUSED by the driver, which demands a standing grant it will never see.
 *
 * Returns a disposer.
 */
export function startGrantSync(): () => void {
  // One serialized pusher per sync session — its lifecycle matches the
  // subscription, so a torn-down session leaves no in-flight drain behind.
  const pusher = makeGrantPusher();
  const push = pusher.push;
  push(useBrowserApprovalStore.getState().grants);

  let previousGrants = useBrowserApprovalStore.getState().grants;
  let previousShots = useBrowserApprovalStore.getState().oneShots;
  let previousProfileOpens = useBrowserApprovalStore.getState().profileOpens;
  const unsubscribe = useBrowserApprovalStore.subscribe((state) => {
    // Reference compare: the store's actions always produce new arrays, and
    // unrelated churn (pending approvals) must not spam the driver.
    if (state.grants !== previousGrants) {
      previousGrants = state.grants;
      push(state.grants);
    }
    if (state.oneShots !== previousShots) {
      // Forward only the ADDITIONS. A shrinking list means the frontend spent its
      // mirror copy; the driver has spent its own and must not be told again.
      const added = state.oneShots.filter((s) => !previousShots.includes(s));
      previousShots = state.oneShots;
      for (const shot of added) pushOneShot(shot);
    }
    if (state.profileOpens !== previousProfileOpens) {
      // Forward only the ADDITIONS (a shrinking list means the frontend spent its
      // mirror; the driver spent its own and must not be told again).
      const added = state.profileOpens.filter((g) => !previousProfileOpens.includes(g));
      previousProfileOpens = state.profileOpens;
      for (const grant of added) pushProfileOpen(grant);
    }
  });
  return () => {
    unsubscribe();
    // A disposed session sends nothing further: an old in-flight snapshot cannot
    // be re-queued after a restarted session has pushed its own (newer) state.
    pusher.dispose();
  };
}
