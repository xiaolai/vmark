/**
 * Export Operations
 *
 * Uses ExportSurface for visual-parity exports.
 * Guarantees the same rendering as the WYSIWYG editor.
 */

import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
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

/** Event name for print request */
const PRINT_REQUEST_EVENT = "export:print-request";

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
  /** Default filename without extension */
  defaultName?: string;
  /** Default directory */
  defaultDirectory?: string;
  /** Style mode */
  style?: "plain" | "styled";
  /** Packaging mode */
  packaging?: "folder" | "single";
  /** Source file path for resource resolution */
  sourceFilePath?: string | null;
}

/**
 * Export markdown to HTML file with visual parity.
 */
export async function exportToHtml(
  options: ExportToHtmlOptions
): Promise<boolean> {
  const {
    markdown,
    defaultName = "document",
    defaultDirectory,
    style = "styled",
    packaging = "folder",
    sourceFilePath,
  } = options;

  try {
    // Get save path
    const filename = `${defaultName}.html`;
    const defaultPath = defaultDirectory ? joinPath(defaultDirectory, filename) : filename;
    const path = await save({
      defaultPath,
      filters: [{ name: "HTML", extensions: ["html", "htm"] }],
    });

    if (!path) return false;

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
      style,
      packaging,
      title: defaultName.replace(/\.[^.]+$/, ""),
      sourceFilePath,
      outputPath: path,
      fontSettings,
      forceLightTheme: true,
    });

    if (!result.success) {
      throw new Error(result.error ?? "Export failed");
    }

    if (result.warnings.length > 0) {
      console.warn("[Export] Warnings:", result.warnings);
      // Surface warnings to user
      const count = result.warnings.length;
      toast.warning(
        count === 1
          ? "1 resource could not be included"
          : `${count} resources could not be included`
      );
    }

    return true;
  } catch (error) {
    console.error("[Export] Failed to export HTML:", error);
    await showError(FileErrors.exportFailed("HTML"));
    return false;
  }
}

/**
 * Export markdown to PDF via print dialog.
 * Opens a preview window with ExportSurface rendering.
 */
export async function exportToPdf(
  markdown: string,
  title: string = "Document",
  sourceFilePath?: string | null
): Promise<void> {
  try {
    // Check if preview window already exists
    const existing = await WebviewWindow.getByLabel("print-preview");
    if (existing) {
      await existing.close();
    }

    // Preprocess markdown to resolve relative image paths
    let processedMarkdown = markdown;
    if (sourceFilePath) {
      processedMarkdown = resolveImagePaths(markdown, sourceFilePath);
    }

    // Also store in localStorage for fallback
    localStorage.setItem("vmark-print-content", processedMarkdown);

    // Create new print preview window
    const previewWindow = new WebviewWindow("print-preview", {
      url: "/print-preview",
      title: `Print - ${title}`,
      width: 800,
      height: 900,
      center: true,
      resizable: true,
    });

    // Wait for window to be ready, then send content via event
    previewWindow.once("tauri://created", async () => {
      // Small delay to ensure window is fully initialized
      await new Promise((r) => setTimeout(r, 100));

      await emit(PRINT_REQUEST_EVENT, {
        markdown: processedMarkdown,
        title,
        lightTheme: true,
      });
    });
  } catch (error) {
    console.error("[Export] Failed to export PDF:", error);
    await showError(FileErrors.exportFailed("PDF"));
  }
}

/**
 * Resolve relative image paths in markdown to absolute file:// URLs.
 */
function resolveImagePaths(markdown: string, sourceFilePath: string): string {
  // Get directory of source file
  const sourceDir = sourceFilePath.replace(/[/\\][^/\\]*$/, "");

  // Match markdown images: ![alt](path)
  // Also match HTML images: <img src="path"
  return markdown
    .replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (_match, alt, path) => {
        const resolvedPath = resolvePath(path, sourceDir);
        return `![${alt}](${resolvedPath})`;
      }
    )
    .replace(
      /<img([^>]*?)src=["']([^"']+)["']/gi,
      (_match, attrs, path) => {
        const resolvedPath = resolvePath(path, sourceDir);
        return `<img${attrs}src="${resolvedPath}"`;
      }
    );
}

/**
 * Normalize path for convertFileSrc on Windows.
 * Windows paths use backslashes which convertFileSrc doesn't handle correctly.
 */
function normalizePathForAsset(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Resolve a path relative to a directory and convert to asset:// URL.
 */
function resolvePath(path: string, sourceDir: string): string {
  // Skip absolute URLs, data URLs, and already-converted asset URLs
  if (path.startsWith("http://") || path.startsWith("https://") ||
      path.startsWith("data:") || path.startsWith("file://") ||
      path.startsWith("asset://") || path.startsWith("tauri://")) {
    return path;
  }

  // Handle relative paths
  if (path.startsWith("./")) {
    path = path.slice(2);
  }

  // Build absolute path and convert to asset:// URL
  const absolutePath = `${sourceDir}/${path}`;
  return convertFileSrc(normalizePathForAsset(absolutePath));
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
