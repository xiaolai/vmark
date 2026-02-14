/**
 * Recent Files Menu Events Hook
 *
 * Purpose: Handles native menu events for the "Open Recent" submenu —
 *   opens a recently used file in a new tab or new window.
 *
 * Key decisions:
 *   - Uses resolveOpenAction to decide tab vs window
 *   - Prompts user if file no longer exists on disk
 *   - Clears recent files list on "clear-recent" event
 *
 * @coordinates-with recentFilesStore.ts — reads/clears recent files list
 * @coordinates-with openPolicy.ts — resolveOpenAction for routing decision
 * @module hooks/useRecentFilesMenuEvents
 */

import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useDocumentStore } from "@/stores/documentStore";
import { useRecentFilesStore } from "@/stores/recentFilesStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { withReentryGuard } from "@/utils/reentryGuard";
import { resolveOpenAction } from "@/utils/openPolicy";
import { getReplaceableTab } from "@/hooks/useReplaceableTab";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { safeUnlistenAll } from "@/utils/safeUnlisten";

export function useRecentFilesMenuEvents(): void {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async (): Promise<void> => {
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);

      if (cancelled) return;

      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      // Clear Recent Files
      const unlistenClearRecent = await currentWindow.listen<string>("menu:clear-recent", async (event) => {
        if (event.payload !== windowLabel) return;

        const { files } = useRecentFilesStore.getState();
        if (files.length === 0) return;

        await withReentryGuard(windowLabel, "clear-recent", async () => {
          const confirmed = await ask(
            "Clear the list of recently opened files?",
            {
              title: "Clear Recent Files",
              kind: "warning",
            }
          );
          if (confirmed) {
            useRecentFilesStore.getState().clearAll();
          }
        });
      });
      if (cancelled) { unlistenClearRecent(); return; }
      unlistenRefs.current.push(unlistenClearRecent);

      // Open Recent File - uses workspace boundary policy
      // Payload is now (path, windowLabel) - path from Rust snapshot prevents race conditions
      const unlistenOpenRecent = await currentWindow.listen<[string, string]>("menu:open-recent-file", async (event) => {
        const [filePath, targetLabel] = event.payload;
        if (targetLabel !== windowLabel) return;

        // Find file in store by path (or create minimal file object)
        const { files } = useRecentFilesStore.getState();
        const file = files.find(f => f.path === filePath) ?? { path: filePath };
        const { isWorkspaceMode, rootPath } = useWorkspaceStore.getState();
        const existingTab = useTabStore.getState().findTabByPath(windowLabel, file.path);
        const replaceableTab = getReplaceableTab(windowLabel);

        const result = resolveOpenAction({
          filePath: file.path,
          workspaceRoot: rootPath,
          isWorkspaceMode,
          existingTabId: existingTab?.id ?? null,
          replaceableTab,
        });

        await withReentryGuard(windowLabel, "open-recent", async () => {
          switch (result.action) {
            case "activate_tab":
              useTabStore.getState().setActiveTab(windowLabel, result.tabId);
              break;

            case "create_tab":
              try {
                const content = await readTextFile(file.path);
                const tabId = useTabStore.getState().createTab(windowLabel, file.path);
                useDocumentStore.getState().initDocument(tabId, content, file.path);
                useDocumentStore.getState().setLineMetadata(tabId, detectLinebreaks(content));
                useRecentFilesStore.getState().addFile(file.path);
              } catch (error) {
                console.error("[Menu] Failed to open recent file:", error);
                const remove = await ask(
                  "This file could not be opened. It may have been moved or deleted.\n\nRemove from recent files?",
                  { title: "File Not Found", kind: "warning" }
                );
                if (remove) {
                  useRecentFilesStore.getState().removeFile(file.path);
                }
              }
              break;

            case "replace_tab":
              try {
                const content = await readTextFile(file.path);
                useTabStore.getState().updateTabPath(result.tabId, result.filePath);
                useDocumentStore.getState().loadContent(
                  result.tabId,
                  content,
                  result.filePath,
                  detectLinebreaks(content)
                );
                await openWorkspaceWithConfig(result.workspaceRoot);
                useRecentFilesStore.getState().addFile(file.path);
              } catch (error) {
                console.error("[Menu] Failed to replace tab with recent file:", error);
                const remove = await ask(
                  "This file could not be opened. It may have been moved or deleted.\n\nRemove from recent files?",
                  { title: "File Not Found", kind: "warning" }
                );
                if (remove) {
                  useRecentFilesStore.getState().removeFile(file.path);
                }
              }
              break;

            case "open_workspace_in_new_window":
              try {
                await invoke("open_workspace_in_new_window", {
                  workspaceRoot: result.workspaceRoot,
                  filePath: result.filePath,
                });
              } catch (error) {
                console.error("[Menu] Failed to open workspace in new window:", error);
                const filename = file.path.split("/").pop() ?? file.path;
                toast.error(`Failed to open ${filename}`);
              }
              break;

            case "no_op":
              break;
          }
        });
      });
      if (cancelled) { unlistenOpenRecent(); return; }
      unlistenRefs.current.push(unlistenOpenRecent);
    };

    setupListeners();

    return () => {
      cancelled = true;
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);
    };
  }, []);
}
