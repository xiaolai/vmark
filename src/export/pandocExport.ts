/**
 * Pandoc Export
 *
 * Purpose: Export markdown to various formats (DOCX, EPUB, LaTeX, ODT, RTF,
 *   plain text) via the Pandoc CLI tool. Pandoc must be installed separately.
 *
 * Pipeline: menu:export-pandoc-{fmt} → detect_pandoc → pick_export_target
 *   (Rust's save panel, which records the answer) → export_via_pandoc
 *
 * @coordinates-with services/commands/exportCommands.ts — the export.pandoc* commands call this on menu:export-pandoc-{fmt}
 * @coordinates-with pandoc/commands.rs — Rust backend for Pandoc execution
 * @coordinates-with export_target/commands.rs — the save panel; `export_via_pandoc` writes only its answer
 * @coordinates-with export/pandocFormats.ts — the format keys, readable without this module
 * @module export/pandocExport
 */

import { invoke } from "@tauri-apps/api/core";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { joinPath } from "@/utils/pathUtils";
import { exportError } from "@/utils/debug";
import type { PandocFormatKey } from "./pandocFormats";

/** Pandoc detection result from Rust backend. */
interface PandocInfo {
  available: boolean;
  path: string | null;
  version: string | null;
}

/** Maps format key to display name and file extension. */
const FORMAT_META: Record<PandocFormatKey, { name: string; ext: string }> = {
  docx:  { name: "Word Document", ext: "docx" },
  epub:  { name: "EPUB", ext: "epub" },
  latex: { name: "LaTeX", ext: "tex" },
  odt:   { name: "OpenDocument Text", ext: "odt" },
  rtf:   { name: "Rich Text Format", ext: "rtf" },
  txt:   { name: "Plain Text", ext: "txt" },
};

/**
 * Export markdown via Pandoc in a specific format.
 *
 * 1. Checks if Pandoc is installed.
 * 2. Asks Rust to show the save panel for the chosen format.
 * 3. Invokes the Rust command to pipe markdown through Pandoc.
 */
export async function exportViaPandoc(options: {
  markdown: string;
  format: string;
  defaultName?: string | undefined;
  /** `| undefined` for the same reason as ExportToHtmlOptions.defaultDirectory. */
  defaultDirectory?: string | undefined;
  sourceDirectory?: string | undefined;
}): Promise<boolean> {
  const { markdown, format, defaultName = "document", defaultDirectory, sourceDirectory } = options;

  const meta = FORMAT_META[format as PandocFormatKey];
  if (!meta) {
    toast.error(i18n.t("dialog:toast.pandocUnknownFormat", { format }));
    return false;
  }

  if (!markdown.trim()) {
    toast.error(i18n.t("dialog:toast.pandocNoContent"));
    return false;
  }

  try {
    const info: PandocInfo = await invoke("detect_pandoc");

    if (!info.available) {
      toast.error(i18n.t("dialog:toast.pandocNotInstalled"), {
        duration: 5000,
      });
      return false;
    }

    const fileName = `${defaultName}.${meta.ext}`;
    const defaultPath = defaultDirectory
      ? joinPath(defaultDirectory, fileName)
      : fileName;

    // Rust shows the panel and records the answer as this window's export
    // target; `export_via_pandoc` writes that path and no other. No file-type
    // filter (macOS 26 rejects typed input under one); the default filename
    // already carries the right extension.
    const selectedPath = await invoke<string | null>("pick_export_target", {
      kind: "pandoc",
      defaultPath,
      title: i18n.t("dialog:toast.exportFormatDialogTitle", { name: meta.name }),
    });

    if (!selectedPath) return false;

    await invoke("export_via_pandoc", {
      markdown,
      outputPath: selectedPath,
      sourceDir: sourceDirectory ?? null,
    });

    toast.success(i18n.t("dialog:toast.pandocExportSuccess"));
    return true;
  } catch (error) {
    exportError("Pandoc export failed:", error);
    // Two-line toast: pandoc's multi-line stderr is the detail.
    // Raw error — errorDetail owns the normalization (commandErrorMessage);
    // errorMessage() here re-created the "[object Object]" class it feeds.
    toast.errorDetail(i18n.t("dialog:toast.pandocExportError"), error);
    return false;
  }
}
