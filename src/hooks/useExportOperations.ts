/**
 * Export Operations (Hooks Layer)
 *
 * Async functions for exporting documents:
 * - Save to HTML/PDF files
 * - Copy to clipboard
 * - Print preview
 *
 * Uses Tauri APIs for file system and clipboard access.
 * Pure conversion functions are in utils/exportUtils.
 */

import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { toast } from "sonner";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  markdownToHtml,
  generateHtmlDocument,
  applyPdfStyles,
} from "@/utils/exportUtils";
import { joinPath } from "@/utils/pathUtils";
import { showError, FileErrors } from "@/utils/errorDialog";
import type { MarkdownPipelineOptions } from "@/utils/markdownPipeline/types";

function getExportPipelineOptions(): MarkdownPipelineOptions {
  return {
    preserveLineBreaks: useSettingsStore.getState().markdown.preserveLineBreaks,
  };
}

/**
 * Export markdown to HTML file
 * @param markdown - The markdown content to export
 * @param defaultName - Default filename without extension
 * @param defaultDirectory - Optional directory to save in (uses last-used if not provided)
 */
export async function exportToHtml(
  markdown: string,
  defaultName: string = "document",
  defaultDirectory?: string
): Promise<boolean> {
  try {
    // Construct full default path with directory if provided
    const filename = `${defaultName}.html`;
    const defaultPath = defaultDirectory ? joinPath(defaultDirectory, filename) : filename;
    const path = await save({
      defaultPath,
      filters: [{ name: "HTML", extensions: ["html", "htm"] }],
    });

    if (!path) return false;

    const title = defaultName.replace(/\.[^.]+$/, "");
    const html = generateHtmlDocument(markdown, title, true, getExportPipelineOptions());

    await writeTextFile(path, html);
    return true;
  } catch (error) {
    console.error("[Export] Failed to export HTML:", error);
    await showError(FileErrors.exportFailed("HTML"));
    return false;
  }
}

/**
 * Export markdown to PDF via print dialog
 * Opens a preview window that the user can print to PDF
 */
export async function exportToPdf(
  markdown: string,
  title: string = "Document"
): Promise<void> {
  try {
    // Check if preview window already exists
    const existing = await WebviewWindow.getByLabel("print-preview");
    if (existing) {
      await existing.close();
    }

    // Store content in localStorage for print preview window to read
    localStorage.setItem("vmark-print-content", markdown);

    // Create new print preview window
    new WebviewWindow("print-preview", {
      url: "/print-preview",
      title: `Print - ${title}`,
      width: 800,
      height: 900,
      center: true,
      resizable: true,
    });
  } catch (error) {
    console.error("[Export] Failed to export PDF:", error);
    await showError(FileErrors.exportFailed("PDF"));
  }
}

/**
 * Copy HTML to clipboard
 */
export async function copyAsHtml(markdown: string): Promise<boolean> {
  try {
    const html = markdownToHtml(markdown, getExportPipelineOptions());
    await writeText(html);
    toast.success("HTML copied to clipboard");
    return true;
  } catch (error) {
    console.error("[Export] Failed to copy HTML:", error);
    await showError(FileErrors.copyFailed);
    return false;
  }
}

/**
 * Export markdown to PDF file directly (using html2pdf.js)
 * @param markdown - The markdown content to export
 * @param defaultName - Default filename without extension
 * @param defaultDirectory - Optional directory to save in (uses last-used if not provided)
 */
export async function savePdf(
  markdown: string,
  defaultName: string = "document",
  defaultDirectory?: string
): Promise<boolean> {
  try {
    // Construct full default path with directory if provided
    const filename = `${defaultName}.pdf`;
    const defaultPath = defaultDirectory ? joinPath(defaultDirectory, filename) : filename;
    const path = await save({
      defaultPath,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (!path) return false;

    // Create a temporary container for rendering
    const container = document.createElement("div");
    container.innerHTML = markdownToHtml(markdown, getExportPipelineOptions());
    container.style.cssText = `
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #1f2328;
      padding: 20px;
      max-width: 100%;
    `;

    // Apply inline styles to elements for PDF rendering
    applyPdfStyles(container);

    // Generate PDF blob
    const { default: html2pdf } = await import("html2pdf.js");
    const pdfBlob = await html2pdf()
      .set({
        margin: [15, 15, 15, 15],
        filename: defaultName,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(container)
      .outputPdf("blob");

    // Convert blob to Uint8Array and save via Tauri
    const arrayBuffer = await pdfBlob.arrayBuffer();
    await writeFile(path, new Uint8Array(arrayBuffer));

    return true;
  } catch (error) {
    console.error("[Export] Failed to save PDF:", error);
    await showError(FileErrors.exportFailed("PDF"));
    return false;
  }
}
