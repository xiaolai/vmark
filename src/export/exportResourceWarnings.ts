/**
 * Export resource warnings
 *
 * Surfaces images that could not be embedded during Print / Export PDF. The
 * off-screen WKWebView that renders the output has no Tauri asset:// handler,
 * so any image `resolveResources` cannot inline is swapped for the "Image not
 * found" placeholder. That substitution used to be silent (dev-only
 * `exportWarn`); we log every offending path and raise a single count toast so
 * the user knows the output is missing images (issue #1086, fix #3).
 *
 * @module export/exportResourceWarnings
 */

import { imeToast as toast } from "@/services/ime/imeToast";
import { exportWarn } from "@/utils/debug";
import i18n from "@/i18n";
import type { ResourceReport } from "./resourceResolver";

export function warnMissingResources(report: ResourceReport): void {
  if (report.missing.length === 0) return;
  for (const resource of report.missing) {
    exportWarn("Image could not be embedded for export:", resource.originalSrc);
  }
  toast.warning(
    i18n.t("dialog:toast.exportImageWarning", { count: report.missing.length }),
  );
}
