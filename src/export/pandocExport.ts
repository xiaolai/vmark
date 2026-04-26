/**
 * Pandoc Export
 *
 * Purpose: Export markdown to various formats (DOCX, EPUB, LaTeX, ODT, RTF,
 *   plain text) via the Pandoc CLI tool. Pandoc must be installed separately.
 *
 * Pipeline: menu:export-pandoc-{fmt} → detect_pandoc → save dialog → export_via_pandoc
 *
 * @coordinates-with useExportMenuEvents.ts — called from menu:export-pandoc-{fmt} events
 * @coordinates-with pandoc/commands.rs — Rust backend for Pandoc execution
 * @module export/pandocExport
 */

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { imeToast as toast } from "@/utils/imeToast";
import i18n from "@/i18n";
import { joinPath } from "@/utils/pathUtils";
import { exportError } from "@/utils/debug";

/** Pandoc detection result from Rust backend. */
interface PandocInfo {
  available: boolean;
  path: string | null;
  version: string | null;
}

/** Maps format key to display name and file extension. */
export const PANDOC_FORMAT_KEYS = ["docx", "epub", "latex", "odt", "rtf", "txt"] as const;
/** Union type of supported Pandoc export format keys. */
export type PandocFormatKey = (typeof PANDOC_FORMAT_KEYS)[number];

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
 * 2. Shows a save dialog for the chosen format.
 * 3. Invokes the Rust command to pipe markdown through Pandoc.
 */
export async function exportViaPandoc(options: {
  markdown: string;
  format: string;
  defaultName?: string;
  defaultDirectory?: string;
  sourceDirectory?: string;
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

    // Strip filters per macOS Tahoe parity rule (saveDialogWithFallback).
    // The default filename already carries the right extension.
    const selectedPath = await save({
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
    const detail = error instanceof Error ? error.message : String(error);
    // Pin: pandoc errors are typically multi-line stderr output worth reading.
    toast.error(i18n.t("dialog:toast.pandocExportError", { error: detail }), {
      pin: true,
    });
    return false;
  }
}
