import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "../stores/documentStore";
import { useTabStore } from "../stores/tabStore";
import { useRecentFilesStore } from "../stores/recentFilesStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import {
  setCurrentWindowLabel,
  migrateWorkspaceStorage,
} from "../utils/workspaceStorage";

interface WindowContextValue {
  windowLabel: string;
  isDocumentWindow: boolean;
}

const WindowContext = createContext<WindowContextValue | null>(null);

interface WindowProviderProps {
  children: ReactNode;
}

export function WindowProvider({ children }: WindowProviderProps) {
  const [windowLabel, setWindowLabel] = useState<string>("main");
  const [isReady, setIsReady] = useState(false);
  // Guard against double-init from React.StrictMode in dev
  const initStartedRef = useRef(false);

  useEffect(() => {
    const init = async () => {
      try {
        const window = getCurrentWebviewWindow();
        const label = window.label;

        // For main window, migrate legacy workspace storage first
        if (label === "main") {
          migrateWorkspaceStorage();
        }

        // Set the current window label for workspace storage
        // This must happen before store rehydration
        setCurrentWindowLabel(label);

        // Rehydrate workspace store from window-specific storage key
        // This ensures new windows don't inherit main's workspace
        useWorkspaceStore.persist.rehydrate();

        setWindowLabel(label);

        // CRITICAL: Only init documents for document windows (main, doc-*)
        // Settings, print-preview, etc. don't need document state
        if (label === "main" || label.startsWith("doc-")) {
          // Check if we already have tabs for this window
          // Also check initStartedRef to prevent double-init from StrictMode
          const existingTabs = useTabStore.getState().getTabsByWindow(label);
          if (existingTabs.length === 0 && !initStartedRef.current) {
            initStartedRef.current = true;
            // Check if we have a file path and/or workspace root in the URL query params
            const urlParams = new URLSearchParams(globalThis.location?.search || "");
            let filePath = urlParams.get("file");
            const workspaceRootParam = urlParams.get("workspaceRoot");

            // If workspace root is provided, open it first
            if (workspaceRootParam) {
              try {
                await useWorkspaceStore.getState().openWorkspace(workspaceRootParam);
              } catch (e) {
                console.error("[WindowContext] Failed to open workspace from URL param:", e);
              }
            }

            // For main window, also check pending files from Finder launch
            if (!filePath && label === "main") {
              try {
                const pendingFiles = await invoke<string[]>("get_pending_open_files");
                if (pendingFiles.length > 0) {
                  filePath = pendingFiles[0];
                  // Open remaining files in new windows
                  for (let i = 1; i < pendingFiles.length; i++) {
                    invoke("open_file_in_new_window", { path: pendingFiles[i] }).catch((e) =>
                      console.error("[WindowContext] Failed to open file in new window:", e)
                    );
                  }
                }
              } catch (e) {
                console.error("[WindowContext] Failed to get pending files:", e);
              }
            }

            // If opening fresh (no file and no workspace root), clear any persisted workspace
            // This ensures a clean slate when launching the app without a file
            if (!filePath && !workspaceRootParam && label === "main") {
              useWorkspaceStore.getState().closeWorkspace();
            }

            // Create the initial tab
            const tabId = useTabStore.getState().createTab(label, filePath);

            if (filePath) {
              // Load file content from disk
              try {
                const content = await readTextFile(filePath);
                useDocumentStore.getState().initDocument(tabId, content, filePath);
                useRecentFilesStore.getState().addFile(filePath);
              } catch (error) {
                console.error("[WindowContext] Failed to load file:", filePath, error);
                // Initialize with empty content if file can't be read
                useDocumentStore.getState().initDocument(tabId, "", null);
              }
            } else {
              // No file path - initialize empty document
              useDocumentStore.getState().initDocument(tabId, "", null);
            }
          }
        }

        setIsReady(true);
      } catch (error) {
        console.error("[WindowContext] Init failed:", error);
        // Still set ready to allow error boundary to catch render errors
        setIsReady(true);
      }
    };

    init();
  }, []);

  const isDocumentWindow = windowLabel === "main" || windowLabel.startsWith("doc-");

  if (!isReady) {
    return null; // Don't render until window label is determined
  }

  return (
    <WindowContext.Provider value={{ windowLabel, isDocumentWindow }}>
      {children}
    </WindowContext.Provider>
  );
}

export function useWindowLabel(): string {
  const context = useContext(WindowContext);
  if (!context) {
    throw new Error("useWindowLabel must be used within WindowProvider");
  }
  return context.windowLabel;
}

export function useIsDocumentWindow(): boolean {
  const context = useContext(WindowContext);
  if (!context) {
    throw new Error("useIsDocumentWindow must be used within WindowProvider");
  }
  return context.isDocumentWindow;
}
