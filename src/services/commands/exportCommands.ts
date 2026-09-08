/**
 * Export commands — ADR-012 migration of useExportMenuEvents.
 *
 * FIVE eager commands (`export.html`, `.pdf`, `.pdfNative`, `.copyHtml` and the
 * Pandoc install hint), plus ONE lazy command per Pandoc format registered by
 * `registerPandocFormatCommands` — six formats today, but the count comes from
 * `PANDOC_FORMAT_KEYS` inside a dynamically-loaded module, so it is not a number
 * this header can state (audit #893: it claimed "6 export commands" and there
 * were five eager ones).
 *
 * ONE envelope for every document export (audit #904). `runDocExport` owns the
 * whole of it — the re-entry guard, the WYSIWYG flush, the active-document
 * lookup, the failure log and the failure toast — and the Pandoc handlers go
 * through it too. They used to carry their own copy, and the two copies had
 * already drifted: Pandoc toasted its failure, the eager exports only logged
 * theirs (audit #897).
 *
 * @module services/commands/exportCommands
 */

import i18n from "@/i18n";
import { registerCommands, type CommandContext, type CommandDefinition } from "./CommandBus";
import { reportCommandFailure } from "./commandFailure";
import { getDirectory } from "@/utils/pathUtils";
import { getExportFolderName } from "@/utils/exportNaming";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { withReentryGuard } from "@/utils/reentryGuard";
import { getActiveDocument } from "@/services/navigation/activeDocument";

type Args = unknown;
type Ctx = { windowLabel?: string };
type ExportDoc = { content: string; filePath: string | null };

function windowLabelOf(ctx: Ctx): string {
  return ctx.windowLabel ?? "main";
}

/**
 * Whether this window has a document to export (audit #896).
 *
 * Used as the `when` predicate of every document-scoped export: without it the
 * palette offered "Export as HTML" with no document open, and dispatching it
 * reported success while doing nothing at all. `when` is honoured by BOTH
 * `searchCommands` (so the row disappears) and `executeCommand` (so the menu
 * item reports a refusal rather than a silent no-op).
 */
function hasExportableDocument(ctx: CommandContext): boolean {
  return getActiveDocument(windowLabelOf(ctx as Ctx)) !== null;
}

/**
 * Run one document export under the shared envelope.
 *
 * The flush is INSIDE the guard (audit #895). It used to run before it, so a
 * re-entrant click — rejected, doing nothing else — still mutated the document
 * store under the export that was already running, and a flusher that threw
 * rejected the command dispatch from outside every catch in this module.
 *
 * A contained failure is LOGGED AND SHOWN, through the one shared policy in
 * `commandFailure.ts` (#897). Only logging it left a lazy-chunk load failure or
 * a disk-full error looking exactly like a click that had done nothing.
 * `failureMessage` overrides the shown text where a translated sentence beats
 * the raw error.
 */
async function runDocExport(
  ctx: Ctx,
  errorLabel: string,
  exec: (doc: ExportDoc) => Promise<void>,
  failureMessage: (() => string) | undefined,
): Promise<void> {
  const windowLabel = windowLabelOf(ctx);
  await withReentryGuard(windowLabel, "export", async () => {
    try {
      flushActiveWysiwygNow();
      const doc = getActiveDocument(windowLabel);
      if (!doc) return;
      await exec(doc);
    } catch (error) {
      reportCommandFailure(error, { label: errorLabel, message: failureMessage?.() });
    }
  });
}

interface DocExportSpec {
  id: string;
  /** Palette label; defaults to the `commands:<id>` key. */
  title?: () => string;
  /** Log prefix for a contained failure. */
  errorLabel: string;
  exec: (doc: ExportDoc) => Promise<void>;
  /** Translated failure text; omit to show the underlying error's own message. */
  failureMessage?: () => string;
}

/** A document-scoped export command over the shared envelope. Pure — no registration. */
function docExportCommand(spec: DocExportSpec): CommandDefinition {
  return {
    id: spec.id,
    title: spec.title ?? (() => i18n.t(`commands:${spec.id}`)),
    category: "export",
    when: hasExportableDocument,
    run: async (_args: Args, ctx: Ctx) =>
      runDocExport(ctx, spec.errorLabel, spec.exec, spec.failureMessage),
  };
}

/** Owner token the eager export batch registers under (HMR-safe, atomic). */
const EXPORT_COMMANDS_OWNER = "export-commands";

/** Build the eager export command specs (pure — no registration). */
function buildExportCommandSpecs(): CommandDefinition[] {
  return [
    docExportCommand({
      id: "export.html",
      errorLabel: "Failed to export HTML:",
      exec: async (doc) => {
        const defaultName = getExportFolderName(doc.content, doc.filePath);
        const defaultDir = doc.filePath ? getDirectory(doc.filePath) : undefined;
        const { exportToHtml } = await import("@/export/useExportOperations");
        await exportToHtml({
          markdown: doc.content,
          defaultName,
          defaultDirectory: defaultDir,
          sourceFilePath: doc.filePath,
        });
      },
    }),

    docExportCommand({
      id: "export.pdf",
      errorLabel: "Failed to print:",
      exec: async (doc) => {
        const { exportToPdf } = await import("@/export/useExportOperations");
        await exportToPdf({ markdown: doc.content, sourceFilePath: doc.filePath });
      },
    }),

    docExportCommand({
      id: "export.pdfNative",
      errorLabel: "Failed to export PDF:",
      exec: async (doc) => {
        const defaultName = getExportFolderName(doc.content, doc.filePath);
        const { exportToPdfNative } = await import("@/export/useExportOperations");
        await exportToPdfNative({
          markdown: doc.content,
          defaultName,
          sourceFilePath: doc.filePath,
        });
      },
    }),

    docExportCommand({
      id: "export.copyHtml",
      errorLabel: "Failed to copy HTML:",
      exec: async (doc) => {
        const { copyAsHtml } = await import("@/export/useExportOperations");
        // The path is what a relative image in the copied markup resolves
        // against (audit R2, #704).
        await copyAsHtml(doc.content, doc.filePath);
      },
    }),

    {
      id: "export.pandocHint",
      title: () => i18n.t("commands:export.pandocHint"),
      category: "export",
      // Needs no document, but it DOES need to report a refusal (audit #900).
      // An `openUrl` the opener plugin rejects — a scheme outside the
      // capability, no registered handler — otherwise left the click doing
      // nothing, and rejected the dispatch on the way out.
      run: async () => {
        try {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl("https://pandoc.org/installing.html");
        } catch (error) {
          reportCommandFailure(error, { label: "Failed to open the Pandoc install page:" });
        }
      },
    },
  ];
}

/**
 * Register the five eager export commands as ONE owner batch (audit #899).
 *
 * `hasCommand("export.html")` reported the whole batch installed whenever that
 * single id existed — from a foreign registrar, or from a batch that failed
 * after the first command — leaving the other four permanently missing.
 */
export function registerExportCommands(): void {
  registerCommands(EXPORT_COMMANDS_OWNER, buildExportCommandSpecs());
}

/** Owner token the lazy Pandoc batch registers under — DISTINCT from the eager
 *  one, because owner registration is replace-own and a shared token would make
 *  each batch delete the other. */
const PANDOC_COMMANDS_OWNER = "export-pandoc-commands";

/** One Pandoc format's command, over the same envelope as every other export. */
function pandocFormatCommand(fmt: string): CommandDefinition {
  return docExportCommand({
    id: `export.pandoc-${fmt}`,
    title: () => `${i18n.t("commands:export.pandocFormat")} (${fmt})`,
    errorLabel: `Failed to export via Pandoc (${fmt}):`,
    exec: async (doc) => {
      const defaultName = getExportFolderName(doc.content, doc.filePath);
      const defaultDir = doc.filePath ? getDirectory(doc.filePath) : undefined;
      const { exportViaPandoc } = await import("@/export/pandocExport");
      await exportViaPandoc({
        markdown: doc.content,
        format: fmt,
        defaultName,
        defaultDirectory: defaultDir,
        sourceDirectory: defaultDir,
      });
    },
    // Pandoc keeps its OWN message — "Pandoc export failed" names the tool the
    // user has to install, which a raw error string does not. Through the
    // STATIC i18n binding, not a dynamic re-import of the module already
    // imported at the top of this file (audit #905).
    failureMessage: () => i18n.t("dialog:toast.pandocExportFailed"),
  });
}

/**
 * Register one CommandBus entry per Pandoc format (`export.pandoc-html`,
 * etc.). Called lazily by the menu mount because PANDOC_FORMAT_KEYS lives
 * inside the lazy-loaded export module.
 *
 * ONE owner batch (audit #903). The previous `if (hasCommand(id)) continue`
 * could not tell this module's own re-registration — which a menu remount
 * makes on every mount — from a FOREIGN registrar squatting that id, so it
 * silently kept whatever was there, including a stale handler left by HMR.
 * Owner registration replaces its own previous batch and REFUSES a foreign
 * collision loudly, which is the distinction the old comment claimed to make
 * and did not.
 */
export async function registerPandocFormatCommands(): Promise<readonly string[]> {
  const { PANDOC_FORMAT_KEYS } = await import("@/export/pandocExport");
  registerCommands(PANDOC_COMMANDS_OWNER, PANDOC_FORMAT_KEYS.map(pandocFormatCommand));
  return PANDOC_FORMAT_KEYS;
}
