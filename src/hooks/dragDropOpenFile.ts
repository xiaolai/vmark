import { readTextFile } from "@tauri-apps/plugin-fs";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { maybeMarkLargeMarkdownAsSource } from "@/lib/formats/markdownLargeFile";
import { findExistingTabForPath } from "@/hooks/useReplaceableTab";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { dragDropError } from "@/utils/debug";
import { getFileName } from "@/utils/pathUtils";
import { routeOpenBySize } from "@/services/navigation/largeFileRouting";
import { useFileLoadStore } from "@/stores/documentStore";
import { shouldShowProgressIndicator } from "@/utils/fileSizeThresholds";
import { applyFileOwnershipAfterOpen } from "@/services/workspaces/fileOwnership";

export async function openDroppedFileInNewTab(
  windowLabel: string,
  path: string,
): Promise<void> {
  const existingTabId = findExistingTabForPath(windowLabel, path);
  if (existingTabId) {
    useTabStore.getState().setActiveTab(windowLabel, existingTabId);
    return;
  }

  const route = await routeOpenBySize(path);
  if (!route.proceed) return;

  const showIndicator =
    !route.forceSourceMode && shouldShowProgressIndicator(route.sizeBytes);
  let loadId: number | null = null;
  if (showIndicator) {
    loadId = useFileLoadStore
      .getState()
      .startLoad(getFileName(path) || path, route.sizeBytes);
  }

  try {
    const content = await readTextFile(path);
    const tabId = useTabStore.getState().createTab(windowLabel, path);
    useDocumentStore.getState().initDocument(tabId, content, path);
    applyFileOwnershipAfterOpen(tabId, path);
    useDocumentStore.getState().setLineMetadata(tabId, detectLinebreaks(content));
    useRecentFilesStore.getState().addFile(path);

    maybeMarkLargeMarkdownAsSource(tabId, path, route.forceSourceMode);
  } catch (error) {
    dragDropError("Failed to open file:", path, error);
    const filename = getFileName(path) || path;
    toast.error(i18n.t("dialog:toast.failedToOpen", { filename }));
    if (loadId !== null) useFileLoadStore.getState().endLoad(loadId);
  }
}
