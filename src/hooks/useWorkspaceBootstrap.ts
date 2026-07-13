/**
 * Workspace Bootstrap Hook
 *
 * Purpose: Loads workspace config from disk on app startup when rootPath was
 *   restored from localStorage but config is null — fixes the "rootPath
 *   restored but config missing" race condition.
 *
 * Pipeline: App mount → needsBootstrap() check → invoke("read_workspace_config")
 *   → waitForRestoreComplete() → skip already-open tabs → restore lastOpenTabs
 *
 * @coordinates-with workspaceStore.ts — checks/updates workspace state
 * @coordinates-with workspaceBootstrap.ts — pure needsBootstrap() helper
 * @coordinates-with hotExitCoordination.ts — waits for hot exit restore before creating tabs
 * @coordinates-with useReplaceableTab.ts — findExistingTabForPath to skip duplicates
 * @module hooks/useWorkspaceBootstrap
 */
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { needsBootstrap } from "@/services/persistence/workspaceBootstrap";
import { documentPathsForRestore } from "@/services/persistence/sessionTabs";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { waitForRestoreComplete, RESTORE_WAIT_TIMEOUT_MS } from "@/services/persistence/hotExit/hotExitCoordination";
import { findExistingTabForPath } from "@/hooks/useReplaceableTab";
import { workspaceWarn, workspaceError } from "@/utils/debug";

/**
 * Hook that bootstraps workspace config on startup.
 * Should be called once at app initialization.
 */
export function useWorkspaceBootstrap() {
  const hasBootstrapped = useRef(false);

  useEffect(() => {
    // Only run once
    if (hasBootstrapped.current) return;

    const bootstrap = async () => {
      const state = useWorkspaceStore.getState();

      if (!needsBootstrap(state)) {
        return;
      }

      hasBootstrapped.current = true;
      const { rootPath } = state;

      // Load config from disk. Only THIS step falls back to defaults — a failure
      // in a later step must not overwrite an already-loaded valid config (that
      // would silently drop exclusions/visibility and blame the config read).
      let config: WorkspaceConfig | null = null;
      try {
        config = await invoke<WorkspaceConfig | null>("read_workspace_config", {
          rootPath,
        });
      } catch (error) {
        workspaceWarn("Failed to load workspace config:", error);
      }
      useWorkspaceStore.getState().bootstrapConfig(config);

      // Restore document tabs from the session config (new `sessionTabs`
      // field when present, else legacy `lastOpenTabs`). Browser-tab restore
      // lands with the browser surface (WI-1.3+).
      const restorePaths = config ? documentPathsForRestore(config) : [];
      if (restorePaths.length === 0) return;

      // Wait for hot exit restore to complete before creating tabs.
      // This prevents race conditions where both systems create tabs concurrently.
      // On timeout, the findExistingTabForPath guard below still prevents duplicates.
      const restored = await waitForRestoreComplete(RESTORE_WAIT_TIMEOUT_MS);
      if (!restored) {
        workspaceWarn("Hot exit restore timed out, proceeding with dedup guard");
      }

      const windowLabel = getCurrentWebviewWindow().label;

      for (const filePath of restorePaths) {
        // Skip files already restored by hot exit
        if (findExistingTabForPath(windowLabel, filePath)) {
          continue;
        }

        let content: string;
        try {
          content = await readTextFile(filePath);
        } catch {
          // File may have been moved/deleted - skip it
          workspaceWarn(`Could not restore tab: ${filePath}`);
          continue;
        }

        const tabId = useTabStore.getState().createTab(windowLabel, filePath);
        try {
          // WI-2.6 — registry handles YAML routing; bandaid retired.
          useDocumentStore.getState().initDocument(tabId, content, filePath);
          useDocumentStore.getState().setLineMetadata(tabId, detectLinebreaks(content));
        } catch (error) {
          // The file read fine — this is a real failure after the tab exists.
          // Roll the tab back rather than leaving an orphan with no document,
          // and surface the actual error instead of hiding it as "file moved".
          useTabStore.getState().closeTab(windowLabel, tabId);
          workspaceError(`Failed to initialize restored tab: ${filePath}`, error);
        }
      }
    };

    bootstrap().catch((error) => {
      workspaceError("Workspace bootstrap failed:", error);
    });
  }, []);
}
