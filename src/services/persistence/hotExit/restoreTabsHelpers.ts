/**
 * Tab-restore helpers for hot-exit session restore.
 *
 * Split out of `restoreHelpers.ts` so `restoreTabs` reads as a short pipeline:
 * filter → clear → dedupe → per-tab metadata → active-tab selection. Each step
 * is a focused, independently testable function here. Document-content restore
 * stays in `restoreHelpers.ts` (these helpers do not depend on it).
 *
 * @module services/persistence/hotExit/restoreTabsHelpers
 */
import { hotExitWarn } from '@/utils/debug';
import { useTabStore } from '@/stores/tabStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useUnifiedHistoryStore } from '@/stores/documentStore';
import { getFormatById } from '@/lib/formats/registry';
import { normalizePath } from '@/utils/paths';
import type { TabState, WindowState } from './types';

/** Result of deduplicating persisted tabs before restore. */
export interface DeduplicatedTabs {
  /** Tabs to actually create, in order. */
  kept: TabState[];
  /**
   * For each skipped duplicate's original session id, the original id of the
   * retained tab it collapsed into. Lets the active-tab mapping still resolve
   * to the retained tab when the persisted active tab was a skipped duplicate.
   */
  duplicateToRetained: Map<string, string>;
}

/**
 * An empty-untitled tab carries no information: no file path, no saved
 * content, and no unsaved content. Restoring such tabs only adds orphan
 * blank tabs the user has to close manually — there is nothing to recover.
 */
export function isEmptyUntitledTab(tab: TabState): boolean {
  return tab.file_path === null
    && tab.document.content === ""
    && tab.document.saved_content === "";
}

/**
 * Remove tabs that carry nothing to recover (empty + untitled). An empty
 * result signals the caller to preserve whatever WindowContext init produced
 * instead of clearing and rebuilding.
 */
export function filterMeaningfulTabs(tabs: TabState[]): TabState[] {
  return tabs.filter((t) => !isEmptyUntitledTab(t));
}

/**
 * Clear the window's existing tabs and their documents/history before a
 * restore overwrites them.
 */
export function clearExistingWindowTabs(windowLabel: string): void {
  const tabStore = useTabStore.getState();
  const documentStore = useDocumentStore.getState();
  const historyStore = useUnifiedHistoryStore.getState();
  const existingTabs = tabStore.getTabsByWindow(windowLabel);
  existingTabs.forEach((tab) => {
    documentStore.removeDocument(tab.id);
    // Also clear unified history to prevent memory leaks
    historyStore.clearDocument(tab.id);
  });
  // Remove window from tab store to clear all tabs at once (bypasses pin rules)
  if (existingTabs.length > 0) {
    tabStore.removeWindow(windowLabel);
  }
}

/**
 * Deduplicate tabs by file path before restoring.
 *
 * tabStore.createTab deduplicates by `normalizePath(filePath)`, so a second
 * createTab with an equivalent path returns the first tab's id — causing
 * restoreDocumentState to overwrite the first tab's content. We must skip
 * later duplicates using the SAME normalizePath comparison so equivalent
 * paths (trailing slash, separator/drive-letter casing) don't slip past an
 * exact-string comparison and silently collide.
 *
 * normalizePath does NOT case-fold the path body (only the Windows drive
 * letter), so distinct files on case-sensitive volumes stay distinct —
 * preserving the data-availability fix that removed earlier lowercasing.
 *
 * Skipped duplicates are tracked back to the retained tab's original id so
 * the active-tab restore can still resolve to the surviving tab.
 */
export function deduplicateTabsByPath(tabs: TabState[]): DeduplicatedTabs {
  const seenFilePaths = new Map<string, string>(); // normalizedPath -> retained original id
  const kept: TabState[] = [];
  const duplicateToRetained = new Map<string, string>();

  for (const tabState of tabs) {
    if (!tabState.file_path) {
      kept.push(tabState); // untitled tabs are never duplicates
      continue;
    }
    const normalized = normalizePath(tabState.file_path);
    const retainedId = seenFilePaths.get(normalized);
    if (retainedId !== undefined) {
      hotExitWarn(
        `Skipping duplicate tab '${tabState.id}' with file_path '${tabState.file_path}' during restore`
      );
      duplicateToRetained.set(tabState.id, retainedId);
      continue;
    }
    seenFilePaths.set(normalized, tabState.id);
    kept.push(tabState);
  }

  return { kept, duplicateToRetained };
}

/**
 * Restore one tab's metadata (title, pin, multi-format fields) onto a freshly
 * created tab id. Document content is restored separately.
 */
export function restoreTabMetadata(
  windowLabel: string,
  newTabId: string,
  tabState: TabState,
): void {
  const tabStore = useTabStore.getState();

  // Update tab metadata (title is required string, always set it)
  tabStore.updateTabTitle(newTabId, tabState.title);
  if (tabState.is_pinned) {
    tabStore.togglePin(windowLabel, newTabId);
  }

  // WI-1A.13 — restore multi-format fields.
  //
  // For tabs WITH a file_path, `formatId` derives deterministically from
  // the extension via dispatchEditor — restoration is automatic.
  //
  // For UNTITLED tabs (file_path === null), derivation always falls back
  // to markdown. If the persisted format_id is not "markdown", explicitly
  // restore it. This guards untitled non-markdown sessions (e.g. an
  // unsaved JSON scratch tab) against silent format loss across restart.
  //
  // Validate against the format registry — a tampered or stale session
  // file could carry a format_id that no longer (or never) exists. Falling
  // through with an unknown id would inject inconsistent state into the
  // tab store.
  if (
    tabState.file_path == null &&
    tabState.format_id &&
    tabState.format_id !== "markdown"
  ) {
    if (getFormatById(tabState.format_id)) {
      tabStore.setTabFormatId(newTabId, tabState.format_id);
    } else {
      hotExitWarn(
        `Skipping unknown format_id '${tabState.format_id}' for restored tab '${tabState.id}'`
      );
    }
  }
  if (tabState.editing_enabled === false) {
    tabStore.setTabEditingEnabled(newTabId, false);
  }
  // Best-effort validation of the persisted schema id. We look up the
  // effective format (the validated format_id, or markdown for untitled
  // markdown tabs) and confirm the schema id matches one of its
  // registered renderers. If the registry can't resolve the format
  // (e.g. test environment without bootstrap, or the format was
  // unregistered after this session was saved), we cannot validate —
  // fall through and trust the persisted value rather than silently
  // drop it.
  if (tabState.active_schema_id != null) {
    const effectiveFormatId = tabState.format_id || "markdown";
    const format = getFormatById(effectiveFormatId);
    const renderers = format?.schemaRenderers;
    if (renderers && !(tabState.active_schema_id in renderers)) {
      hotExitWarn(
        `Skipping unknown active_schema_id '${tabState.active_schema_id}' for restored tab '${tabState.id}' (format '${effectiveFormatId}')`
      );
    } else {
      tabStore.setTabActiveSchemaId(newTabId, tabState.active_schema_id);
    }
  }
}

/**
 * Activate the persisted active tab using the session→new id mapping. If the
 * persisted active tab was a skipped duplicate, resolve it to the retained
 * tab. Falls back to the first restored tab when no mapping resolves.
 */
export function restoreActiveTab(
  windowLabel: string,
  windowState: WindowState,
  tabIdMap: Map<string, string>,
  duplicateToRetained: Map<string, string>,
): void {
  if (!windowState.active_tab_id) return;
  const tabStore = useTabStore.getState();

  // The persisted active id may itself have been a skipped duplicate; resolve
  // to the retained tab's original id before mapping.
  const retainedOriginalId =
    duplicateToRetained.get(windowState.active_tab_id) ?? windowState.active_tab_id;
  const mappedActiveId = tabIdMap.get(retainedOriginalId);
  if (mappedActiveId) {
    tabStore.setActiveTab(windowLabel, mappedActiveId);
    return;
  }
  // Fallback to first tab if mapping not found
  const tabs = tabStore.getTabsByWindow(windowLabel);
  if (tabs.length > 0) {
    tabStore.setActiveTab(windowLabel, tabs[0].id);
  }
}
