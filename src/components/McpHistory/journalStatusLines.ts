/**
 * Journal status lines — what the history panel must say about whether
 * changes are being recorded: a failed, read-only or behind journal, a
 * queued record of this document, a save the history refused or did not
 * answer in time, live updates that failed (the panel polls instead), what
 * failed beside a recording journal (part of its startup, page
 * registrations refused at the per-window cap, lost cleanup runs, edits
 * recorded as whole-document changes because their selection certificate
 * failed a check, the startup retention pass and its cap warnings), recording turned off by an identity
 * index that could not be used, recording suspended because the document's
 * identity could not be updated, and changes whose automatic revert is
 * blocked.
 *
 * Key decisions:
 *   - An unreadable journal state counts as unavailable: the panel never
 *     implies recording works when it cannot tell.
 *   - A starting journal is not a problem yet; it says nothing.
 *   - A failure the journal names carries its reason (`CODE: message`) in
 *     the line; cap warnings are counted per kind, not listed.
 *   - Identity's effect comes from its mode, not from its error text: a
 *     disabled identity says recording is off, with the reason.
 *   - A queued document is said once, whether the journal's history reply
 *     or this window's save report revealed it.
 *   - No lines means nothing to say; the button's attention state is
 *     exactly "there are lines".
 *
 * @coordinates-with services/agentJournal/journalStatusClient.ts — health
 * @coordinates-with stores/journalRecordingStore.ts — save problems and unbound documents
 * @module components/McpHistory/journalStatusLines
 */

import type { JournalHealth } from "@/services/agentJournal/journalStatusClient";
import type { DocumentHistory } from "@/services/agentJournal/docHistoryClient";
import type { RecordingProblem } from "@/stores/journalRecordingStore";

export interface StatusInput {
  health: JournalHealth | null;
  /** The journal's state could not be read. */
  healthFailed: boolean;
  history: DocumentHistory | null;
  problem: RecordingProblem | null;
  /** A Save As or rename could not carry this document's journal identity: recording is suspended. */
  unbound: boolean;
}

export interface StatusLine {
  tone: "error" | "warning";
  key: string;
  values?: Record<string, string | number>;
}

export function journalStatusLines({ health, healthFailed, history, problem, unbound }: StatusInput): StatusLine[] {
  const lines: StatusLine[] = [];
  if (healthFailed || health?.phase === "failed") {
    const detail = health?.error;
    lines.push(detail ? { tone: "error", key: "mcpHistoryStatusFailedBecause", values: { detail } } : { tone: "error", key: "mcpHistoryStatusFailed" });
  } else if (health?.phase === "ready") lines.push(...readyLines(health));
  if (unbound) lines.push({ tone: "error", key: "mcpHistoryStatusIdentityUnbound" });
  if (problem?.kind === "refused") lines.push({ tone: "error", key: "mcpHistoryStatusRefused", values: { code: problem.code ?? "" } });
  if (problem?.kind === "timeout") lines.push({ tone: "error", key: "mcpHistoryStatusTimeout" });
  if (history?.degraded || problem?.kind === "queued") lines.push({ tone: "warning", key: "mcpHistoryStatusDocQueued" });
  const blocked = history?.blocked.length ?? 0;
  if (blocked > 0) lines.push({ tone: "warning", key: "mcpHistoryStatusBlocked", values: { count: blocked } });
  return lines;
}

/** What a recording journal must still say: its own state, then what failed beside it. */
function readyLines(health: JournalHealth): StatusLine[] {
  const lines: StatusLine[] = [];
  const reason = (key: string, detail: string | null) => {
    if (detail) lines.push({ tone: "warning", key, values: { detail } });
  };
  if (health.readOnly) lines.push({ tone: "error", key: "mcpHistoryStatusReadOnly" });
  if (health.degraded) lines.push({ tone: "warning", key: "mcpHistoryStatusDegraded" });
  if (health.liveUpdates === "failed") lines.push({ tone: "warning", key: "mcpHistoryStatusLiveUpdatesFailed" });
  reason("mcpHistoryStatusStartupProblem", health.error);
  if (health.registrationCapRefusals > 0) lines.push({ tone: "warning", key: "mcpHistoryStatusRegistrationCapRefusals", values: { count: health.registrationCapRefusals } });
  if (health.cleanupWorkerFailures > 0) lines.push({ tone: "warning", key: "mcpHistoryStatusCleanupWorkerFailures", values: { count: health.cleanupWorkerFailures } });
  if (health.uncertifiedFallbacks > 0) lines.push({ tone: "warning", key: "mcpHistoryStatusUncertifiedFallbacks", values: { count: health.uncertifiedFallbacks } });
  if (health.identity === "disabled") lines.push({ tone: "error", key: "mcpHistoryStatusIdentityDisabled", values: { detail: health.identityError ?? "" } });
  const retention = health.retention;
  if (!retention) return lines;
  for (const [kind, key] of [["nearCap", "mcpHistoryStatusRetentionNearCap"], ["pinnedOverCap", "mcpHistoryStatusRetentionPinnedOverCap"]] as const) {
    const count = retention.warnings.filter((w) => w.kind === kind).length;
    if (count > 0) lines.push({ tone: "warning", key, values: { count } });
  }
  reason("mcpHistoryStatusRetentionDeferred", retention.deferred);
  reason("mcpHistoryStatusRetentionBlobError", retention.blobError);
  reason("mcpHistoryStatusRetentionFailed", retention.error);
  return lines;
}
