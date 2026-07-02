/**
 * Export commands — ADR-012 migration of useExportMenuEvents.
 *
 * Registers 6 export commands with CommandBus. Handlers preserve the
 * original useExportMenuEvents semantics (reentry guard, dynamic import,
 * activeDocument lookup) and are dispatched via the generic menuListener.
 * Document-scoped handlers share one runner (`registerDocExportCommand`)
 * so the withDoc/try/log envelope can't drift between formats.
 *
 * @module services/commands/exportCommands
 */

import i18n from "@/i18n";
import { hasCommand, registerCommand } from "./CommandBus";
import { menuError } from "@/utils/debug";
import { getDirectory } from "@/utils/pathUtils";
import { getExportFolderName } from "@/utils/exportNaming";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { withReentryGuard } from "@/utils/reentryGuard";
import { getActiveDocument } from "@/services/navigation/activeDocument";

type Args = unknown;
type Ctx = { windowLabel?: string };
type ExportDoc = { content: string; filePath: string | null };

async function withDoc(ctx: Ctx, fn: (doc: ExportDoc, windowLabel: string) => Promise<void>): Promise<void> {
  const windowLabel = ctx.windowLabel ?? "main";
  flushActiveWysiwygNow();
  await withReentryGuard(windowLabel, "export", async () => {
    const doc = getActiveDocument(windowLabel);
    if (!doc) return;
    await fn(doc, windowLabel);
  });
}

/**
 * Register a document-scoped export command: resolve the active document
 * via withDoc, run `exec`, and contain failures with a `menuError` log so
 * a failed export never rejects the command dispatch.
 */
function registerDocExportCommand(
  id: string,
  errorLabel: string,
  exec: (doc: ExportDoc) => Promise<void>,
): void {
  registerCommand({
    id,
    title: () => i18n.t(`commands:${id}`),
    category: "export",
    run: async (_args: Args, ctx: Ctx) => {
      await withDoc(ctx, async (doc) => {
        try {
          await exec(doc);
        } catch (error) {
          menuError(errorLabel, error);
        }
      });
    },
  });
}

let registered = false;
export function registerExportCommands(): void {
  // HMR: the module-local flag resets on reload, but the bus registry survives.
  if (registered || hasCommand("export.html")) return;

  registerDocExportCommand("export.html", "Failed to export HTML:", async (doc) => {
    const defaultName = getExportFolderName(doc.content, doc.filePath);
    const defaultDir = doc.filePath ? getDirectory(doc.filePath) : undefined;
    const { exportToHtml } = await import("@/export/useExportOperations");
    await exportToHtml({
      markdown: doc.content,
      defaultName,
      defaultDirectory: defaultDir,
      sourceFilePath: doc.filePath,
    });
  });

  registerDocExportCommand("export.pdf", "Failed to print:", async (doc) => {
    const { exportToPdf } = await import("@/export/useExportOperations");
    await exportToPdf({ markdown: doc.content, sourceFilePath: doc.filePath });
  });

  registerDocExportCommand("export.pdfNative", "Failed to export PDF:", async (doc) => {
    const defaultName = getExportFolderName(doc.content, doc.filePath);
    const { exportToPdfNative } = await import("@/export/useExportOperations");
    await exportToPdfNative({
      markdown: doc.content,
      defaultName,
      sourceFilePath: doc.filePath,
    });
  });

  registerDocExportCommand("export.copyHtml", "Failed to copy HTML:", async (doc) => {
    const { copyAsHtml } = await import("@/export/useExportOperations");
    await copyAsHtml(doc.content);
  });

  registerCommand({
    id: "export.pandocHint",
    title: () => i18n.t("commands:export.pandocHint"),
    category: "export",
    run: async () => {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl("https://pandoc.org/installing.html");
    },
  });

  registered = true;
}

/** Test-only: clears the one-time registration guard so a fresh bus re-registers. */
export function __resetExportCommandsRegistration(): void {
  registered = false;
}

/**
 * Register one CommandBus entry per Pandoc format (`export.pandoc-html`,
 * etc.). Called lazily by the menu mount because PANDOC_FORMAT_KEYS lives
 * inside the lazy-loaded export module. Already-registered ids are skipped
 * explicitly (menu remounts re-invoke this) so genuine registration bugs
 * still throw instead of being swallowed as "duplicate".
 */
export async function registerPandocFormatCommands(): Promise<readonly string[]> {
  const { PANDOC_FORMAT_KEYS } = await import("@/export/pandocExport");
  for (const fmt of PANDOC_FORMAT_KEYS) {
    const id = `export.pandoc-${fmt}`;
    if (hasCommand(id)) continue;
    registerCommand({
      id,
      title: () => `${i18n.t("commands:export.pandocFormat")} (${fmt})`,
      category: "export",
      run: async (_args: Args, ctx: Ctx) => {
        await withDoc(ctx, async (doc) => {
          try {
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
          } catch (error) {
            menuError(`Failed to export via Pandoc (${fmt}):`, error);
            const { toast } = await import("sonner");
            const i18nMod = await import("@/i18n");
            toast.error(i18nMod.default.t("dialog:toast.pandocExportFailed"));
          }
        });
      },
    });
  }
  return PANDOC_FORMAT_KEYS;
}
