/**
 * PDF Export Page
 *
 * Purpose: Page-level wrapper for the PDF Export native window.
 * Reads rendered HTML from a temp file (path passed via URL params),
 * applies theme, and renders PdfExportContent.
 *
 * @coordinates-with pdfExportWindow.ts — opens this page in a native window
 * @coordinates-with PdfExportDialog.tsx — PdfExportContent component
 * @module pages/PdfExportPage
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useTheme } from "@/hooks/useTheme";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";
import { PdfExportContent } from "@/export/PdfExportDialog";

/** Handle Cmd+W to close PDF export window */
function usePdfExportClose() {
  useEffect(() => {
    const currentWindow = getCurrentWebviewWindow();
    const unlistenPromise = listen<string>("menu:close", async (event) => {
      if (event.payload === "pdf-export") {
        await currentWindow.close();
      }
    });

    return () => {
      safeUnlistenAsync(unlistenPromise);
    };
  }, []);
}

export function PdfExportPage() {
  const { t } = useTranslation(["dialog", "common"]);
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [defaultName, setDefaultName] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  useTheme();
  usePdfExportClose();

  // Load HTML from temp file on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const htmlPath = params.get("htmlPath");
    const name = params.get("defaultName");

    if (name) setDefaultName(name);

    if (!htmlPath) {
      setError(t("dialog:pdfExport.missingPath"));
      return;
    }

    readTextFile(htmlPath)
      .then((html) => setRenderedHtml(html))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setError(t("dialog:pdfExport.loadFailed", { error: msg }));
      });
  }, [t]);

  const handleClose = async () => {
    const currentWindow = getCurrentWebviewWindow();
    await currentWindow.close();
  };

  if (error) {
    return (
      <div className="relative flex h-screen bg-[var(--bg-primary)]">
        <div data-tauri-drag-region className="absolute top-0 left-0 right-0 h-12" />
        <div className="flex items-center justify-center flex-1 pt-12">
          <p className="text-sm text-[var(--text-secondary)]">{error}</p>
        </div>
      </div>
    );
  }

  if (!renderedHtml) {
    return (
      <div className="relative flex h-screen bg-[var(--bg-primary)]">
        <div data-tauri-drag-region className="absolute top-0 left-0 right-0 h-12" />
        <div className="flex items-center justify-center flex-1 pt-12">
          <p className="text-sm text-[var(--text-secondary)]">{t("common:loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen bg-[var(--bg-primary)]">
      <PdfExportContent
        renderedHtml={renderedHtml}
        defaultName={defaultName}
        onClose={handleClose}
      />

      {/* Title centered across the full window */}
      <div
        data-tauri-drag-region
        className="absolute top-0 left-0 right-0 h-12 flex items-center justify-center pointer-events-none"
      >
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {t("dialog:pdfExport.title")}
        </span>
      </div>
    </div>
  );
}
