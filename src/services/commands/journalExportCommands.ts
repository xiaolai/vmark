/**
 * Journal export command — "Export Edit History to Git…": pick a repository
 * folder, export the active document's edit journal to the branch
 * `vmark-journal/<document-uuid>`, and tell the user what happened.
 *
 * Key decisions:
 *   - The folder picker opens in the document's own folder, where its
 *     repository usually is; an untitled document has no default.
 *   - A refusal with a known export code shows its translated sentence; any
 *     other failure shows the backend's own message (commandFailure policy).
 *   - The document is held by its tab AND its incarnation (`documentId`, which
 *     only a new disk baseline moves), not its key: the key is re-resolved
 *     after the picker, so a Save As or rename meanwhile exports the moved
 *     document, a reload of the same file still exports it, and a tab closed
 *     or reused for another file meanwhile exports nothing.
 *   - One export per window at a time: a second trigger while the picker or
 *     the export is still running is dropped, not queued.
 *
 * @coordinates-with services/agentJournal/gitExportClient.ts — the command and its codes
 * @coordinates-with services/commands/commandFailure.ts — the log-and-show policy
 * @module services/commands/journalExportCommands
 */

import { open } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { registerCommands, type CommandDefinition } from "./CommandBus";
import { reportCommandFailure } from "./commandFailure";
import { imeToast as toast } from "@/services/ime/imeToast";
import { getActiveDocument, getActiveTabId } from "@/services/navigation/activeDocument";
import { docKeyFor } from "@/services/agentJournal/documentIdentity";
import { useDocumentStore } from "@/stores/documentStore";
import {
  exportDocumentToGit,
  gitExportFailureCode,
  type GitExportReport,
} from "@/services/agentJournal/gitExportClient";
import { getDirectory } from "@/utils/pathUtils";
import { withReentryGuard } from "@/utils/reentryGuard";

type Ctx = { windowLabel?: string };

/** Owner token this batch registers under (HMR-safe, atomic — see viewCommands). */
const JOURNAL_EXPORT_OWNER = "journal-export-commands";
const REENTRY_OPERATION = "export-journal-git";

interface ExportSource {
  tabId: string;
  /** The document's incarnation when the command started. */
  documentId: number;
  filePath: string | null;
}

/** The active tab and its document's incarnation, or null when none is open. */
function activeExportSource(windowLabel: string): ExportSource | null {
  const tabId = getActiveTabId(windowLabel);
  const doc = getActiveDocument(windowLabel);
  if (!tabId || !doc) return null;
  return { tabId, documentId: doc.documentId, filePath: doc.filePath ?? null };
}

/** The source document's key NOW, or null when the tab no longer holds it.
 *  @edge-case A Save As or rename while the picker was open moves the key but
 *  keeps the incarnation; a reload of the same file moves the incarnation but
 *  keeps the path. A new incarnation at another path is a different document
 *  (a reused untitled tab, an open into the tab), so it exports nothing — as a
 *  closed tab does, even if another tab reopened its old path. */
function currentDocKey(source: ExportSource, windowLabel: string): string | null {
  const doc = useDocumentStore.getState().getDocument(source.tabId);
  if (!doc) return null;
  const filePath = doc.filePath ?? null;
  const sameIncarnation = doc.documentId === source.documentId;
  const reloadedInPlace = source.filePath !== null && filePath === source.filePath;
  if (!sameIncarnation && !reloadedInPlace) return null;
  return docKeyFor({ tabId: source.tabId, filePath }, windowLabel);
}

function successMessage(report: GitExportReport): string {
  if (report.commitsCreated === 0) {
    return i18n.t("export:gitJournal.upToDate", { branch: report.branch });
  }
  return i18n.t("export:gitJournal.done", { count: report.commitsCreated, branch: report.branch });
}

/** Pick the repository, run the export, report the outcome — a failing picker included. */
async function exportActiveDocument(windowLabel: string): Promise<void> {
  const source = activeExportSource(windowLabel);
  if (!source) return;
  const defaultPath = source.filePath ? getDirectory(source.filePath) || undefined : undefined;
  try {
    const picked = await open({
      directory: true,
      multiple: false,
      title: i18n.t("export:gitJournal.pickTitle"),
      ...(defaultPath ? { defaultPath } : {}),
    });
    if (typeof picked !== "string" || picked === "") return;
    const docKey = currentDocKey(source, windowLabel);
    if (docKey === null) return;
    const report = await exportDocumentToGit(docKey, picked);
    toast.success(successMessage(report));
  } catch (error) {
    const code = gitExportFailureCode(error);
    reportCommandFailure(error, {
      label: "Git export of the edit history failed:",
      message: code ? i18n.t(`export:gitJournal.error.${code}`) : undefined,
    });
  }
}

/** Build the journal export command specs (pure — no registration). */
function buildJournalExportSpecs(): CommandDefinition[] {
  return [
    {
      id: "history.exportToGit",
      title: () => i18n.t("commands:history.exportToGit"),
      category: "file",
      when: (ctx) => activeExportSource((ctx as Ctx).windowLabel ?? "main") !== null,
      run: async (_args, ctx: Ctx) => {
        const windowLabel = ctx.windowLabel ?? "main";
        await withReentryGuard(windowLabel, REENTRY_OPERATION, () =>
          exportActiveDocument(windowLabel),
        );
      },
    },
  ];
}

/** Register the journal export command as one owner batch. */
export function registerJournalExportCommands(): void {
  registerCommands(JOURNAL_EXPORT_OWNER, buildJournalExportSpecs());
}
