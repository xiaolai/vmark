/**
 * humanTabAttach — the `browser_ai_attach` IPC and its failure policy.
 *
 * Split out of `browserApprovalStore` for two reasons. It is an IPC call, which
 * is a service concern rather than store state (ADR-013); and the store had
 * grown past the 300-line limit, which is the signal that it was holding more
 * than one job.
 *
 * The failure policy is the substance here. This call used to live inline with
 * `() => {}` as its rejection handler, while `resolveApproval` had ALREADY
 * dropped the prompt — so an attach that never happened looked exactly like one
 * that did: no attachment recorded, no prompt, no message, and the user
 * believing they had just granted the AI a tab. Reporting the outcome is what
 * lets the caller keep the prompt raised (audit 20260815-163607 #24).
 *
 * @coordinates-with stores/browserApprovalStore — sole caller
 * @module services/browser/humanTabAttach
 */

import { invoke } from "@tauri-apps/api/core";
import { browserApprovalError } from "@/utils/debug";

type AttachInvoker = (tabId: string, generation: number, once: boolean) => Promise<unknown>;

const realInvoker: AttachInvoker = (tabId, generation, once) =>
  Promise.resolve(invoke("browser_ai_attach", { tabId, generation, once }));

let invoker: AttachInvoker = realInvoker;

/** Test-only — never call from production code. Pass `null` to restore. */
export function __setAttachInvoker(fn: AttachInvoker | null): void {
  invoker = fn ?? realInvoker;
}

/**
 * Attach a human tab for the AI. Resolves whether it SUCCEEDED — it never
 * rejects, because every caller needs the outcome rather than an exception, and
 * a swallowed rejection is what this replaces.
 */
export function performHumanTabAttach(
  tabId: string,
  generation: number,
  once: boolean,
): Promise<boolean> {
  return invoker(tabId, generation, once).then(
    () => true,
    (error: unknown) => {
      // FAIL LOUD. Production-persistent: an approved attachment that did not
      // happen is a security-relevant outcome the user was told nothing about.
      browserApprovalError("browser_ai_attach failed:", error);
      return false;
    },
  );
}

/** One attachment per tab. A re-attach REPLACES the tab's entry rather than
 *  appending, so a stale generation cannot linger alongside the current one. */
export function recordAttachment<T extends { tabId: string }>(list: readonly T[], entry: T): T[] {
  return [...list.filter((a) => a.tabId !== entry.tabId), entry];
}

/** Spend a ONE-SHOT attachment for (tab, generation). A standing attachment
 *  (`once: false`) survives — consuming authorisation is not revoking it. */
export function consumeOnceAttachment<
  T extends { tabId: string; generation: number; once: boolean },
>(list: readonly T[], tabId: string, generation: number): T[] {
  return list.filter((a) => !(a.tabId === tabId && a.generation === generation && a.once));
}
