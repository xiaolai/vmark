/**
 * Export commands — ADR-012 migration of useExportMenuEvents.
 *
 * Registers 6 export commands with CommandBus. Handlers preserve the
 * original useExportMenuEvents semantics (reentry guard, dynamic import,
 * activeDocument lookup) and are dispatched via the generic menuListener.
 *
 * @module services/commands/exportCommands
 */

import { registerCommand } from "./CommandBus";
import { menuError } from "@/utils/debug";
import { getDirectory } from "@/utils/pathUtils";
import { getExportFolderName } from "@/utils/exportNaming";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { withReentryGuard } from "@/utils/reentryGuard";
import { getActiveDocument } from "@/services/navigation/activeDocument";

type Args = unknown;
type Ctx = { windowLabel?: string };

async function withDoc(ctx: Ctx, fn: (doc: { content: string; filePath: string | null }, windowLabel: string) => Promise<void>): Promise<void> {
  const windowLabel = ctx.windowLabel ?? "main";
  flushActiveWysiwygNow();
  await withReentryGuard(windowLabel, "export", async () => {
    const doc = getActiveDocument(windowLabel);
    if (!doc) return;
    await fn(doc, windowLabel);
  });
}

let registered = false;
export function registerExportCommands(): void {
  if (registered) return;

  registerCommand({
    id: "export.html",
    title: "Export as HTML",
    category: "export",
    run: async (_args: Args, ctx: Ctx) => {
      await withDoc(ctx, async (doc) => {
        try {
          const defaultName = getExportFolderName(doc.content, doc.filePath);
          const defaultDir = doc.filePath ? getDirectory(doc.filePath) : undefined;
          const { exportToHtml } = await import("@/export/useExportOperations");
          await exportToHtml({
            markdown: doc.content,
            defaultName,
            defaultDirectory: defaultDir,
            sourceFilePath: doc.filePath,
          });
        } catch (error) {
          menuError("Failed to export HTML:", error);
        }
      });
    },
  });

  registerCommand({
    id: "export.pdf",
    title: "Print to PDF",
    category: "export",
    run: async (_args: Args, ctx: Ctx) => {
      await withDoc(ctx, async (doc) => {
        try {
          const { exportToPdf } = await import("@/export/useExportOperations");
          await exportToPdf({ markdown: doc.content });
        } catch (error) {
          menuError("Failed to print:", error);
        }
      });
    },
  });

  registerCommand({
    id: "export.pdfNative",
    title: "Export as PDF",
    category: "export",
    run: async (_args: Args, ctx: Ctx) => {
      await withDoc(ctx, async (doc) => {
        try {
          const defaultName = getExportFolderName(doc.content, doc.filePath);
          const { exportToPdfNative } = await import("@/export/useExportOperations");
          await exportToPdfNative({
            markdown: doc.content,
            defaultName,
            sourceFilePath: doc.filePath,
          });
        } catch (error) {
          menuError("Failed to export PDF:", error);
        }
      });
    },
  });

  registerCommand({
    id: "export.copyHtml",
    title: "Copy as HTML",
    category: "export",
    run: async (_args: Args, ctx: Ctx) => {
      await withDoc(ctx, async (doc) => {
        try {
          const { copyAsHtml } = await import("@/export/useExportOperations");
          await copyAsHtml(doc.content);
        } catch (error) {
          menuError("Failed to copy HTML:", error);
        }
      });
    },
  });

  registerCommand({
    id: "export.pandocHint",
    title: "Install Pandoc",
    category: "export",
    run: async () => {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl("https://pandoc.org/installing.html");
    },
  });

  registered = true;
}

/**
 * Register one CommandBus entry per Pandoc format (`export.pandoc-html`,
 * etc.). Called lazily by the menu mount because PANDOC_FORMAT_KEYS lives
 * inside the lazy-loaded export module.
 */
export async function registerPandocFormatCommands(): Promise<readonly string[]> {
  const { PANDOC_FORMAT_KEYS } = await import("@/export/pandocExport");
  for (const fmt of PANDOC_FORMAT_KEYS) {
    const id = `export.pandoc-${fmt}`;
    try {
      registerCommand({
        id,
        title: `Export via Pandoc (${fmt})`,
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
    } catch {
      // Duplicate registration — idempotent.
    }
  }
  return PANDOC_FORMAT_KEYS;
}
