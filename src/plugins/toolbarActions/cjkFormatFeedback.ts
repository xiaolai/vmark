/**
 * Telling the user that a CJK format run was REFUSED.
 *
 * Purpose: `formatMarkdown` returns the original text when its integrity check
 * fails — correctly, since a result that does not match the input is corrupt.
 * But the only trace was `cjkFmtWarn`, a log-file logger, so from the user's
 * side the accelerator did nothing at all and "refused" was indistinguishable
 * from "already formatted" (WI-CJKF6.2).
 *
 * Key decisions:
 *   - Only a REFUSAL is surfaced. A run that finds nothing to change is the
 *     normal outcome of pressing the key twice, and a toast for it would train
 *     the user to ignore the toast that matters.
 *   - `toast` + `i18n` directly, as the sibling toolbar actions already do
 *     (`sourceTableActions.ts`, `wysiwygAdapterTables.ts`). A plugin must not
 *     reach into `@/services`, and this is chrome, not a service.
 *
 * @coordinates-with lib/cjkFormatter/formatter.ts — FormatResult.refused
 * @coordinates-with sourceCjkActions.ts, wysiwygAdapterCjk.ts — the callers
 * @module plugins/toolbarActions/cjkFormatFeedback
 */

import { toast } from "sonner";
import i18n from "@/i18n";

/**
 * Show the refusal notice, if the run was refused.
 *
 * Takes the flag rather than being called conditionally so every call site
 * reads the same and none can forget the negative case.
 */
export function notifyCjkFormatRefused(refused: boolean): void {
  if (!refused) return;
  toast.error(i18n.t("dialog:toast.cjkFormatRefused"));
}
