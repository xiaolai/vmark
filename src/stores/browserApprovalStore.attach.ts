/**
 * The attach-approval transitions (audit 2026-09-03 round 4, #153) — pure, like
 * `browserApprovalStore.resolve.ts`: each takes the current slices and returns the
 * next, and the store does the `set`.
 *
 * An `attach` approval is an IPC (`browser_ai_attach`) that can fail, arrive late, or
 * arrive for a page the tab has since left. So the prompt stays raised until the
 * outcome is known, and the outcome is judged against a TOKEN — the pending entry
 * captured when the user clicked — and the tab's CURRENT generation:
 *
 *  - `beginAttach`: the previous attempt's error is cleared and the prompt is marked
 *    in flight (`resolving`), which is what disables the dialog's buttons.
 *  - `settleAttach`, success: the mirror is recorded only if the token is still
 *    pending AND the tab is still on the generation the prompt was raised against;
 *    either way the prompt is dropped. A prompt withdrawn meanwhile (a navigation, a
 *    run ending, a re-raised id) records nothing — Rust attached a page nobody is
 *    asking about any more, and the driver's own generation check refuses it.
 *  - `settleAttach`, failure: the prompt stays raised with `attachError` set to an
 *    i18n KEY, and leaves `resolving`, so the buttons re-enable for a retry or a deny.
 *
 * The token is the ENTRY OBJECT, not its id: an id can be re-raised by the untrusted
 * client after the original prompt was dropped, and a late success keyed by id would
 * then record — and drop — a prompt the user never answered.
 *
 * @coordinates-with stores/browserApprovalStore.ts — the only consumer
 * @coordinates-with services/browser/humanTabAttach — the IPC whose outcome these judge
 * @coordinates-with components/Browser/BrowserApprovalDialog — renders `attachError`
 * @module stores/browserApprovalStore.attach
 */
import { recordAttachment } from "@/services/browser/humanTabAttach";
import type { HumanTabAttachment, PendingApproval } from "./browserApprovalStore.types";

/** The i18n key `attachError` carries when the attach IPC fails. */
export const ATTACH_FAILED_KEY = "browser.approval.attachFailed";

export interface AttachSlices {
  pending: PendingApproval[];
  resolving: string[];
  attachments: HumanTabAttachment[];
}

export interface AttachBegin {
  patch: Pick<AttachSlices, "pending" | "resolving">;
  /** The entry the settle step will look for — the entry AFTER the error clear. */
  token: PendingApproval;
}

/** Mark `request` in flight and clear the last attempt's error. */
export function beginAttach(state: AttachSlices, request: PendingApproval): AttachBegin {
  const token = request.attachError === undefined ? request : withoutAttachError(request);
  const pending = token === request ? state.pending : state.pending.map((p) => (p === request ? token : p));
  return { patch: { pending, resolving: [...state.resolving, request.id] }, token };
}

/**
 * The state once the attach IPC for `token` settled with `ok`. `currentGeneration`
 * answers with the tab's generation NOW (undefined for a tab the store cannot see).
 */
export function settleAttach(
  state: AttachSlices,
  token: PendingApproval,
  ok: boolean,
  once: boolean,
  currentGeneration: (tabId: string) => number | undefined,
): Partial<AttachSlices> {
  const resolving = state.resolving.filter((id) => id !== token.id);
  const stillPending = state.pending.includes(token);
  if (!stillPending) return { resolving };
  if (!ok) {
    return {
      resolving,
      pending: state.pending.map((p) => (p === token ? { ...token, attachError: ATTACH_FAILED_KEY } : p)),
    };
  }
  const pending = state.pending.filter((p) => p !== token);
  if (currentGeneration(token.tabId) !== token.generation) return { resolving, pending };
  const entry = { tabId: token.tabId, generation: token.generation, once };
  return { resolving, pending, attachments: recordAttachment(state.attachments, entry) };
}

function withoutAttachError(entry: PendingApproval): PendingApproval {
  const cleared = { ...entry };
  delete cleared.attachError;
  return cleared;
}
