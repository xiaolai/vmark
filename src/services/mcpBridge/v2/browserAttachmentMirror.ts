/**
 * browserAttachmentMirror — reconcile the frontend's human-tab attachment mirror
 * to the DRIVER's report (audit 2026-09-03 round 4, #37).
 *
 * Purpose: `invokeAttached` has to know, after a rejected driver call on an
 * attached human tab, whether the driver spent the tab's one-use attachment.
 * Rust consumes it INSIDE `authorize_driver_op`, so a failure after that gate has
 * spent it and a refusal at the gate has not — but `browser_eval` can also fail
 * BEFORE the gate: a poisoned policy lock, a script over the size bound, a
 * half-specified target. The mirror used to infer the answer from a denylist of
 * gate-refusal tokens and read every other rejection as "spent", so each of those
 * pre-gate failures spent the frontend's copy while the driver kept its own, and
 * the user was prompted again for an attachment the driver still honoured.
 *
 * Key decisions:
 *   - **Ask, don't infer.** `browser_ai_attachment_state` is the driver's
 *     read-only report of what it holds for the tab, and the mirror is set to
 *     exactly that: the reported (generation, once) when attached, nothing when
 *     not. There is no token list to keep in step with `refusals.rs`, and a
 *     driver that re-attached at a newer generation is mirrored as such.
 *   - **A report that cannot be had fails SAFE in the direction that costs a
 *     prompt, not a lockout.** The one-use mirror entry is spent, as the old code
 *     did on every post-gate failure. Wrongly KEEPING the mirror is the lockout
 *     A-01 closed — the frontend never re-prompts while the driver refuses every
 *     operation until the tab navigates; wrongly dropping it costs one extra
 *     prompt. A standing attachment stays: the driver never spends one, so no
 *     operation can have consumed it.
 *   - **The wire shape is parsed strictly**: `{attached: false}` or
 *     `{attached: true, generation: u64, once: bool}`. Anything else is "no
 *     report" and takes the fail-safe path — never read as "attached".
 *   - **The mirror is written with the store's `setState`**, as `browserOpenFlow`
 *     already does for `profileOpens`: the store exposes attach (an IPC) and spend,
 *     and neither is "set the tab's entry to what the driver holds".
 *
 * @coordinates-with src-tauri/src/browser — `browser_ai_attachment_state`, the report
 * @coordinates-with services/mcpBridge/v2/browserAccess — `invokeAttached`, the only caller
 * @coordinates-with stores/browserApprovalStore — the mirror this writes
 * @module services/mcpBridge/v2/browserAttachmentMirror
 */
import { invoke } from "@tauri-apps/api/core";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import type { HumanTabAttachment } from "@/stores/browserApprovalStore.types";
import { browserApprovalError } from "@/utils/debug";
import type { BrowserTarget } from "./browserHelpers";

/** What the driver holds for a tab: nothing, or one attachment bound to a generation. */
export type AttachmentReport =
  | { attached: false }
  | { attached: true; generation: number; once: boolean };

/** Parse the `browser_ai_attachment_state` wire shape strictly; `null` for anything else. */
export function parseAttachmentReport(value: unknown): AttachmentReport | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { attached, generation, once } = value as Record<string, unknown>;
  if (attached === false) return { attached: false };
  if (attached !== true) return null;
  // A u64 arrives as a JS number — integral even past 2^53, never negative.
  if (typeof generation !== "number" || !Number.isInteger(generation) || generation < 0) return null;
  if (typeof once !== "boolean") return null;
  return { attached: true, generation, once };
}

/** The mirror after `report`: the tab's entries replaced by exactly what the driver holds. */
export function reconciledAttachments(
  list: readonly HumanTabAttachment[],
  tabId: string,
  report: AttachmentReport,
): HumanTabAttachment[] {
  const others = list.filter((a) => a.tabId !== tabId);
  return report.attached ? [...others, { tabId, generation: report.generation, once: report.once }] : others;
}

/** What the driver said — `unknown` when it could not be asked (fail-safe path taken). */
export type MirrorReconciliation = "attached" | "detached" | "unknown";

async function readAttachmentReport(tabId: string): Promise<AttachmentReport | null> {
  let raw: unknown;
  try {
    raw = await invoke<unknown>("browser_ai_attachment_state", { tabId });
  } catch (error) {
    browserApprovalError("browser_ai_attachment_state failed; spending the one-use mirror (fail safe):", error);
    return null;
  }
  const report = parseAttachmentReport(raw);
  if (!report) browserApprovalError("browser_ai_attachment_state returned an unexpected shape (fail safe):", raw);
  return report;
}

/**
 * Bring the mirror for `tab` in line with the driver after a rejected call.
 * Returns what the driver reported; on `unknown` the one-use mirror entry for
 * this generation has been spent instead.
 */
export async function reconcileAttachmentMirror(
  tab: Pick<BrowserTarget, "tabId" | "generation">,
): Promise<MirrorReconciliation> {
  const report = await readAttachmentReport(tab.tabId);
  if (!report) {
    useBrowserApprovalStore.getState().consumeHumanTabAttachment(tab.tabId, tab.generation);
    return "unknown";
  }
  useBrowserApprovalStore.setState((s) => ({
    attachments: reconciledAttachments(s.attachments, tab.tabId, report),
  }));
  return report.attached ? "attached" : "detached";
}
