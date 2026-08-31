/**
 * Export Operations
 *
 * Print: sends self-contained HTML to the Rust `print_document` command
 * (helper webview + system print dialog). HTML Export: ExportSurface.
 */

import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { imeToast as toast } from "@/services/ime/imeToast";

import { exportWarn, exportError, pdfError, printError } from "@/utils/debug";
import i18n from "@/i18n";
import { exportHtml } from "./htmlExport";
import { renderMarkdownToHtml } from "./renderMarkdownToHtml";
import { captureThemeCSS } from "./themeSnapshot";
import { useSettingsStore } from "@/stores/settingsStore";
import { joinPath } from "@/utils/pathUtils";
import { showError, FileErrors } from "@/services/dialogs/errorDialog";
import { commandErrorMessage } from "@/services/commands/commandError";
import { warnMissingResources } from "./exportResourceWarnings";

/** Options for the exportToHtml operation. */
export interface ExportToHtmlOptions {
  /** Markdown content */
  markdown: string;
  /** Default folder name (document title) */
  defaultName?: string | undefined;
  /** Default parent directory; `| undefined` — unsaved docs have no path to derive it from. */
  defaultDirectory?: string | undefined;
  /** Source file path for resource resolution */
  sourceFilePath?: string | null | undefined;
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
    await showError(FileErrors.exportFailed("HTML"), commandErrorMessage(error));
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
 * Print via the system print dialog on all three platforms (WI-PDF4.1):
 * macOS NSPrintOperation, Windows ShowPrintUI, Linux
 * webkit_print_operation_run_dialog — see src-tauri/src/pdf_export/renderer.
 */
export async function exportToPdf(options: ExportToPdfOptions): Promise<void> {
  const { markdown, sourceFilePath } = options;

  const trimmedContent = markdown.trim();
  if (!trimmedContent) {
    toast.error(i18n.t("dialog:toast.exportNoContent"));
    return;
  }

  await exportToPdfBrowser(markdown, sourceFilePath ?? null);
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
    const { html: resolvedHtml, report } = await resolveResources(renderedHtml, { baseDir, mode: "single" });
    warnMissingResources(report);

    // Open PDF export in native window
    const { openPdfExportWindow } = await import("@/services/navigation/pdfExportWindow");
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

/**
 * Print via the Rust-side helper webview and the system print dialog.
 *
 * The app's own webview can't paginate properly with window.print() because
 * printOperationWithPrintInfo uses the webview's frame size. Instead, the
 * `print_document` command builds a separate hidden webview, loads the
 * rendered HTML, and shows the platform's print dialog — same approach as
 * PDF export but with the print panel visible (all three platforms since
 * WI-PDF4.1). Local images are inlined as data-URIs first (#999): the helper
 * webview has no Tauri asset:// handler.
 */
async function exportToPdfBrowser(
  markdown: string,
  sourceFilePath: string | null = null,
): Promise<void> {
  try {
    // Read HTML directly from the live editor DOM for instant print in
    // WYSIWYG mode. This bypasses ExportSurface (used by Export PDF) for
    // speed. Local images in the live DOM use asset:// URLs which the
    // off-screen WKWebView created by `print_document` cannot resolve (it
    // loads a plain file URL and has no Tauri asset protocol handler), so
    // they must be inlined as data URIs below (issue #999). For
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

    // Inline local images (relative/absolute/asset:// paths) as data URIs so
    // the off-screen print WKWebView can load them; remote http(s) URLs pass
    // through untouched. Resolved relative to the source document's directory.
    const { resolveResources, getDocumentBaseDir } = await import("./resourceResolver");
    const baseDir = await getDocumentBaseDir(sourceFilePath);
    const { html: resolvedHtml, report } = await resolveResources(html, { baseDir, mode: "single" });
    html = resolvedHtml;
    warnMissingResources(report);

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
    // "Print failed", not "failed to open print dialog": on Linux a CONFIRMED
    // job that fails afterwards rejects too (#1343), so the dialog may well
    // have opened fine. Raw error — errorDetail owns the normalization
    // (commandErrorMessage), so the typed CommandError renders its message.
    toast.errorDetail(i18n.t("dialog:toast.printFailed"), error);
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
