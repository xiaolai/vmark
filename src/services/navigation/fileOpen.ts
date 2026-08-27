import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { fileOpsError } from "@/utils/debug";
import { perfReset, perfStart, perfEnd, perfMark } from "@/utils/perfLog";
import { useDocumentStore, useFileLoadStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { withReentryGuard } from "@/utils/reentryGuard";
import { resolveOpenAction } from "@/utils/openPolicy";
import { getReplaceableTab, findExistingTabForPath, isWindowEmpty } from "@/services/tabs/replaceableTab";
import { createUntitledTab } from "@/services/navigation/newFile";
import { getFileName } from "@/utils/pathUtils";
import { routeOpenBySize } from "@/services/navigation/largeFileRouting";
import { maybeMarkLargeMarkdownAsSource } from "@/lib/formats/markdownLargeFile";
import { getSupportedExtensions } from "@/lib/formats/registry";
import { markdownExtensions } from "@/lib/formats/saveFilters";
import { executeOpenDecision } from "./executeOpenDecision";
import { applyFileOwnershipAfterOpen } from "@/services/workspaces/fileOwnership";
import { activateTabWithWorkspaceContext } from "@/services/workspaces/activateTabWithWorkspaceContext";
import { tryOpenMediaFile } from "./openMediaFile";
import { shouldShowProgressIndicator } from "@/utils/fileSizeThresholds";
import { errorMessage } from "@/utils/errorMessage";
// Shared replace flow (also used by "Open Recent File"); re-exported so existing
// `from "@/services/navigation/fileOpen"` import sites stay stable.
export { replaceTabWithFile, type ReplaceTabResult } from "./replaceTabWithFile";

/**
 * Open a file in a new tab (core logic).
 * Creates the tab, reads the file, and initializes the document.
 * On failure, cleans up the orphaned tab and shows a toast error.
 * @internal Exported for testing
 */
/**
 * What an open actually did — five outcomes that a tab COUNT cannot tell apart.
 *
 * `startupFileOpen` used to infer failure from "the window has zero tabs
 * afterwards", which reads `closed` (the user shut the tab or window while the
 * read was in flight) as `failed` and resurrects a tab against their action,
 * defeating the close-during-read guard below. Only the operation knows which
 * of these happened, so it says so.
 */
export type OpenOutcome = "opened" | "deduped" | "refused" | "closed" | "failed";

export async function openFileInNewTabCore(
  windowLabel: string,
  path: string,
  options?: {
    /**
     * Invoked synchronously with the resolved tab id as soon as the tab is
     * created/reused, BEFORE content is read and the editor mounts — lets
     * callers register pre-mount state (e.g. Find-in-Files pending scroll)
     * without racing the editor consuming empty pending state.
     */
    onTabCreated?: (tabId: string, isExistingTab: boolean) => void;
  }
): Promise<OpenOutcome> {
  // Binary media: path-only open, never read as UTF-8. See openMediaFile.ts.
  if (tryOpenMediaFile(windowLabel, path, options)) return "opened";

  // Pre-read size gate: refuse/confirm huge files; no-op for small ones.
  const route = await routeOpenBySize(path);
  if (!route.proceed) {
    perfMark("openFileInNewTab:refusedOrCancelled");
    return "refused";
  }

  perfStart("createTab");
  // Detect dedup by comparing tab count before/after createTab (createTab is
  // synchronous and doesn't report created-vs-reused).
  const tabCountBefore = useTabStore.getState().getTabsByWindow(windowLabel).length;
  const tabId = useTabStore.getState().createTab(windowLabel, path);
  const isExistingTab = useTabStore.getState().getTabsByWindow(windowLabel).length === tabCountBefore;
  perfEnd("createTab");

  // Hand the resolved tab id to the caller before the read/mount so it can
  // register pre-mount state deterministically.
  options?.onTabCreated?.(tabId, isExistingTab);

  // createTab deduped to an existing tab — just activate, don't overwrite content
  if (isExistingTab) {
    perfMark("openFileInNewTab:deduped");
    return "deduped";
  }

  // Show the indeterminate "Opening large file…" indicator when the file is
  // past the progress threshold AND the open is going to WYSIWYG (Source mode
  // opens are sub-second — the indicator would flash and confuse).
  const showIndicator =
    !route.forceSourceMode && shouldShowProgressIndicator(route.sizeBytes);
  let loadId: number | null = null;
  if (showIndicator) {
    const filename = getFileName(path) || path;
    loadId = useFileLoadStore.getState().startLoad(filename, route.sizeBytes);
  }

  try {
    perfStart("readTextFile");
    const content = await readTextFile(path);
    perfEnd("readTextFile", { size: content.length });

    // Close-during-open guard (WI-0.2, C1): the tab can be closed while this
    // read is in flight. Writing the document now would resurrect an orphan
    // entry for a tab that no longer exists. Re-check existence post-await —
    // mirrors the `updateDoc` missing-key guard the sibling mutators use.
    if (!useTabStore.getState().findTabById(tabId)) {
      perfMark("openFileInNewTab:tabClosedDuringRead");
      if (loadId !== null) useFileLoadStore.getState().endLoad(loadId);
      return "closed";
    }

    // WI-2.6 — YAML force-source bandaid retired. YAML files now route
    // through the YAML adapter (kind: split-pane) via the format
    // registry, so they bypass the markdown WYSIWYG path entirely.

    perfStart("initDocument");
    // The disk-open ingest canonicalises, derives line metadata and records
    // the BOM in ONE door — the separate detect/set pair is gone with it.
    useDocumentStore.getState().ingestExternalContent(tabId, content, "disk-open", {
      filePath: path,
    });
    applyFileOwnershipAfterOpen(tabId, path);
    perfEnd("initDocument");

    useRecentFilesStore.getState().addFile(path);

    // Large / huge file: mark the tab as forced-source via the markdown
    // adapter helper (WI-1A.6). For non-markdown formats this is a no-op
    // since they don't have a WYSIWYG path.
    maybeMarkLargeMarkdownAsSource(tabId, path, route.forceSourceMode);

    perfMark("openFileInNewTab:complete");
    // On success, the indicator stays on until TiptapEditor's onCreate fires
    // endLoad() — that is the moment the editor is actually interactive.
    return "opened";
  } catch (error) {
    fileOpsError("Failed to open file:", path, error);
    // Clean up the orphaned tab — without initDocument, it renders blank.
    // Use detachTab (not closeTab) to avoid polluting the "reopen closed tab" history.
    useTabStore.getState().detachTab(windowLabel, tabId);
    const msg = errorMessage(error);
    // Pin: system errors include paths/codes worth reading carefully.
    toast.error(i18n.t("dialog:toast.failedToOpenFile", { error: msg }), {
      pin: true,
    });
    // Clear the indicator immediately on error so no stale spinner lingers.
    if (loadId !== null) useFileLoadStore.getState().endLoad(loadId);
    return "failed";
  }
}

/**
 * Open a file in a new tab. Always creates a new tab unless an existing
 * tab for the same file already exists (in which case it activates that tab).
 */
export async function openFileInNewTab(
  windowLabel: string,
  path: string
): Promise<void> {
  perfReset();
  perfMark("openFileInNewTab:start", { path });

  // Check for existing tab first
  const existingTabId = findExistingTabForPath(windowLabel, path);
  if (existingTabId) {
    // WI-12.2: ownership-aware — the visible workspace follows the owner.
    activateTabWithWorkspaceContext(windowLabel, existingTabId);
    perfMark("openFileInNewTab:activatedExisting");
    return;
  }

  await openFileInNewTabCore(windowLabel, path);
}

/**
 * Handle Open dialog (Cmd+O) — show file picker, resolve action, open file.
 */
export async function handleOpen(windowLabel: string): Promise<void> {
  await withReentryGuard(windowLabel, "open", async () => {
    perfReset();
    perfMark("handleOpen:start");

    perfStart("openDialog");
    // WI-1B.1 — "All Supported" preset (every registered format) plus
    // a Markdown-only preset for the user who wants the legacy filter.
    // Filter names are localized via dialog:openFilter.* — only the
    // extension lists stay registry-driven.
    const allExtensions = getSupportedExtensions();
    const path = await open({
      filters: [
        {
          name: i18n.t("dialog:openFilter.allSupported"),
          extensions: [...allExtensions],
        },
        {
          name: i18n.t("dialog:openFilter.markdown"),
          // From the registry, not retyped — this copy could drift from the
          // markdown adapter's own extension list without anything noticing.
          extensions: markdownExtensions(),
        },
      ],
    });
    perfEnd("openDialog");

    if (!path) return;
    perfMark("handleOpen:fileSelected", { path });

    // Use policy to decide where to open
    const { isWorkspaceMode, rootPath } = useWorkspaceStore.getState();
    const existingTabId = findExistingTabForPath(windowLabel, path);

    // Check for replaceable tab (single clean untitled tab)
    const replaceableTab = getReplaceableTab(windowLabel);
    // fix(#1331) — zero tabs is the Welcome screen, and it has no replaceable
    // tab. Without this the file opened in a NEW window and left the window the
    // user pressed Open File in still empty.
    const windowIsEmpty = isWindowEmpty(windowLabel);

    // fix(#946) — honor the "open files in a new tab" preference
    const openInNewTab = useSettingsStore.getState().general.openInNewTab;
    const workspaceRailMode = useSettingsStore.getState().general.workspaceRailMode;

    const decision = resolveOpenAction({
      filePath: path,
      workspaceRoot: rootPath,
      isWorkspaceMode,
      existingTabId,
      replaceableTab,
      openInNewTab,
      workspaceRailMode,
      windowIsEmpty,
    });

    perfMark("handleOpen:resolvedAction", { action: decision.action });

    await executeOpenDecision(windowLabel, path, decision, openFileInNewTab);
  });
}

/**
 * Handle opening file from FileExplorer — always opens in new tab.
 */
export async function handleOpenFile(
  windowLabel: string,
  path: string
): Promise<void> {
  // Identical semantics to openFileInNewTab (existing → ownership-aware
  // activate, else create) — delegate rather than duplicate (WI-12.2).
  await openFileInNewTab(windowLabel, path);
}

/**
 * Handle New (Cmd+N) — create a new untitled tab.
 */
export function handleNew(windowLabel: string): void {
  createUntitledTab(windowLabel);
}
