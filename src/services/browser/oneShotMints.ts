/**
 * oneShotMints — the driver-side mint and revoke of single-use approvals
 * ("Allow once"), split out of `grantSync.ts` for size (round 3).
 *
 * Purpose: one path mints a one-shot into the Rust driver and records the promise
 * (audit 2026-09-03 A-04), so a caller that needs the driver's confirmation awaits
 * THAT mint (`mintOneShotConfirmed`) instead of minting a second copy; and
 * `revokeOneShot` withdraws a mint that confirmed after its run was cancelled, by
 * the mint's FULL identity — script included — so revoking one payload-bound
 * one-shot never takes an unrelated one for the same target (round 3, #124).
 *
 * @coordinates-with services/browser/grantSync.ts — the subscription that calls `pushOneShot`
 * @coordinates-with src-tauri browser_add_one_shot / browser_revoke_one_shot — the driver's mirror
 * @module services/browser/oneShotMints
 */
import { invoke } from "@tauri-apps/api/core";
import type { OneShotApproval } from "@/stores/browserApprovalStore";
import { browserWarn } from "@/utils/debug";

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
export const MAX_PENDING_MINTS = 256;

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
/** Mint a newly approved one-shot into the driver and record the promise (called by the grant-sync subscription). */
export function pushOneShot(shot: OneShotApproval): void {
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

/**
 * Withdraw a one-shot the driver holds for a run that is gone (round 3, #124): the
 * counterpart of a mint that confirmed AFTER its run was cancelled. Best effort —
 * a lapsed one-shot (the tab navigated) is already gone, and a failed revoke is
 * logged, not thrown: the caller has nothing left to do with it.
 */
export async function revokeOneShot(shot: OneShotApproval): Promise<void> {
  try {
    await invoke("browser_revoke_one_shot", {
      tabId: shot.tabId,
      generation: shot.generation,
      originPattern: shot.originPattern,
      operation: shot.operation,
      target: shot.target ?? null,
      // The full mint identity: a payload-bound one-shot is named by its script too,
      // so revoking it cannot take an unrelated one-shot for the same target.
      evalScript: shot.script ?? null,
    });
  } catch (error) {
    browserWarn("one-shot revoke failed; a stale authorization may remain until navigation", error);
  }
}

/** Test-only: forget every recorded one-shot mint (the profile-open half lives in grantSync). */
export function resetOneShotMints(): void {
  pendingMints.clear();
}
