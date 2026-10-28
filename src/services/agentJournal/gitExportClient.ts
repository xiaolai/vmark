/**
 * Git export client — exports one document's edit journal to the branch
 * `vmark-journal/<document-uuid>` of a repository folder the user picked
 * (`agent_journal_git_export`), and reads back why an export was refused.
 *
 * Key decisions:
 *   - The payload is one JSON string like every journal command, so the
 *     folder path and the document key arrive byte for byte.
 *   - The report is checked before it is trusted; a malformed one, or one
 *     bound to another call (`callJournalBoundRaw`), throws.
 *   - A refusal is rethrown unchanged: its `detail.exportCode` is the
 *     contract the command layer translates, and an unknown code reads as
 *     `null` rather than as some other refusal.
 *
 * @coordinates-with src-tauri/src/agent_journal/git_export/command.rs — the command
 * @coordinates-with src-tauri/src/agent_journal/git_export/error.rs — the export codes
 * @module services/agentJournal/gitExportClient
 */

import { commandErrorDetailString } from "@/services/commands/commandError";
import { callJournalBoundRaw } from "./journalIpc";

const COMMAND = "agent_journal_git_export";

const GIT_EXPORT_CODES = [
  "GIT_MISSING",
  "NO_HISTORY",
  "NOT_A_REPOSITORY",
  "INVALID_REQUEST",
  "EXPORT_CONFLICT",
  "UNRELATED_BRANCH",
  "BRANCH_CHECKED_OUT",
  "GIT_FAILED",
  "JOURNAL_ERROR",
] as const;
export type GitExportCode = (typeof GIT_EXPORT_CODES)[number];

export interface GitExportReport {
  /** `vmark-journal/<document-uuid>`. */
  branch: string;
  /** The branch tip after the export; `null` when there was nothing to export. */
  head: string | null;
  commitsCreated: number;
  syntheticCreated: number;
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

function parseReport(reply: unknown): GitExportReport {
  const r = reply as Partial<Record<keyof GitExportReport, unknown>> | null;
  const ok =
    typeof r === "object" &&
    r !== null &&
    typeof r.branch === "string" &&
    r.branch.length > 0 &&
    (r.head === null || (typeof r.head === "string" && r.head.length > 0)) &&
    isCount(r.commitsCreated) &&
    isCount(r.syntheticCreated) &&
    r.syntheticCreated <= r.commitsCreated &&
    // A created commit is the branch's new tip: no head means nothing was exported.
    (r.head !== null || r.commitsCreated === 0);
  if (!ok) throw new Error(`${COMMAND} returned a malformed reply`);
  return r as GitExportReport;
}

/** Export the document `docKey` into the repository containing `repository`. */
export async function exportDocumentToGit(docKey: string, repository: string): Promise<GitExportReport> {
  const reply = await callJournalBoundRaw(COMMAND, {
    payload: JSON.stringify({ docKey, repository }),
  });
  return parseReport(reply);
}

/** The refusal's export code, or `null` when it carries none this client knows. */
export function gitExportFailureCode(error: unknown): GitExportCode | null {
  const code = commandErrorDetailString(error, "exportCode");
  return GIT_EXPORT_CODES.find((c) => c === code) ?? null;
}
