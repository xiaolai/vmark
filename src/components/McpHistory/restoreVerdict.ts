/**
 * Restore verdict — what the history panel tells the user about a restore's
 * outcome, classified once for both of its restore buttons (a revision of
 * the open document, and an earlier checkpoint).
 *
 * Key decisions:
 *   - Only the problems are shared: an apply that threw after changing the
 *     buffer warns, one that could not be confirmed says the document needs
 *     recovery, and anything else that is not an apply failed. The success
 *     wording (and a checkpoint's fallback) differs per button, so a clean
 *     apply is returned to the caller with whether it changed the text.
 *   - Whether the apply's history record was confirmed on disk is reported
 *     apart from what happened to the text: every verdict carries
 *     `durable`, and an unconfirmed one adds the `NOT_DURABLE_KEY` warning
 *     beside the button's own message. A restore that applied nothing
 *     wrote nothing, so it reads as durable.
 *   - Pure: the caller translates the key and raises the toast.
 *
 * @coordinates-with services/agentJournal/historyRestore.ts — the outcome
 * @coordinates-with DocumentHistoryList.tsx — restore a revision
 * @coordinates-with EarlierCheckpoints.tsx — restore an earlier checkpoint
 * @coordinates-with UncommittedEntries.tsx — restore an unrecorded write
 * @module components/McpHistory/restoreVerdict
 */

import type { HistoryRestoreOutcome } from "@/services/agentJournal/historyRestore";

/** The warning added when an action's history record was not confirmed on disk. */
export const NOT_DURABLE_KEY = "mcpHistoryNotDurable";

type RestoreVerdict =
  | { kind: "applied"; changed: boolean; durable: boolean }
  | {
      kind: "problem";
      tone: "warning" | "error";
      key: "mcpHistoryRestoreAppliedWithError" | "mcpHistoryRestoreRecoveryRequired" | "mcpHistoryRestoreFailed";
      durable: boolean;
    };

/** Classify `outcome`; `null` is a restore that threw before producing one. */
export function classifyRestore(outcome: HistoryRestoreOutcome | null): RestoreVerdict {
  switch (outcome?.status) {
    case "applied":
      return { kind: "applied", changed: outcome.changed, durable: outcome.durable };
    case "appliedWithError":
      return { kind: "problem", tone: "warning", key: "mcpHistoryRestoreAppliedWithError", durable: outcome.durable };
    case "recoveryRequired":
      return { kind: "problem", tone: "error", key: "mcpHistoryRestoreRecoveryRequired", durable: true };
    default:
      return { kind: "problem", tone: "error", key: "mcpHistoryRestoreFailed", durable: true };
  }
}
