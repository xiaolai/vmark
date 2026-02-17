/**
 * Export Operations
 *
 * Print: Opens a self-contained HTML file in the system browser for printing.
 * HTML Export: Uses ExportSurface for visual-parity rendering.
 */

import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { createRoot } from "react-dom/client";
import React from "react";

import { ExportSurface, type ExportSurfaceRef } from "./ExportSurface";
import { exportHtml } from "./htmlExport";
import { waitForAssets } from "./waitForAssets";
import { captureThemeCSS } from "./themeSnapshot";
import { useSettingsStore } from "@/stores/settingsStore";
import { joinPath } from "@/utils/pathUtils";
import { showError, FileErrors } from "@/utils/errorDialog";

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

    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      root.unmount();
      document.body.removeChild(container);
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
    const root = createRoot(container);
    root.render(
      React.createElement(ExportSurface, {
        ref: surfaceRef,
        markdown,
        lightTheme,
        onReady: handleReady,
        onError: handleError,
      })
    );

    // Timeout fallback
    timeoutId = setTimeout(() => {
      if (settled) return;
      const html = surfaceRef.current?.getHTML();
      if (html) {
        complete(html);
      } else {
        fail(new Error("Export rendering timeout"));
      }
    }, RENDER_TIMEOUT);
  });
}

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
    toast.error("No content to export!");
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

    const selectedPath = await save({
      defaultPath,
      title: "Export HTML",
      filters: [{ name: "HTML Export", extensions: ["html"] }],
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
      console.warn("[Export] Warnings:", result.warnings);
      const count = result.warnings.length;
      toast.warning(
        count === 1
          ? "1 resource could not be included"
          : `${count} resources could not be included`
      );
    }

    toast.success("Exported to folder");
    return true;
  } catch (error) {
    console.error("[Export] Failed to export HTML:", error);
    await showError(FileErrors.exportFailed("HTML"));
    return false;
  }
}

/**
 * Rewrite asset:// URLs to file:// so the system browser can load local images.
 *
 * In the Tauri webview, images are served via `asset://localhost/path` or
 * `https://asset.localhost/path`. Browsers can't resolve these, but they can
 * load `file:///path` from a locally-opened HTML file.
 */
function rewriteAssetUrls(html: string): string {
  return html
    .replace(/asset:\/\/localhost/g, "file://")
    .replace(/https:\/\/asset\.localhost/g, "file://");
}

/**
 * Print document by opening a self-contained HTML file in the system browser.
 *
 * WKWebView has an internal rendering height cap (~16 384 px at 2× Retina)
 * that truncates long documents when using the native print dialog.
 * Browsers (Safari, Chrome) have a correct CSS pagination engine, so we:
 *  1. Render the markdown via ExportSurface (same as HTML export)
 *  2. Build a styled, self-contained HTML page
 *  3. Write it to a temp file
 *  4. Open it in the default browser, which auto-triggers `window.print()`
 *
 * @param markdown - The markdown content
 */
export async function exportToPdf(markdown: string): Promise<void> {
  // Check for empty content
  const trimmedContent = markdown.trim();
  if (!trimmedContent) {
    toast.error("No content to print!");
    return;
  }

  try {
    // 1. Render markdown to HTML via ExportSurface (always light theme for print)
    const html = await renderMarkdownToHtml(markdown, true);

    // 2. Capture CSS
    const themeCSS = captureThemeCSS();
    const { getEditorContentCSS } = await import("./htmlExport");
    const contentCSS = getEditorContentCSS();

    // 3. Rewrite asset:// URLs to file:// for browser access
    const resolvedHtml = rewriteAssetUrls(html);

    // 4. Build self-contained HTML with auto-print
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Print</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" crossorigin="anonymous">
  <style>
/* Theme Variables */
${themeCSS}

/* Content Styles */
${contentCSS}

/* Print-specific overrides */
@media print {
  @page { margin: 1.5cm; }
  body { background: white; }
  .export-surface { max-width: none; padding: 0; }
  .export-surface-editor .table-scroll-wrapper { overflow-x: visible; }
  .export-surface-editor .table-scroll-wrapper table { width: 100% !important; table-layout: fixed; }
  .export-surface-editor td, .export-surface-editor th { overflow-wrap: break-word; word-break: break-word; }
  .export-surface-editor td img { max-width: 100%; height: auto; }
}
  </style>
</head>
<body>
  <div class="export-surface">
    <div class="export-surface-editor">
${resolvedHtml}
    </div>
  </div>
  <script>
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 300);
    });
  </script>
</body>
</html>`;

    // 5. Write to temp file via Rust
    const filePath: string = await invoke("write_temp_html", { html: fullHtml });

    // 6. Open in system browser
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(`file://${filePath}`);

    toast.success("Opened in browser for printing");
  } catch (error) {
    console.error("[Print] Failed to print:", error);
    toast.error("Failed to open print dialog");
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

    toast.success("HTML copied to clipboard");
    return true;
  } catch (error) {
    console.error("[Export] Failed to copy HTML:", error);
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
