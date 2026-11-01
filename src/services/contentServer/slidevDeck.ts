/**
 * Slidev deck helpers for the content-server hook: which deck is active, and
 * which export format an output path implies. Neither is a React adapter
 * (ADR-013), so they live here rather than in `hooks/useContentServer`.
 *
 * @coordinates-with hooks/useContentServer.ts — previewSlides / exportSlides
 * @module services/contentServer/slidevDeck
 */

import { useTabStore, tabFilePath } from "@/stores/tabStore";
import { getActiveTabId } from "@/services/navigation/activeDocument";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { getFileName } from "@/utils/pathUtils";
import type { SlidevExportFormat } from "./client";

/** Absolute path of the active tab's file, or null (untitled / no tab). */
export function activeDeckPath(): string | null {
  const tabId = getActiveTabId(getCurrentWindowLabel());
  if (!tabId) return null;
  const tab = useTabStore.getState().findTabById(tabId);
  return tab ? tabFilePath(tab) : null;
}

/**
 * The save dialog's default output path for `deckPath`: its final segment with
 * the extension replaced by `.pdf`, or `.pdf` appended when it has none.
 *
 * Only the FINAL segment. The obvious `replace(/\.[^.]+$/, ".pdf")`
 * lets `[^.]` match a separator, so a deck under a dotted directory —
 * `/ws.v1/deck` — matched `.v1/deck` and offered to save into `/ws.pdf`, a
 * different DIRECTORY from the one the user is working in. The same expression
 * left an extensionless deck with no `.pdf` at all.
 */
export function deckExportDefaultPath(deckPath: string): string {
  const name = getFileName(deckPath);
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? deckPath.slice(0, deckPath.length - name.length + dot) : deckPath}.pdf`;
}

/** Derive the Slidev export format from the chosen output extension. */
export function slidevFormatFromPath(outputPath: string): SlidevExportFormat {
  const ext = outputPath.slice(outputPath.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "png") return "png";
  if (ext === "pptx") return "pptx";
  return "pdf";
}
