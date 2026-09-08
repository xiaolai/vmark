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
 * Only the FINAL segment (audit #761). The obvious `replace(/\.[^.]+$/, ".pdf")`
 * lets `[^.]` match a separator, so a deck under a dotted directory —
 * `/ws.v1/deck` — matched `.v1/deck` and offered to save into `/ws.pdf`, a
 * different DIRECTORY from the one the user is working in. The same expression
 * left an extensionless deck with no `.pdf` at all.
 */
export function deckExportDefaultPath(deckPath: string): string {
  const separator = Math.max(deckPath.lastIndexOf("/"), deckPath.lastIndexOf("\\"));
  const dot = deckPath.lastIndexOf(".");
  return `${dot > separator + 1 ? deckPath.slice(0, dot) : deckPath}.pdf`;
}

/** Derive the Slidev export format from the chosen output extension (WI-7.2). */
export function slidevFormatFromPath(outputPath: string): SlidevExportFormat {
  const ext = outputPath.slice(outputPath.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "png") return "png";
  if (ext === "pptx") return "pptx";
  return "pdf";
}
