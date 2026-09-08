/**
 * Export Operations
 *
 * Print: sends self-contained HTML to the Rust `print_document` command
 * (helper webview + system print dialog). HTML Export: ExportSurface.
 */

import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { imeToast as toast } from "@/services/ime/imeToast";

import { exportError, pdfError, printError } from "@/utils/debug";
import i18n from "@/i18n";
import { renderMarkdownToHtml } from "./renderMarkdownToHtml";
import { showError, FileErrors } from "@/services/dialogs/errorDialog";
import { getActiveTabId } from "@/services/navigation/activeDocument";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { readPrintStatus } from "./printOutcome";
import { hasExportableContent } from "./exportGuards";

// Re-exported, not moved away: `services/commands/exportCommands.ts` and the
// export test suite reach the folder export through this module, and the split
// is about file size, not about relocating a public entry point.
export {
  exportFolderPath,
  exportToHtml,
  type ExportToHtmlOptions,
} from "./exportToHtmlFolder";
import {
  buildPrintHtml,
  prepareExportBody,
  liveEditorElement,
  renderPrintableHtml,
} from "./printDocument";

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
  if (!hasExportableContent(markdown)) return;

  await exportToPdfBrowser(markdown, sourceFilePath ?? null);
}

/** Export PDF: opens the settings window; the native renderer writes the file (all platforms). */
export async function exportToPdfNative(options: ExportToPdfOptions): Promise<void> {
  const { markdown, defaultName, sourceFilePath } = options;
  if (!hasExportableContent(markdown)) return;

  try {
    // Light-theme render with images inlined as data URIs (self-contained).
    const renderedHtml = await renderPrintableHtml(markdown, sourceFilePath ?? null);

    // Open PDF export in native window
    const { openPdfExportWindow } = await import("@/services/navigation/pdfExportWindow");
    await openPdfExportWindow({
      renderedHtml,
      defaultName,
    });
  } catch (error) {
    pdfError("Failed to open PDF dialog:", error);
    // The detail, not just the headline: the HTML and print paths both hand the
    // raw error on (`errorDetail` normalizes a typed CommandError through
    // `commandErrorMessage`), and this one discarded it — so a refused render
    // or a missing window said only "could not prepare PDF" (audit round 3,
    // #701).
    toast.errorDetail(i18n.t("dialog:toast.failedToPreparePdf"), error);
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
 * WI-PDF4.1). Only a `completed` outcome toasts (WI-FL6.3).
 *
 * The HTML comes from the focused pane's live editor when it is showing the
 * window's active tab — the document `export.pdf` resolved (fast path,
 * WYSIWYG) — and from an ExportSurface render of the markdown otherwise:
 * Source mode, or a split whose focused pane is not WYSIWYG (#346). Either
 * way the local images are inlined first (#999): the helper webview has no
 * Tauri asset:// handler. See printDocument.ts for each step.
 */
async function exportToPdfBrowser(
  markdown: string,
  sourceFilePath: string | null = null,
): Promise<void> {
  try {
    const activeTabId = getActiveTabId(getCurrentWindowLabel());
    const source = pickPrintHtmlSource(liveEditorElement(activeTabId), markdown);
    if (source.kind === "empty") {
      toast.error(i18n.t("dialog:toast.noEditorContentToPrint"));
      return;
    }

    // `renderPrintableHtml` IS render-then-inline, and the native-PDF path
    // already calls it. Spelling the two steps out here left one printable-body
    // recipe in two places, free to drift (audit round 3, #702); the LIVE
    // branch is the only one that differs, because its HTML is already
    // rendered and needs the inlining half alone.
    const body =
      source.kind === "live"
        ? await prepareExportBody(source.html, sourceFilePath)
        : await renderPrintableHtml(source.markdown, sourceFilePath);
    const fullHtml = await buildPrintHtml(body);

    const { invoke } = await import("@tauri-apps/api/core");
    const outcome = await invoke<unknown>("print_document", { html: fullHtml });
    if (readPrintStatus(outcome) === "completed") toast.success(i18n.t("dialog:toast.printCompleted"));
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
 * Copy rendered HTML to clipboard. Unstyled by design: the optional branch that
 * prefixed the captured theme CSS had no caller and was removed (WI-FL3.9).
 * Empty content is refused with the same toast as the export operations.
 *
 * The markup is the same BODY every other export path produces (audit R2,
 * #703/#704): unsanitized and unresolved, it carried ProseMirror's artifacts
 * and `asset://` URLs that resolve nowhere outside VMark, so every image broke
 * on paste. `sourceFilePath` is what a relative image is relative TO.
 */
export async function copyAsHtml(markdown: string, sourceFilePath: string | null = null): Promise<boolean> {
  if (!hasExportableContent(markdown)) return false;
  try {
    const rendered = await renderMarkdownToHtml(markdown, true);
    const html = await prepareExportBody(rendered, sourceFilePath);
    await writeText(html);

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
