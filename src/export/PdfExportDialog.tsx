/**
 * PDF Export Content
 *
 * Settings-only PDF export panel. No preview — rendering a faithful preview
 * requires the full WebKit print pipeline, which already runs at export time.
 * After export succeeds, the saved PDF is opened in the OS default viewer
 * (Preview.app on macOS).
 *
 * Rendered as a native Tauri window via PdfExportPage.tsx.
 *
 * @module export/PdfExportDialog
 * @coordinates-with PdfSettingsSidebar.tsx — settings panel component
 * @coordinates-with pdfHtmlTemplate.ts — builds the HTML for export
 * @coordinates-with pdf_export/commands.rs — Rust backend for PDF generation
 * @coordinates-with PdfExportPage.tsx — page wrapper that hosts this component
 */

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";
import { save } from "@tauri-apps/plugin-dialog";
import { imeToast as toast } from "@/services/ime/imeToast";
import { useTranslation } from "react-i18next";
import { buildPdfExportHtml, type PdfOptions } from "./pdfHtmlTemplate";
import { captureThemeCSS, isDarkTheme } from "./themeSnapshot";
import { getEditorContentCSS } from "./htmlExportStyles";
import { useSettingsStore } from "@/stores/settingsStore";
import { PdfSettingsSidebar } from "./PdfSettingsSidebar";
import { pdfError } from "@/utils/debug";

import "./pdf-export-dialog.css";
import { commandErrorMessage } from "@/services/commands/commandError";
import { buildPageSpec } from "./pageSpec";
import { buildPageNumberSpec, effectiveBottomMarginMm } from "./pdfOptions";

interface PdfExportContentProps {
  renderedHtml: string;
  /**
   * `| undefined`: the export window reads this off a URL query param that is
   * simply absent for an untitled document, and React treats a prop passed as
   * `undefined` as not supplied.
   */
  defaultName?: string | undefined;
  onClose: () => void;
}

/** Renders the PDF export settings panel and handles export. */
export function PdfExportContent({
  renderedHtml,
  defaultName,
  onClose,
}: PdfExportContentProps) {
  const appearance = useSettingsStore.getState().appearance;
  const { t } = useTranslation("export");
  const { t: tDialog } = useTranslation("dialog");

  // defaultName already comes from getExportFolderName, which returns the H1
  // heading or the file basename (extension stripped). Stripping here again
  // would clobber dot-containing titles like "2026.04.27 Notes" → "2026.04".
  const baseName = defaultName || t("pdf.defaultTitle");

  // Idempotent ".pdf" suffix: avoid `report.pdf.pdf` when the title already
  // ends in `.pdf`, and guarantee the saved file is `.pdf` even when the
  // user typed a name without an extension (the save panel no longer
  // appends one because we dropped `filters` for macOS Tahoe parity).
  const ensurePdfExtension = (path: string): string =>
    /\.pdf$/i.test(path) ? path : `${path}.pdf`;

  const [options, setOptions] = useState<PdfOptions>({
    pageSize: "a4",
    orientation: "portrait",
    marginTop: 25.4,
    marginRight: 25.4,
    marginBottom: 25.4,
    marginLeft: 25.4,
    fontSize: 11,
    lineHeight: 1.6,
    cjkLetterSpacing: "0.05em",
    latinFont: appearance.latinFont,
    cjkFont: appearance.cjkFont,
    useEditorTheme: false,
    // On by default: a printed document is expected to carry page numbers, and
    // the control to turn them off is right there in this dialog.
    pageNumberPosition: "bottom-center",
    pageNumberFormat: "plain",
    pageNumberSkipFirst: false,
  });

  const [exporting, setExporting] = useState(false);
  const [exportStage, setExportStage] = useState("");

  // Snapshot theme + content CSS once at mount
  const [themeCSS] = useState(() => captureThemeCSS());
  const [contentCSS] = useState(() => getEditorContentCSS());
  const [isDark] = useState(() => isDarkTheme());

  // Listen for progress events from Rust PDF renderer
  useEffect(() => {
    const stageKeys: Record<string, string> = {
      loading: "pdf.progress.loading",
      rendering: "pdf.progress.rendering",
      // The renderer emits this when the PDF exists but the outline and page
      // numbers are still being written; `export_pdf` emits "done" after.
      finishing: "pdf.progress.finishing",
      done: "pdf.progress.done",
    };
    const unlisten = listen<{ stage: string }>(
      "pdf-export-progress",
      (event) => {
        const key = stageKeys[event.payload.stage];
        setExportStage(key ? t(key) : event.payload.stage);
      },
    );
    return () => { safeUnlistenAsync(unlisten); };
  }, [t]);

  const extractHeadings = useCallback(() => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(renderedHtml, "text/html");
    const nodes = doc.querySelectorAll("h1, h2, h3, h4, h5, h6");
    return Array.from(nodes).map((el) => ({
      level: parseInt(el.tagName[1], 10),
      text: (el.textContent ?? "").trim(),
    })).filter((h) => h.text.length > 0);
  }, [renderedHtml]);

  const handleExport = useCallback(async () => {
    try {
      setExporting(true);
      setExportStage(t("pdf.progress.preparing"));
      // Strip filters per macOS Tahoe parity rule (see saveDialogWithFallback).
      // setAllowedFileTypes was deprecated in macOS 26; keeping the filter
      // makes the save panel reject pasted text and silently delete typed
      // input on Tahoe. The default filename already carries .pdf.
      const chosenPath = await save({
        defaultPath: ensurePdfExtension(baseName),
        title: t("pdf.saveDialog.title"),
      });
      if (!chosenPath) {
        setExporting(false);
        setExportStage("");
        return;
      }
      // Without `filters`, the macOS save panel won't auto-append `.pdf` if
      // the user typed a bare name. Guarantee the suffix server-side.
      const outputPath = ensurePdfExtension(chosenPath);

      const html = buildPdfExportHtml(
        renderedHtml,
        themeCSS,
        contentCSS,
        options,
        isDark,
      );
      const headings = extractHeadings();
      // Same `options` that generated the @page CSS above, so the stylesheet
      // and the backend geometry cannot disagree. Windows and Linux ignore
      // `@page { size }` entirely (ADR-PDF1), which is why this is sent at all.
      const page = buildPageSpec(options.pageSize, options.orientation, {
        top: options.marginTop,
        right: options.marginRight,
        // Reserved, not requested — see effectiveBottomMarginMm. Windows and
        // Linux take their page box from here rather than from the CSS, so
        // passing the raw value would leave the footer overlapping there while
        // macOS was correct.
        bottom: effectiveBottomMarginMm(options),
        left: options.marginLeft,
      });
      // The template is localized HERE and substituted backend-side, because the
      // page count is not known until the render finishes.
      //
      // `t`, NOT `tDialog`: the key lives in export.json. i18next returns the
      // KEY when it misses, and that key is pure ASCII — so the backend would
      // have accepted it and stamped the literal "pdf.pageNumbers.verboseTemplate"
      // on every page rather than failing.
      const pageNumbers = buildPageNumberSpec(
        options,
        t("pdf.pageNumbers.verboseTemplate"),
        isDark,
      );
      // Post-processing is best-effort, so the command can succeed with the
      // outline or the page numbers missing. Saying "exported" flatly in that
      // case tells the user a setting they turned on worked when it did not.
      const outcome = await invoke<{ warnings?: string[] }>("export_pdf", {
        html, outputPath, headings, page, pageNumbers,
      });
      const warnings = outcome?.warnings ?? [];
      if (warnings.length > 0) {
        toast.warning(
          tDialog("toast.pdfExportPartial", {
            what: warnings.map((w) => t(`pdf.warning.${w}`)).join(", "),
          }),
          { pin: true },
        );
      } else {
        toast.success(tDialog("toast.pdfExportSuccess"));
      }

      // Open in default viewer (Preview.app on macOS). Non-fatal if it fails.
      try {
        await openPath(outputPath);
      } catch (openErr) {
        pdfError("Failed to open exported PDF:", openErr);
      }

      onClose();
    } catch (error) {
      const msg = commandErrorMessage(error);
      // Pin: PDF export errors (Paged.js / WKWebView) include details users
      // want to read carefully (asset paths, render failures).
      toast.error(tDialog("toast.pdfExportFailed", { error: msg }), { pin: true });
      setExporting(false);
      setExportStage("");
    }
  }, [baseName, renderedHtml, themeCSS, contentCSS, options, isDark, extractHeadings, onClose, t, tDialog]);

  const setOption = useCallback(
    <K extends keyof PdfOptions>(key: K, value: PdfOptions[K]) => {
      setOptions((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  return (
    <div className="pdf-export-body">
      <PdfSettingsSidebar
        options={options}
        onOptionChange={setOption}
        onExport={() => void handleExport()}
        exporting={exporting}
        exportStage={exportStage}
      />
    </div>
  );
}
