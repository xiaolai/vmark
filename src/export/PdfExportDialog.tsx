/**
 * PDF Export Content
 *
 * Orchestrates PDF export: live scrollable multi-page preview (left) and
 * settings sidebar (right). Uses Paged.js for paginated preview in an iframe.
 * Preview is always light/white theme. Dialog chrome respects user's theme.
 *
 * Rendered as a native Tauri window via PdfExportPage.tsx.
 *
 * @module export/PdfExportDialog
 * @coordinates-with PdfSettingsSidebar.tsx — settings panel component
 * @coordinates-with pdfHtmlTemplate.ts — builds the HTML for preview and export
 * @coordinates-with pdf_export/commands.rs — Rust backend for final PDF generation
 * @coordinates-with PdfExportPage.tsx — page wrapper that hosts this component
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { buildPdfHtml, buildPdfExportHtml, type PdfOptions } from "./pdfHtmlTemplate";
import { captureThemeCSS, isDarkTheme } from "./themeSnapshot";
import { getEditorContentCSS } from "./htmlExportStyles";
import { useSettingsStore } from "@/stores/settingsStore";
import { PdfSettingsSidebar } from "./PdfSettingsSidebar";
import { pdfPreviewError } from "@/utils/debug";

import "./pdf-export-dialog.css";

// --- Page dimensions (px at 96dpi) ---

const PAGE_DIMS: Record<string, { w: number; h: number }> = {
  a4: { w: 794, h: 1123 },       // 210mm × 297mm
  letter: { w: 816, h: 1056 },   // 8.5in × 11in
  a3: { w: 1123, h: 1587 },      // 297mm × 420mm
  legal: { w: 816, h: 1344 },    // 8.5in × 14in
};

function getPageDims(size: string, orientation: string): { w: number; h: number } {
  const dims = PAGE_DIMS[size] ?? PAGE_DIMS.a4;
  return orientation === "landscape" ? { w: dims.h, h: dims.w } : dims;
}

// --- Types ---

interface PdfExportContentProps {
  renderedHtml: string;
  defaultName?: string;
  onClose: () => void;
}

// --- Component ---

/** Renders the PDF export dialog with live paginated preview and settings sidebar. */
export function PdfExportContent({
  renderedHtml,
  defaultName,
  onClose,
}: PdfExportContentProps) {
  // Font choices inherited from user's editor settings
  const appearance = useSettingsStore.getState().appearance;
  const { t } = useTranslation("export");
  const { t: tDialog } = useTranslation("dialog");

  const [options, setOptions] = useState<PdfOptions>({
    pageSize: "a4",
    orientation: "portrait",
    marginTop: 25.4,
    marginRight: 25.4,
    marginBottom: 25.4,
    marginLeft: 25.4,
    showPageNumbers: true,
    showHeader: true,
    showDate: false,
    title: defaultName?.replace(/\.[^.]+$/, "") ?? t("pdf.defaultTitle"),
    fontSize: 11,
    lineHeight: 1.6,
    cjkLetterSpacing: "0.05em",
    latinFont: appearance.latinFont,
    cjkFont: appearance.cjkFont,
    useEditorTheme: false,
  });

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportStage, setExportStage] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [previewScale, setPreviewScale] = useState(0.5);

  const pageDims = getPageDims(options.pageSize, options.orientation);

  // Compute scale: fit page WIDTH into the preview container width
  useEffect(() => {
    const container = previewContainerRef.current;
    if (!container) return;

    const updateScale = () => {
      const rect = container.getBoundingClientRect();
      const padding = 64;
      const availW = rect.width - padding;
      if (availW <= 0) return;
      const scale = availW / pageDims.w;
      setPreviewScale(Math.min(scale, 0.9));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(container);
    return () => observer.disconnect();
  }, [pageDims.w]);

  // Capture theme + content CSS once; also capture dark mode state
  const themeCSSRef = useRef(captureThemeCSS());
  const contentCSSRef = useRef(getEditorContentCSS());
  const isDarkRef = useRef(isDarkTheme());

  // Build HTML for the iframe preview (with Paged.js)
  const buildHtml = useCallback(() => {
    return buildPdfHtml(
      renderedHtml,
      themeCSSRef.current,
      contentCSSRef.current,
      options,
      isDarkRef.current,
    );
  }, [renderedHtml, options]);

  // Build lightweight HTML for export (no Paged.js — uses native print pipeline)
  const buildExportHtml = useCallback(() => {
    return buildPdfExportHtml(
      renderedHtml,
      themeCSSRef.current,
      contentCSSRef.current,
      options,
      isDarkRef.current,
    );
  }, [renderedHtml, options]);

  // Update iframe on options change (debounced)
  useEffect(() => {
    setLoading(true);
    setPageCount(0);
    setContentHeight(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      iframe.srcdoc = buildHtml();
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [buildHtml]);

  // Listen for Paged.js completion messages from iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "pagedjs-complete") {
        setLoading(false);
        setPreviewError(false);
        if (typeof e.data.pageCount === "number") {
          setPageCount(e.data.pageCount);
        }
        if (typeof e.data.contentHeight === "number") {
          setContentHeight(e.data.contentHeight);
        }
      } else if (e.data?.type === "pagedjs-error") {
        setLoading(false);
        setPreviewError(true);
        pdfPreviewError("Paged.js error:", e.data.message);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Preview timeout — if Paged.js doesn't complete in 30s, show error
  const [previewError, setPreviewError] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      if (loading) {
        setLoading(false);
        setPreviewError(true);
      }
    }, 30000);
    return () => clearTimeout(timer);
  }, [loading]);

  // Listen for progress events from Rust PDF renderer
  useEffect(() => {
    const stageKeys: Record<string, string> = {
      loading: "pdf.progress.loading",
      rendering: "pdf.progress.rendering",
      done: "pdf.progress.done",
    };
    const unlisten = listen<{ stage: string }>(
      "pdf-export-progress",
      (event) => {
        const key = stageKeys[event.payload.stage];
        setExportStage(key ? t(key) : event.payload.stage);
      },
    );
    return () => { unlisten.then((f) => f()); };
  }, [t]);

  // Extract headings from rendered HTML for PDF bookmarks
  const extractHeadings = useCallback(() => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(renderedHtml, "text/html");
    const nodes = doc.querySelectorAll("h1, h2, h3, h4, h5, h6");
    return Array.from(nodes).map((el) => ({
      level: parseInt(el.tagName[1], 10),
      text: (el.textContent ?? "").trim(),
    })).filter((h) => h.text.length > 0);
  }, [renderedHtml]);

  // Export to PDF — uses WebKit's native print pipeline for pagination.
  const handleExport = useCallback(async () => {
    try {
      setExporting(true);
      setExportStage(t("pdf.progress.preparing"));
      const outputPath = await save({
        defaultPath: `${options.title ?? t("pdf.defaultTitle")}.pdf`,
        title: t("pdf.saveDialog.title"),
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!outputPath) {
        setExporting(false);
        setExportStage("");
        return;
      }

      const html = buildExportHtml();
      const headings = extractHeadings();
      await invoke("export_pdf", { html, outputPath, headings });
      toast.success(tDialog("toast.pdfExportSuccess"));
      onClose();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(tDialog("toast.pdfExportFailed", { error: msg }));
      setExporting(false);
      setExportStage("");
    }
  }, [buildExportHtml, extractHeadings, options.title, onClose, t, tDialog]);

  // Update a single option
  const setOption = useCallback(
    <K extends keyof PdfOptions>(key: K, value: PdfOptions[K]) => {
      setOptions((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  // Iframe dimensions: full content height when available, else single page
  const iframeW = pageDims.w;
  const iframeH = contentHeight > 0 ? contentHeight : pageDims.h;

  return (
    <div className="pdf-export-body">
      {/* Preview — left side, scrollable multi-page */}
      <div className="pdf-export-preview-wrapper">
        <div data-tauri-drag-region className="pdf-export-drag-region" />
        <div className="pdf-export-preview" ref={previewContainerRef}>
        {loading && (
          <div className="pdf-export-preview-loading">
            {t("pdf.preview.rendering")}
          </div>
        )}
        {previewError && (
          <div className="pdf-export-preview-loading">
            {t("pdf.preview.failed")}
          </div>
        )}
        <div
          className="pdf-export-page-sizer"
          style={{
            width: iframeW * previewScale,
            height: iframeH * previewScale,
          }}
        >
          <div
            className="pdf-export-page-frame"
            style={{
              width: iframeW,
              height: iframeH,
              transform: `scale(${previewScale})`,
            }}
          >
            <iframe
              ref={iframeRef}
              title={t("pdf.preview.iframeTitle")}
              sandbox="allow-scripts"
            />
          </div>
        </div>
        </div>
        {/* Page count indicator */}
        {pageCount > 0 && (
          <div className="pdf-export-page-count">
            {t("pdf.preview.pageCount", { count: pageCount })}
          </div>
        )}
      </div>

      {/* Settings — right side */}
      <PdfSettingsSidebar
        options={options}
        onOptionChange={setOption}
        onExport={handleExport}
        exporting={exporting}
        exportStage={exportStage}
      />
    </div>
  );
}
