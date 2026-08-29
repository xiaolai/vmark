/**
 * Purpose: the ONE destructive-confirmation dialog (WI-UI4.1).
 *
 * Every "are you sure" in VMark goes through here, and the signature REQUIRES
 * the pieces that keep those dialogs consistent:
 *
 *   - `actionLabel` is the VERB on the confirming button — "Delete", "Revert",
 *     "Clear History" — never "Yes"/"OK". A verb makes the consequence
 *     legible at the button, which is where the eye is when it clicks.
 *   - `title`/`message` arrive as ALREADY-TRANSLATED strings; the i18n gate
 *     (check-i18n-keys) refuses raw ask()/confirm() calls outside this file,
 *     so a hardcoded-English dialog cannot come back.
 *
 * @coordinates-with scripts/check-i18n-keys.ts — enforces the funnel
 * @module services/dialogs/confirmAction
 */
import { ask } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";

export interface ConfirmActionOptions {
  title: string;
  message: string;
  /** The verb on the confirming button — "Delete", never "Yes". */
  actionLabel: string;
  kind: "warning" | "info" | "error";
  /** Defaults to the localized "Cancel". */
  cancelLabel?: string;
}

export async function confirmAction(opts: ConfirmActionOptions): Promise<boolean> {
  return await ask(opts.message, {
    title: opts.title,
    kind: opts.kind,
    okLabel: opts.actionLabel,
    cancelLabel: opts.cancelLabel ?? i18n.t("dialog:common.cancel"),
  });
}
