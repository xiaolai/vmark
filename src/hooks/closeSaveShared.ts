/**
 * Save-on-Close Shared Surface (leaf)
 *
 * Purpose: the types, button labels and filename/filter helpers shared by
 * closeSave.ts (the prompts) and closeSaveBatch.ts (the batch persistence).
 * A leaf so neither of those imports the other — the two-file split otherwise
 * forms a cycle.
 *
 * @coordinates-with closeSave.ts — prompts
 * @coordinates-with closeSaveBatch.ts — batch persistence
 * @module hooks/closeSaveShared
 */

/** Context describing a dirty document that may need saving before close. */
export interface CloseSaveContext {
  windowLabel: string;
  tabId: string;
  title: string;
  filePath: string | null;
  content: string;
  /** DIVERGENT rather than dirty: the user kept local content after an
   *  external edit (WI-2) — the prompt says the file changed on disk. */
  divergent?: boolean;
}

/** Result of a single-document save prompt: saved (with path), discarded, or cancelled. */
export type CloseSaveResult =
  | { action: "saved"; path: string }
  | { action: "discarded" }
  | { action: "cancelled" };

/** Result of a multi-document save prompt: all saved, all discarded, or cancelled. */
export type MultiSaveResult =
  | { action: "saved-all" }
  | { action: "discarded-all" }
  | { action: "cancelled" };

/** Options for multi-document save operations. */
export interface MultiSaveOptions {
  /** Called before saving each document, 1-indexed */
  onProgress?: (current: number, total: number, title: string) => void;
}

export const CLOSE_SAVE_BUTTONS = {
  save: "Save",
  dontSave: "Don't Save",
  cancel: "Cancel",
} as const;

export const MULTI_SAVE_BUTTONS = {
  saveAll: "Save All",
  dontSave: "Don't Save",
  cancel: "Cancel",
} as const;

// WI-1B.8 — derive Save dialog filters per-tab from the format
// registry. Untitled tabs default to markdown (the canonical "Save As"
// flow); existing tabs use their format's adapter filters.
import {
  dispatchEditor,
  getFormatById,
} from "@/lib/formats/registry";

const MARKDOWN_FALLBACK_FILTERS = [
  { name: "Markdown", extensions: ["md"] },
];

export function saveFiltersForFilePath(
  filePath: string | null,
): { name: string; extensions: string[] }[] {
  try {
    const cfg = filePath
      ? dispatchEditor(filePath)
      : (getFormatById("markdown") ?? dispatchEditor(null));
    return cfg.adapters.saveDialogFilters.map((f) => ({
      name: f.name,
      extensions: [...f.extensions],
    }));
  } catch {
    /* registry not bootstrapped (test edge) — preserve prior behavior */
    return MARKDOWN_FALLBACK_FILTERS.map((f) => ({
      ...f,
      extensions: [...f.extensions],
    }));
  }
}

function untitledExtensionForFilePath(filePath: string | null): string {
  try {
    const cfg = filePath
      ? dispatchEditor(filePath)
      : (getFormatById("markdown") ?? dispatchEditor(null));
    return cfg.adapters.untitledExtension;
  } catch {
    /* registry not bootstrapped — preserve prior `.md` default */
    return "md";
  }
}


/**
 * Sanitize a title for use as a filename.
 * Removes/replaces characters that are invalid in filenames.
 */
export function toSafeFilename(title: string): string {
  // Replace characters invalid on Windows/macOS/Linux
  // Invalid: / \ : * ? " < > |
  return title
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim() || "Untitled";
}

/**
 * Ensure filename ends with the default extension for `filePath`'s format.
 * Untitled tabs default to markdown (.md). WI-1B.8 + WI-1B.9 — was
 * hardcoded ".md".
 */
export function ensureFormatExtension(
  filename: string,
  filePath: string | null,
): string {
  const ext = untitledExtensionForFilePath(filePath);
  const dotted = `.${ext}`;
  return filename.endsWith(dotted) ? filename : `${filename}${dotted}`;
}
