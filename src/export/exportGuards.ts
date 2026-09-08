/**
 * The one thing every export operation does before anything else.
 *
 * Purpose: `exportToHtml`, `exportToPdf`, `exportToPdfNative` and `copyAsHtml`
 * each carried their own `markdown.trim()` test and their own identical toast,
 * so a change to what "empty" means — or to which toast says so — had four
 * places to miss (audit 20260907 round 3, #697). `copyAsHtml` is the case that
 * proves it: it had no guard at all until #347 added a FOURTH copy.
 *
 * @module export/exportGuards
 */

import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";

/** Whether there is anything to export, refusing with the shared toast if not. */
export function hasExportableContent(markdown: string): boolean {
  if (markdown.trim()) return true;
  toast.error(i18n.t("dialog:toast.exportNoContent"));
  return false;
}
