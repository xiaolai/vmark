/**
 * Export Operations
 *
 * Print: Injects @media print styles and calls window.print() on the main webview.
 * HTML Export: Uses ExportSurface for visual-parity rendering.
 */

import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { imeToast as toast } from "@/utils/imeToast";
import { createRoot } from "react-dom/client";
import React from "react";

import { ExportSurface, type ExportSurfaceRef } from "./ExportSurface";
import { exportWarn, exportError, pdfError, printError } from "@/utils/debug";
import i18n from "@/i18n";
import { exportHtml } from "./htmlExport";
import { waitForAssets } from "./waitForAssets";
import { captureThemeCSS } from "./themeSnapshot";
import { useSettingsStore } from "@/stores/settingsStore";
import { joinPath } from "@/utils/pathUtils";
import { showError, FileErrors } from "@/utils/errorDialog";
import { isMacPlatform } from "@/utils/shortcutMatch";

/** Timeout for waiting on assets (fonts, images, math, diagrams) */
const ASSET_WAIT_TIMEOUT = 10000;

/** Maximum time to wait for render before giving up */
const RENDER_TIMEOUT = 15000;

/**
 * Render markdown to HTML using ExportSurface.
 * Creates a temporary DOM element, renders ExportSurface, waits for stability,
 * then extracts the HTML.
 */
async function renderMarkdownToHtml(
  markdown: string,
  lightTheme: boolean = true
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Guard against multiple resolution (timeout vs callback race)
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // Create temporary container
    const container = document.createElement("div");
    container.style.cssText = "position: absolute; left: -9999px; top: -9999px;";
    document.body.appendChild(container);

    const surfaceRef = React.createRef<ExportSurfaceRef>();
    let root: ReturnType<typeof createRoot> | null = null;

    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      root?.unmount();
      if (container.parentNode) {
        document.body.removeChild(container);
      }
    };

    const complete = (html: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(html);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const handleReady = async () => {
      if (settled) return;
      try {
        // Wait for assets
        const surfaceContainer = surfaceRef.current?.getContainer();
        if (surfaceContainer) {
          await waitForAssets(surfaceContainer, { timeout: ASSET_WAIT_TIMEOUT });
        }

        // Extract HTML
        const html = surfaceRef.current?.getHTML() ?? "";
        complete(html);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    };

    const handleError = (error: Error) => {
      fail(error);
    };

    // Render ExportSurface
    try {
      root = createRoot(container);
      root.render(
        React.createElement(ExportSurface, {
          ref: surfaceRef,
          markdown,
          lightTheme,
          onReady: handleReady,
          onError: handleError,
        })
      );
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    // Timeout fallback
    timeoutId = setTimeout(() => {
      if (settled) return;
      const html = surfaceRef.current?.getHTML();
      if (html) {
        complete(html);
      } else {
        fail(new Error(i18n.t("dialog:toast.exportRenderTimedOut")));
      }
    }, RENDER_TIMEOUT);
  });
}

/** Options for the exportToHtml operation. */
export interface ExportToHtmlOptions {
  /** Markdown content */
  markdown: string;
  /** Default folder name (document title) */
  defaultName?: string;
  /** Default parent directory */
  defaultDirectory?: string;
  /** Source file path for resource resolution */
  sourceFilePath?: string | null;
}

/**
 * Export markdown to HTML folder.
 *
 * Creates:
 * - DocumentName/index.html (external CSS/JS/images)
 * - DocumentName/standalone.html (all embedded)
 * - DocumentName/assets/ (CSS, JS, images)
 */
export async function exportToHtml(
  options: ExportToHtmlOptions
): Promise<boolean> {
  const {
    markdown,
    defaultName = "document",
    defaultDirectory,
    sourceFilePath,
  } = options;

  // Check for empty content
  const trimmedContent = markdown.trim();
  if (!trimmedContent) {
    toast.error(i18n.t("dialog:toast.exportNoContent"));
    return false;
  }

  try {
    // User picks/creates a folder
    // Note: On macOS, the save panel requires a file-like path to populate the filename field.
    // We append a placeholder extension that will be stripped from the final folder name.
    const safeName = `${defaultName}.html`;
    const defaultPath = defaultDirectory
      ? joinPath(defaultDirectory, safeName)
      : safeName;

    // Strip filters per macOS Tahoe parity rule (saveDialogWithFallback).
    // The default filename already carries .html, and the user can edit it.
    const selectedPath = await save({
      defaultPath,
      title: i18n.t("dialog:toast.exportHtmlDialogTitle"),
    });

    if (!selectedPath) return false;

    // Strip the .html extension if present (user might have edited the name)
    const folderPath = selectedPath.replace(/\.html$/i, "");

    // Render markdown to HTML
    const html = await renderMarkdownToHtml(markdown, true);

    // Get font settings
    const settings = useSettingsStore.getState();
    const fontSettings = {
      fontFamily: settings.appearance.latinFont,
      monoFontFamily: settings.appearance.monoFont,
    };

    // Export with options
    const result = await exportHtml(html, {
      title: defaultName.replace(/\.[^.]+$/, ""),
      sourceFilePath,
      outputPath: folderPath,
      fontSettings,
      forceLightTheme: true,
    });

    if (!result.success) {
      throw new Error(result.error ?? "Export failed");
    }

    if (result.warnings.length > 0) {
      exportWarn("Warnings:", result.warnings);
      const count = result.warnings.length;
      toast.warning(i18n.t("dialog:toast.exportHtmlResourceWarning", { count }));
    }

    toast.success(i18n.t("dialog:toast.exportHtmlSuccess"));
    return true;
  } catch (error) {
    exportError("Failed to export HTML:", error);
    const detail = error instanceof Error ? error.message : String(error);
    await showError(FileErrors.exportFailed("HTML"), detail);
    return false;
  }
}

/** Options for the exportToPdf (print) operation. */
export interface ExportToPdfOptions {
  /** Markdown content */
  markdown: string;
  /** Default file name (document title) */
  defaultName?: string;
  /** Source file path for resource resolution */
  sourceFilePath?: string | null;
}

/**
 * Print via native macOS print dialog (Rust-side WKWebView).
 * On non-macOS platforms, print is not supported (menu item hidden).
 */
export async function exportToPdf(options: ExportToPdfOptions): Promise<void> {
  const { markdown } = options;

  const trimmedContent = markdown.trim();
  if (!trimmedContent) {
    toast.error(i18n.t("dialog:toast.exportNoContent"));
    return;
  }

  if (!isMacPlatform()) {
    toast.error(i18n.t("dialog:toast.printRequiresMac"));
    return;
  }

  await exportToPdfBrowser(markdown);
}

/**
 * Export PDF: opens a preview dialog with Paged.js pagination, then exports
 * via WKWebView's native createPDF API (macOS only).
 */
export async function exportToPdfNative(options: ExportToPdfOptions): Promise<void> {
  const { markdown, defaultName, sourceFilePath } = options;

  const trimmedContent = markdown.trim();
  if (!trimmedContent) {
    toast.error(i18n.t("dialog:toast.exportNoContent"));
    return;
  }

  if (!isMacPlatform()) {
    toast.error(i18n.t("dialog:toast.nativePdfRequiresMac"));
    return;
  }

  try {
    // Render markdown to HTML (always light theme)
    const renderedHtml = await renderMarkdownToHtml(markdown, true);

    // Resolve images to data URIs for self-contained HTML
    const { resolveResources, getDocumentBaseDir } = await import(
      "./resourceResolver"
    );
    const baseDir = sourceFilePath
      ? await getDocumentBaseDir(sourceFilePath)
      : "/";
    const { html: resolvedHtml } = await resolveResources(renderedHtml, {
      baseDir,
      mode: "single",
    });

    // Open PDF export in native window
    const { openPdfExportWindow } = await import("@/utils/pdfExportWindow");
    await openPdfExportWindow({
      renderedHtml: resolvedHtml,
      defaultName,
    });
  } catch (error) {
    pdfError("Failed to open PDF dialog:", error);
    toast.error(i18n.t("dialog:toast.failedToPreparePdf"));
  }
}

/**
 * Print via native macOS print dialog (Rust-side WKWebView).
 *
 * The app's WKWebView can't paginate properly with window.print() because
 * printOperationWithPrintInfo uses the webview's frame size. Instead, we
 * invoke a Rust command that creates a separate off-screen WKWebView,
 * loads the rendered HTML, and shows the native print dialog — same
 * approach as PDF export but with the print panel visible.
 *
 * Note: In WYSIWYG mode this reads HTML directly from the live editor DOM
 * (`.ProseMirror`) for speed rather than re-rendering via ExportSurface
 * (which Export PDF uses). The trade-off is slightly different output
 * between Print and Export PDF (live DOM may include editor UI artifacts).
 *
 * In Source mode there is no `.ProseMirror` element, so we fall back to
 * rendering the markdown via ExportSurface — slower but correct, instead of
 * showing a misleading "no content to print" error.
 */
/**
 * Decide where to source the HTML for printing.
 * Exposed for tests; production callers use `exportToPdfBrowser`.
 *
 * @internal
 */
export type PrintHtmlSource =
  | { kind: "live"; html: string }
  | { kind: "render"; markdown: string }
  | { kind: "empty" };

export function pickPrintHtmlSource(
  editorEl: Element | null,
  markdown: string,
): PrintHtmlSource {
  if (editorEl) return { kind: "live", html: editorEl.innerHTML };
  if (markdown.trim()) return { kind: "render", markdown };
  return { kind: "empty" };
}

async function exportToPdfBrowser(markdown: string): Promise<void> {
  try {
    // Read HTML directly from the live editor DOM for instant print in
    // WYSIWYG mode. This bypasses ExportSurface (used by Export PDF) for
    // speed — trade-off is that local images use asset:// URLs which the
    // off-screen WKWebView can resolve via file URL access. For
    // visual-parity export, use Export PDF.
    //
    // In Source mode there is no `.ProseMirror` element, so the source
    // resolver returns a "render" decision and we fall back to
    // ExportSurface — slower but correct, instead of showing a misleading
    // "no content to print" error.
    const source = pickPrintHtmlSource(document.querySelector(".ProseMirror"), markdown);
    let html: string;
    if (source.kind === "live") {
      html = source.html;
    } else if (source.kind === "render") {
      html = await renderMarkdownToHtml(source.markdown, true);
    } else {
      toast.error(i18n.t("dialog:toast.noEditorContentToPrint"));
      return;
    }

    const themeCSS = captureThemeCSS();
    const { getEditorContentCSS } = await import("./htmlExportStyles");
    const contentCSS = getEditorContentCSS();
    const { getKatexCSS, getForceLightThemeCSS, getSharedContentCSS } = await import("./pdfHtmlTemplate");

    // Build a self-contained HTML document for the print WKWebView
    // Always force light theme — dark backgrounds waste ink and look wrong on paper
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Print</title>
  <style>
${getKatexCSS()}
${themeCSS}
${getForceLightThemeCSS()}
${contentCSS}

@page { margin: 1.5cm; }
body { background: var(--bg-color); color: var(--text-color); margin: 0; padding: 2em; }
${getSharedContentCSS()}
  </style>
</head>
<body>
  <div class="export-surface">
    <div class="export-surface-editor tiptap-editor">
${html}
    </div>
  </div>
</body>
</html>`;

    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("print_document", { html: fullHtml });
  } catch (error) {
    printError("Failed to print:", error);
    toast.error(i18n.t("dialog:toast.failedToOpenPrintDialog"));
  }
}

/**
 * Copy rendered HTML to clipboard.
 */
export async function copyAsHtml(
  markdown: string,
  includeStyles: boolean = false
): Promise<boolean> {
  try {
    // Render markdown to HTML
    const html = await renderMarkdownToHtml(markdown, true);

    if (includeStyles) {
      const themeCSS = captureThemeCSS();
      const styledHtml = `<style>${themeCSS}</style>\n${html}`;
      await writeText(styledHtml);
    } else {
      await writeText(html);
    }

    toast.success(i18n.t("dialog:toast.htmlCopied"));
    return true;
  } catch (error) {
    exportError("Failed to copy HTML:", error);
    await showError(FileErrors.copyFailed);
    return false;
  }
}

/**
 * Get rendered HTML from markdown (for programmatic use).
 */
export async function getRenderedHtml(
  markdown: string,
  lightTheme: boolean = true
): Promise<string> {
  return renderMarkdownToHtml(markdown, lightTheme);
}
