/**
 * Export Menu Events Hook
 *
 * Purpose: Handles export menu events — HTML export, PDF export,
 *   copy-as-HTML to clipboard, and Pandoc export (optional).
 *
 * Pipeline: Rust menu event → Tauri listen() → flush WYSIWYG content →
 *   render ExportSurface (for visual parity) → save to disk / clipboard / open PDF dialog
 *
 * Key decisions:
 *   - Export module dynamically imported to avoid loading exportStyles.css at startup
 *   - Uses ExportSurface for rendered output identical to what user sees
 *   - Reentry guard prevents double-export from rapid clicks
 *   - Export folder name derived from document filename
 *
 * @coordinates-with exportNaming.ts — folder/file naming conventions
 * @coordinates-with wysiwygFlush.ts — flushActiveWysiwygNow before export
 * @module hooks/useExportMenuEvents
 */
import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { safeUnlistenAll } from "@/utils/safeUnlisten";
// Export module is dynamically imported to avoid loading exportStyles.css at startup.
// This prevents CSS cascade conflicts between dev and prod builds.
import { menuError } from "@/utils/debug";
import { getDirectory } from "@/utils/pathUtils";
import { getExportFolderName } from "@/utils/exportNaming";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { withReentryGuard } from "@/utils/reentryGuard";
import { getActiveDocument } from "@/utils/activeDocument";

/** Hook that handles export menu events (HTML, PDF, Pandoc, copy-as-HTML) for the current window. */
export function useExportMenuEvents(): void {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      // Clean up any existing listeners first
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);

      if (cancelled) return;

      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      // Export menu events - share single "export" guard per window
      // Uses ExportSurface for visual parity
      const unlistenExportHtml = await currentWindow.listen<string>("menu:export-html", async (event) => {
        if (event.payload !== windowLabel) return;
        flushActiveWysiwygNow();

        await withReentryGuard(windowLabel, "export", async () => {
          const doc = getActiveDocument(windowLabel);
          if (!doc) return;
          // Use H1 as folder name, fall back to file name, then "Untitled"
          const defaultName = getExportFolderName(doc.content, doc.filePath);
          const defaultDir = doc.filePath ? getDirectory(doc.filePath) : undefined;
          try {
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
      });
      if (cancelled) { unlistenExportHtml(); return; }
      unlistenRefs.current.push(unlistenExportHtml);

      // Print: browser-based print flow (Cmd+P)
      const unlistenPrint = await currentWindow.listen<string>("menu:export-pdf", async (event) => {
        if (event.payload !== windowLabel) return;
        flushActiveWysiwygNow();

        await withReentryGuard(windowLabel, "export", async () => {
          const doc = getActiveDocument(windowLabel);
          if (!doc) return;
          try {
            const { exportToPdf } = await import("@/export/useExportOperations");
            await exportToPdf({ markdown: doc.content });
          } catch (error) {
            menuError("Failed to print:", error);
          }
        });
      });
      if (cancelled) { unlistenPrint(); return; }
      unlistenRefs.current.push(unlistenPrint);

      // Export PDF: native Paged.js + WKWebView dialog (macOS)
      const unlistenExportPdfNative = await currentWindow.listen<string>("menu:export-pdf-native", async (event) => {
        if (event.payload !== windowLabel) return;
        flushActiveWysiwygNow();

        await withReentryGuard(windowLabel, "export", async () => {
          const doc = getActiveDocument(windowLabel);
          if (!doc) return;
          const defaultName = getExportFolderName(doc.content, doc.filePath);
          try {
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
      });
      if (cancelled) { unlistenExportPdfNative(); return; }
      unlistenRefs.current.push(unlistenExportPdfNative);

      // Export via Pandoc — one listener per format (menu:export-pandoc-{ext})
      const { PANDOC_FORMAT_KEYS } = await import("@/export/pandocExport");
      for (const fmt of PANDOC_FORMAT_KEYS) {
        const unlisten = await currentWindow.listen<string>(`menu:export-pandoc-${fmt}`, async (event) => {
          if (event.payload !== windowLabel) return;
          flushActiveWysiwygNow();

          await withReentryGuard(windowLabel, "export", async () => {
            const doc = getActiveDocument(windowLabel);
            if (!doc) return;
            const defaultName = getExportFolderName(doc.content, doc.filePath);
            const defaultDir = doc.filePath ? getDirectory(doc.filePath) : undefined;
            try {
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
        });
        if (cancelled) { unlisten(); return; }
        unlistenRefs.current.push(unlisten);
      }

      // Pandoc hint — open pandoc.org when clicked
      const unlistenPandocHint = await currentWindow.listen<string>("menu:export-pandoc-hint", async (event) => {
        if (event.payload !== windowLabel) return;
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl("https://pandoc.org/installing.html");
      });
      if (cancelled) { unlistenPandocHint(); return; }
      unlistenRefs.current.push(unlistenPandocHint);

      const unlistenCopyHtml = await currentWindow.listen<string>("menu:copy-html", async (event) => {
        if (event.payload !== windowLabel) return;
        flushActiveWysiwygNow();

        await withReentryGuard(windowLabel, "export", async () => {
          const doc = getActiveDocument(windowLabel);
          if (!doc) return;
          try {
            const { copyAsHtml } = await import("@/export/useExportOperations");
            await copyAsHtml(doc.content);
          } catch (error) {
            menuError("Failed to copy HTML:", error);
          }
        });
      });
      if (cancelled) { unlistenCopyHtml(); return; }
      unlistenRefs.current.push(unlistenCopyHtml);
    };

    setupListeners().catch((error) => {
      menuError("Failed to setup export menu listeners:", error);
    });

    return () => {
      cancelled = true;
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);
    };
  }, []);
}
