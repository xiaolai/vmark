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
 * @module services/navigation/pdfExportWindow
 */

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";


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
 * Open the Export PDF window on freshly rendered HTML.
 *
 * The window itself is built by Rust (`open_pdf_export_window`), NOT here.
 * Tauri's JS window options carry no `menu` field, and off macOS the menu bar
 * belongs to each window — so a JS-built dialog inherits the whole application
 * menu, which is #1377. Rust can pass an empty `Menu::new(app)`, the same way
 * the Settings window stays bare.
 *
 * What stays here is the one measurement Rust cannot take: centring needs the
 * CALLING window's scale factor and geometry. Physical pixels are converted to
 * logical ones first, or the dialog lands off-centre on every scaled display.
 */
export async function openPdfExportWindow(data: {
  renderedHtml: string;
  /** `| undefined`: derived from the document title, which may be unset. */
  defaultName?: string | undefined;
}): Promise<void> {
  const pos = await calculateCenteredPosition();

  // Written to a temp file rather than passed inline: with embedded images the
  // HTML runs to megabytes, which is not a URL parameter.
  const htmlPath: string = await invoke("write_temp_html", {
    html: data.renderedHtml,
  });

  await invoke("open_pdf_export_window", {
    htmlPath,
    // Omitted rather than sent empty, so Rust's `Option` means "absent" and not
    // "present but blank" — and omitted together with `y`, because a position
    // is only meaningful as a pair. Rust centres the window when none arrives.
    ...(data.defaultName ? { defaultName: data.defaultName } : {}),
    ...(pos ? { x: pos.x, y: pos.y } : {}),
  });
}
