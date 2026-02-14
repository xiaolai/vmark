/**
 * Export Menu Events Hook
 *
 * Purpose: Handles export menu events — HTML export, PDF export, and
 *   copy-as-HTML to clipboard.
 *
 * Pipeline: Rust menu event → Tauri listen() → flush WYSIWYG content →
 *   render ExportSurface (for visual parity) → save to disk or clipboard
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
import { getDirectory } from "@/utils/pathUtils";
import { getExportFolderName } from "@/utils/exportNaming";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { withReentryGuard } from "@/utils/reentryGuard";
import { getActiveDocument } from "@/utils/activeDocument";

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
            const { exportToHtml } = await import("@/export");
            await exportToHtml({
              markdown: doc.content,
              defaultName,
              defaultDirectory: defaultDir,
              sourceFilePath: doc.filePath,
            });
          } catch (error) {
            console.error("[Menu] Failed to export HTML:", error);
          }
        });
      });
      if (cancelled) { unlistenExportHtml(); return; }
      unlistenRefs.current.push(unlistenExportHtml);

      // Print/PDF via print dialog
      const unlistenExportPdf = await currentWindow.listen<string>("menu:export-pdf", async (event) => {
        if (event.payload !== windowLabel) return;
        flushActiveWysiwygNow();

        await withReentryGuard(windowLabel, "export", async () => {
          const doc = getActiveDocument(windowLabel);
          if (!doc) return;
          try {
            const { exportToPdf } = await import("@/export");
            await exportToPdf(doc.content);
          } catch (error) {
            console.error("[Menu] Failed to export PDF:", error);
          }
        });
      });
      if (cancelled) { unlistenExportPdf(); return; }
      unlistenRefs.current.push(unlistenExportPdf);

      const unlistenCopyHtml = await currentWindow.listen<string>("menu:copy-html", async (event) => {
        if (event.payload !== windowLabel) return;
        flushActiveWysiwygNow();

        await withReentryGuard(windowLabel, "export", async () => {
          const doc = getActiveDocument(windowLabel);
          if (!doc) return;
          try {
            const { copyAsHtml } = await import("@/export");
            await copyAsHtml(doc.content);
          } catch (error) {
            console.error("[Menu] Failed to copy HTML:", error);
          }
        });
      });
      if (cancelled) { unlistenCopyHtml(); return; }
      unlistenRefs.current.push(unlistenCopyHtml);
    };

    setupListeners();

    return () => {
      cancelled = true;
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);
    };
  }, []);
}
