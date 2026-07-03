// Path-only open for binary media (image/audio/video) tabs.
//
// Split out of useFileOpen.ts: media never goes through the text-read
// pipeline. No readTextFile, no size gate, no linebreak detection — the bytes
// never enter the JS heap. The document is initialized with EMPTY content so
// hot-exit never serializes binary; the media surface (MediaView) resolves the
// tab's filePath to an asset:// URL, granting asset access itself before it
// streams the file. Synchronous — no close-during-read race.
//
// See dev-docs/plans/20260703-media-viewer.md.

import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { applyFileOwnershipAfterOpen } from "@/services/workspaces/fileOwnership";
import { getMediaType } from "@/utils/mediaPathDetection";
import { fileExtension } from "@/utils/mediaExtensions";

type OpenMediaOptions = {
  onTabCreated?: (tabId: string, isExistingTab: boolean) => void;
};

/**
 * True when `path` is a binary media file (image/audio/video) that must NEVER
 * be read as UTF-8 text. Detection is extension-based and UNCONDITIONAL: a
 * user format association (e.g. `.png → txt`) can change the tab's editor, but
 * it can never make a binary file safe to read as text. getMediaType is a pure,
 * registry-independent classifier that never throws. `.svg` is excluded because
 * it is a registered text/split-pane format, not binary media — mirroring the
 * media adapter's own svg carve-out (see adapters/media.ts).
 */
export function isBinaryMediaPath(path: string): boolean {
  return getMediaType(path) !== null && fileExtension(path) !== "svg";
}

/**
 * If `path` is a media file, open it as a path-only viewer tab and return true;
 * otherwise return false so the caller falls through to the text-read pipeline.
 */
export function tryOpenMediaFile(
  windowLabel: string,
  path: string,
  options?: OpenMediaOptions,
): boolean {
  if (!isBinaryMediaPath(path)) return false;
  openMediaFileInNewTab(windowLabel, path, options);
  return true;
}

/**
 * Replace an EXISTING clean tab's content with a media file (path-only).
 * Mirrors openMediaFileInNewTab but reuses the caller's tabId instead of
 * creating a new tab — the Cmd+O / Open-Recent replace path routes media here
 * so a binary file selected into a clean tab never hits readTextFile.
 * updateTabPath re-derives the tab's formatId (→ media); loadContent writes
 * EMPTY content so no binary bytes enter the document store. Synchronous — no
 * close-during-read race.
 */
export function replaceTabWithMediaFile(tabId: string, path: string): void {
  useTabStore.getState().updateTabPath(tabId, path);
  useDocumentStore.getState().loadContent(tabId, "", path);
  applyFileOwnershipAfterOpen(tabId, path);
  useRecentFilesStore.getState().addFile(path);
}

export function openMediaFileInNewTab(
  windowLabel: string,
  path: string,
  options?: OpenMediaOptions,
): void {
  const tabCountBefore = useTabStore.getState().getTabsByWindow(windowLabel).length;
  const tabId = useTabStore.getState().createTab(windowLabel, path);
  const isExistingTab =
    useTabStore.getState().getTabsByWindow(windowLabel).length === tabCountBefore;

  options?.onTabCreated?.(tabId, isExistingTab);

  // createTab deduped to an existing tab — just activate, don't re-init.
  if (isExistingTab) return;

  useDocumentStore.getState().initDocument(tabId, "", path);
  applyFileOwnershipAfterOpen(tabId, path);
  useRecentFilesStore.getState().addFile(path);
}
