/**
 * F6 / Shift+F6 view-mode toggles for split-pane / viewer tabs.
 *
 * Purpose: the format-aware branch of the shared `sourceMode` (F6) /
 * `markdownSplit` (Shift+F6) shortcuts. On a split-pane / viewer tab that has a
 * preview, F6 toggles Source⇄Split and Shift+F6 toggles Preview⇄Split
 * (toggle-against-base, base = Split); markdown/media/preview-less tabs fall
 * through to the existing markdown handlers. See ADR-8 in
 * dev-docs/plans/20260703-split-pane-view-modes.md.
 *
 * @coordinates-with useViewShortcuts.ts — sole caller (executors)
 * @module hooks/splitPaneViewShortcut
 */

import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useDocumentStore } from "@/stores/documentStore";
import { usePopupStore } from "@/stores/popupStore";
import { getFormatById } from "@/lib/formats/registry";
import { getActiveTabId } from "@/services/navigation/activeDocument";
import type { FormatConfig, SplitViewMode } from "@/lib/formats/types";

/**
 * Whether `config` would render a preview for `tabId`'s current content —
 * mirrors SplitPaneEditor's own resolution (schema renderer if the detector
 * selects one, else the generic preview) so the shortcut and the surface never
 * disagree. Detector errors fall through to the generic-preview check.
 */
function resolvesToPreview(config: FormatConfig, tabId: string): boolean {
  if (config.genericPreview) return true;
  if (!config.schemaDetector || !config.schemaRenderers) return false;
  const doc = useDocumentStore.getState().documents?.[tabId];
  try {
    const schemaId = config.schemaDetector(doc?.filePath ?? "", doc?.content ?? "");
    return Boolean(schemaId && config.schemaRenderers[schemaId]);
  } catch {
    return false;
  }
}

/**
 * Toggle-against-base (base = Split): F6 flips Source⇄Split, Shift+F6 flips
 * Preview⇄Split. Pressing a key from the *other* non-base mode switches
 * directly to the pressed mode (e.g. F6 from Preview → Source).
 */
export function toggleSplitViewMode(
  current: SplitViewMode,
  against: "source" | "preview",
): SplitViewMode {
  if (against === "source") return current === "source" ? "split" : "source";
  return current === "preview" ? "split" : "preview";
}

/**
 * The focused split-pane / viewer tab that declares a preview, plus its
 * effective view mode (per-tab override → global default → "split"). Returns
 * null when the focused tab is markdown/media or has no preview — the caller
 * then runs the markdown path.
 */
export function activeSplitPaneTarget(
  windowLabel: string,
): { tabId: string; mode: SplitViewMode } | null {
  const tabId = getActiveTabId(windowLabel);
  if (!tabId) return null;
  const tab = useTabStore.getState().findTabById(tabId);
  if (!tab) return null;
  const config = getFormatById(tab.formatId);
  if (!config) return null;
  if (config.kind !== "split-pane" && config.kind !== "viewer") return null;
  // Only capture the key when the tab actually shows a preview for its current
  // content — otherwise fall through so the event isn't silently swallowed.
  if (!resolvesToPreview(config, tabId)) return null;
  const fallback =
    useSettingsStore.getState().formats.defaultViewMode ?? "split";
  return { tabId, mode: tab.viewMode ?? fallback };
}

/**
 * Apply the F6/Shift+F6 toggle to the focused split-pane tab, if applicable.
 * Returns true when handled (caller skips the markdown path), false otherwise.
 */
export function applySplitPaneViewShortcut(
  windowLabel: string,
  against: "source" | "preview",
): boolean {
  const target = activeSplitPaneTarget(windowLabel);
  if (!target) return false;
  // The editor context menu's snapshot targets the pane that is about to
  // change view mode — close it so a stale menu can't dispatch later
  // (keyboard path only; pointer toggles already close it via
  // click-outside dismissal).
  if (usePopupStore.getState().editorContextMenu.isOpen) {
    usePopupStore.getState().editorContextCloseMenu();
  }
  useTabStore
    .getState()
    .setTabViewMode(target.tabId, toggleSplitViewMode(target.mode, against));
  return true;
}
