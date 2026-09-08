/**
 * Source-mode alert inserts.
 *
 * Purpose: map the five `insertAlert*` toolbar actions onto GitHub-style alert
 * blocks and hand them to the shared selection-aware builder. Split out of
 * `sourceInsertActions.ts` when the `[TOC]` insert (WI-FL3.10) pushed that
 * file past the size limit; the alert vocabulary is the one self-contained
 * group there.
 *
 * @coordinates-with sourceInsertActions.ts — `handleBuildInsert`, the builder path
 * @coordinates-with sourceAdapter.ts — dispatcher routes the alert actions here
 * @module plugins/toolbarActions/sourceAlertActions
 */

import type { EditorView } from "@codemirror/view";
import { buildAlertBlock, type AlertType } from "@/plugins/sourceContextDetection/sourceInsertions";
import { handleBuildInsert } from "./sourceInsertActions";

/** Alert insert action IDs handled in source mode. */
type SourceAlertAction =
  | "insertAlertNote"
  | "insertAlertTip"
  | "insertAlertImportant"
  | "insertAlertWarning"
  | "insertAlertCaution";

const ALERT_TYPE_BY_ACTION: Record<SourceAlertAction, AlertType> = {
  insertAlertNote: "NOTE",
  insertAlertTip: "TIP",
  insertAlertImportant: "IMPORTANT",
  insertAlertWarning: "WARNING",
  insertAlertCaution: "CAUTION",
};

/**
 * Insert a GitHub-style alert. A non-empty selection is quoted line-by-line
 * under the alert marker instead of being discarded.
 */
export function handleInsertAlert(view: EditorView, action: SourceAlertAction): boolean {
  const alertType = ALERT_TYPE_BY_ACTION[action];
  return handleBuildInsert(view, (selection) => buildAlertBlock(alertType, selection));
}
