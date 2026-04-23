/**
 * PDF Export Window Utility
 *
 * Purpose: Opens the PDF Export dialog as a native Tauri window (singleton).
 * Writes rendered HTML to a temp file and passes the path as a URL param
 * so the new window can load it on mount.
 *
 * Key decisions:
 *   - Uses write_temp_html to pass large HTML content (can be MBs with embedded images)
 *   - Singleton pattern: if window exists, closes and recreates it with fresh content
 *   - Centers over parent window using physical-to-logical pixel conversion
 *
 * @coordinates-with PdfExportPage.tsx — renders the PDF export UI in the new window
 * @coordinates-with lib.rs — write_temp_html Rust command for temp file
 * @module utils/pdfExportWindow
 */

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow";


const PDF_EXPORT_WIDTH = 440;
const PDF_EXPORT_HEIGHT = 640;

/**
 * Calculate position to center PDF Export window over the current window.
 * Returns null if position cannot be determined.
 */
async function calculateCenteredPosition(): Promise<{ x: number; y: number } | null> {
  try {
    const currentWindow = getCurrentWebviewWindow();
    const scaleFactor = await currentWindow.scaleFactor();
    const [position, size] = await Promise.all([
      currentWindow.outerPosition(),
      currentWindow.outerSize(),
    ]);
    const x = Math.round(position.x / scaleFactor + (size.width / scaleFactor - PDF_EXPORT_WIDTH) / 2);
    const y = Math.round(position.y / scaleFactor + (size.height / scaleFactor - PDF_EXPORT_HEIGHT) / 2);
    return { x, y };
  } catch {
    return null;
  }
}

/**
 * Open the PDF Export window with rendered HTML content.
 *
 * - Writes HTML to a temp file via Rust command
 * - If window already exists, closes and recreates with fresh content
 * - If not, creates a new window centered on the current window
 */
export async function openPdfExportWindow(data: {
  renderedHtml: string;
  defaultName?: string;
}): Promise<void> {
  const pos = await calculateCenteredPosition();

  // If PDF Export window already exists, close it so we open fresh content
  const existing = await WebviewWindow.getByLabel("pdf-export");
  if (existing) {
    await existing.close();
  }

  // Write HTML to temp file so the new window can read it
  const htmlPath: string = await invoke("write_temp_html", {
    html: data.renderedHtml,
  });

  // Build URL with params
  const params = new URLSearchParams();
  params.set("htmlPath", htmlPath);
  if (data.defaultName) {
    params.set("defaultName", data.defaultName);
  }

  new WebviewWindow("pdf-export", {
    url: `/pdf-export?${params.toString()}`,
    title: "Export PDF",
    width: PDF_EXPORT_WIDTH,
    height: PDF_EXPORT_HEIGHT,
    minWidth: 380,
    minHeight: 480,
    x: pos?.x,
    y: pos?.y,
    center: !pos,
    resizable: true,
    hiddenTitle: true,
    titleBarStyle: "overlay",
  });
}
