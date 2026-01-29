/**
 * Hook for export menu event handling.
 *
 * Handles menu:export-html, menu:save-pdf, menu:export-pdf, and menu:copy-html events.
 * Extracted from useMenuEvents to keep file sizes under 300 lines.
 *
 * Uses ExportSurface for visual parity.
 *
 * @module hooks/useExportMenuEvents
 */
import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { toast } from "sonner";
import { exportToHtml, exportToPdf, copyAsHtml } from "@/export";
import { getFileNameWithoutExtension, getDirectory } from "@/utils/pathUtils";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { withReentryGuard } from "@/utils/reentryGuard";
import { getActiveDocument } from "@/utils/activeDocument";

export function useExportMenuEvents(): void {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      // Clean up any existing listeners first
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

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
          const defaultName = doc.filePath
            ? getFileNameWithoutExtension(doc.filePath) || "document"
            : "document";
          const defaultDir = doc.filePath ? getDirectory(doc.filePath) : undefined;
          try {
            const success = await exportToHtml({
              markdown: doc.content,
              defaultName,
              defaultDirectory: defaultDir,
              style: "styled",
              packaging: "folder",
              sourceFilePath: doc.filePath,
            });
            if (success) {
              toast.success("Exported to HTML");
            }
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
          const title = doc.filePath
            ? getFileNameWithoutExtension(doc.filePath) || "Document"
            : "Document";
          try {
            await exportToPdf(doc.content, title, doc.filePath);
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
      const fns = unlistenRefs.current;
      unlistenRefs.current = [];
      fns.forEach((fn) => fn());
    };
  }, []);
}
