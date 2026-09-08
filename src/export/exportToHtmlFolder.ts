/**
 * The HTML FOLDER export — pick a destination, render, hand it to `exportHtml`,
 * and report what came back.
 *
 * Purpose: split out of `useExportOperations.ts` (round 3) when that file passed
 * the 300-line limit. It is also the answer to #696, which asked for this
 * operation's folder-selection and result-presentation halves to stop sharing a
 * function with the print and clipboard paths: what is left there is the print
 * pipeline and the clipboard, and this is the one operation that writes a
 * directory.
 *
 * @coordinates-with src/export/useExportOperations.ts — re-exports these
 * @coordinates-with src/export/htmlExport.ts — does the writing
 * @module export/exportToHtmlFolder
 */

import { save } from "@tauri-apps/plugin-dialog";
import { imeToast as toast } from "@/services/ime/imeToast";
import { exportWarn, exportError } from "@/utils/debug";
import i18n from "@/i18n";
import { exportHtml } from "./htmlExport";
import { renderMarkdownToHtml } from "./renderMarkdownToHtml";
import { useSettingsStore } from "@/stores/settingsStore";
import { joinPath } from "@/utils/pathUtils";
import { showError, FileErrors } from "@/services/dialogs/errorDialog";
import { commandErrorMessage } from "@/services/commands/commandError";
import { hasExportableContent } from "./exportGuards";

/**
 * The document folder an HTML export writes into, from the path the save panel
 * returned: the placeholder `.html` dropped — unless dropping it leaves NO
 * folder name (the user typed exactly `.html`), where the path is kept whole so
 * the export cannot escape into the parent directory and publish over its files.
 */
export function exportFolderPath(selectedPath: string): string {
  const stripped = selectedPath.replace(/\.html$/i, "");
  const slash = Math.max(stripped.lastIndexOf("/"), stripped.lastIndexOf("\\"));
  const basename = slash >= 0 ? stripped.slice(slash + 1) : stripped;
  return basename === "" ? selectedPath : stripped;
}

/**
 * Say what happened, once the files are written.
 *
 * `warnings` holds CATEGORIES — every missing resource is summarised into one
 * line — so its LENGTH said "1 resource could not be included" for three
 * missing images (audit round 3, #699). `missingCount` is the number the
 * sentence claims to be reporting. A warning with no missing resource is an
 * asset that would not embed: real, but not a count of resources, so it gets
 * its own sentence rather than a wrong number.
 */
function presentExportResult(result: {
  warnings: string[];
  missingCount: number;
}): void {
  if (result.warnings.length > 0) exportWarn("Warnings:", result.warnings);
  if (result.missingCount > 0) {
    toast.warning(i18n.t("dialog:toast.exportHtmlResourceWarning", { count: result.missingCount }));
  } else if (result.warnings.length > 0) {
    toast.warning(i18n.t("dialog:toast.exportHtmlAssetWarning"));
  }
  toast.success(i18n.t("dialog:toast.exportHtmlSuccess"));
}

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

  if (!hasExportableContent(markdown)) return false;

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

    // Strip the .html the panel needed — but never down to the PARENT folder,
    // whose index.html this export would then replace (audit round 2).
    const folderPath = exportFolderPath(selectedPath);

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

    presentExportResult(result);
    return true;
  } catch (error) {
    exportError("Failed to export HTML:", error);
    await showError(FileErrors.exportFailed("HTML"), commandErrorMessage(error));
    return false;
  }
}
