/**
 * Workspace Bootstrap Hook
 *
 * Loads workspace config from disk on app startup when rootPath was restored
 * from localStorage but config is not yet loaded.
 *
 * This solves the "rootPath restored but config null" bug.
 */
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { needsBootstrap } from "@/utils/workspaceBootstrap";

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

      try {
        // Load config from disk
        const config = await invoke<WorkspaceConfig | null>(
          "read_workspace_config",
          { rootPath }
        );

        useWorkspaceStore.getState().bootstrapConfig(config);

        // Restore tabs from lastOpenTabs if available
        if (config?.lastOpenTabs && config.lastOpenTabs.length > 0) {
          const windowLabel = getCurrentWebviewWindow().label;

          for (const filePath of config.lastOpenTabs) {
            try {
              const content = await readTextFile(filePath);
              const tabId = useTabStore.getState().createTab(windowLabel, filePath);
              useDocumentStore.getState().initDocument(tabId, content, filePath);
            } catch {
              // File may have been moved/deleted - skip it
              if (import.meta.env.DEV) {
                console.warn(`[WorkspaceBootstrap] Could not restore tab: ${filePath}`);
              }
            }
          }
        }
      } catch (error) {
        // If we can't read the config, use defaults
        if (import.meta.env.DEV) {
          console.warn("[WorkspaceBootstrap] Failed to load workspace config:", error);
        }
        useWorkspaceStore.getState().bootstrapConfig(null);
      }
    };

    bootstrap();
  }, []);
}
