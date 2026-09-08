/**
 * Print outcome — what `print_document` reported about the system dialog.
 *
 * Purpose: the one place the frontend reads the `PrintOutcome` wire shape
 * (`src-tauri/src/pdf_export/renderer/outcome.rs`), so the print flow can
 * branch on what the user did rather than treating every `Ok` as "printed"
 * (WI-FL6.3).
 *
 * What each platform can say: macOS reports `completed` or `cancelled` from
 * the print sheet's delegate; Linux from the GTK dialog's response and the
 * job's `finished` signal; Windows only ever `unknown`, because WebView2's
 * `ShowPrintUI` returns nothing once the UI is up.
 *
 * @module export/printOutcome
 * @coordinates-with useExportOperations.ts — the only consumer
 * @coordinates-with pdf_export/renderer/outcome.rs — the producer
 */

import { printError } from "@/utils/debug";

/** The `status` field of a `PrintOutcome`. */
export type PrintStatus = "completed" | "cancelled" | "unknown";

const STATUSES: ReadonlySet<string> = new Set<PrintStatus>([
  "completed",
  "cancelled",
  "unknown",
]);

/**
 * Read the status out of a `print_document` result.
 *
 * A malformed payload is a programming error on our own IPC seam, not a user
 * event: it is logged and read as `unknown`, so the UI stays silent rather
 * than toasting either a failure the user did not see or a success nobody
 * can vouch for.
 */
export function readPrintStatus(outcome: unknown): PrintStatus {
  if (
    typeof outcome === "object" &&
    outcome !== null &&
    "status" in outcome &&
    typeof outcome.status === "string" &&
    STATUSES.has(outcome.status)
  ) {
    return outcome.status as PrintStatus;
  }
  printError("print_document returned an unexpected outcome:", outcome);
  return "unknown";
}
