import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { useDocumentStore } from "../stores/documentStore";
import { useTabStore } from "../stores/tabStore";
import { useRecentFilesStore } from "../stores/recentFilesStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { detectLinebreaks } from "../utils/linebreakDetection";
import { openWorkspaceWithConfig } from "../hooks/openWorkspaceWithConfig";
import {
  setCurrentWindowLabel,
  migrateWorkspaceStorage,
  getWorkspaceStorageKey,
} from "../utils/workspaceStorage";
import { resolveWorkspaceRootForExternalFile } from "../utils/openPolicy";
import { isWithinRoot } from "../utils/paths";

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

        // Clear any stale persisted workspace state for doc windows
        if (label.startsWith("doc-")) {
          const storageKey = getWorkspaceStorageKey(label);
          localStorage.removeItem(storageKey);
        }

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
            const filePath = urlParams.get("file");
            const workspaceRootParam = urlParams.get("workspaceRoot");
            const filesParam = urlParams.get("files");
            let filePaths: string[] | null = null;
            if (filesParam) {
              try {
                const parsed = JSON.parse(filesParam);
                if (Array.isArray(parsed)) {
                  filePaths = parsed.filter((value) => typeof value === "string");
                }
              } catch (error) {
                console.error("[WindowContext] Failed to parse files param:", error);
              }
            }

            // If workspace root is provided, open it first and load config from disk
            if (workspaceRootParam) {
              try {
                await openWorkspaceWithConfig(workspaceRootParam);
              } catch (e) {
                console.error("[WindowContext] Failed to open workspace from URL param:", e);
              }
            }

            // Files opened via Finder/Explorer are now handled directly in Rust
            // (RunEvent::Opened creates windows with file path in URL params)

            if (filePath && !workspaceRootParam) {
              const { rootPath, isWorkspaceMode } = useWorkspaceStore.getState();
              const isWithinWorkspace = rootPath
                ? isWithinRoot(rootPath, filePath)
                : false;

              if (!isWorkspaceMode || !rootPath || !isWithinWorkspace) {
                const derivedRoot = resolveWorkspaceRootForExternalFile(filePath);
                if (derivedRoot) {
                  await openWorkspaceWithConfig(derivedRoot);
                } else if (label === "main") {
                  useWorkspaceStore.getState().closeWorkspace();
                }
              }
            }

            // If opening fresh (no file and no workspace root), clear any persisted workspace
            // This ensures a clean slate when launching the app without a file
            if (!filePath && !workspaceRootParam && label === "main") {
              useWorkspaceStore.getState().closeWorkspace();
            }
            if (filePaths && filePaths.length > 0) {
              for (const path of filePaths) {
                const tabId = useTabStore.getState().createTab(label, path);
                try {
                  const content = await readTextFile(path);
                  useDocumentStore.getState().initDocument(tabId, content, path);
                  useDocumentStore.getState().setLineMetadata(tabId, detectLinebreaks(content));
                  useRecentFilesStore.getState().addFile(path);
                } catch (error) {
                  console.error("[WindowContext] Failed to load file:", path, error);
                  useDocumentStore.getState().initDocument(tabId, "", null);
                  const filename = path.split("/").pop() ?? path;
                  toast.error(`Failed to open ${filename}`);
                }
              }
            } else {
              // Create the initial tab
              const tabId = useTabStore.getState().createTab(label, filePath);

              if (filePath) {
                // Load file content from disk
                try {
                  const content = await readTextFile(filePath);
                  useDocumentStore.getState().initDocument(tabId, content, filePath);
                  useDocumentStore.getState().setLineMetadata(tabId, detectLinebreaks(content));
                  useRecentFilesStore.getState().addFile(filePath);
                } catch (error) {
                  console.error("[WindowContext] Failed to load file:", filePath, error);
                  // Initialize with empty content if file can't be read
                  useDocumentStore.getState().initDocument(tabId, "", null);
                  const filename = filePath.split("/").pop() ?? filePath;
                  toast.error(`Failed to open ${filename}`);
                }
              } else {
                // No file path - initialize empty document
                useDocumentStore.getState().initDocument(tabId, "", null);
              }
            }
          }
        }

        setIsReady(true);
        // Notify Rust that the window is ready to receive events
        window.emit("ready", null);
      } catch (error) {
        console.error("[WindowContext] Init failed:", error);
        // Still set ready to allow error boundary to catch render errors
        setIsReady(true);
        // Notify Rust even on error so waiting handlers don't hang
        getCurrentWebviewWindow().emit("ready", null);
      }
    };

    init().catch((e) => {
      console.error("[WindowContext] Unhandled init error:", e);
      setIsReady(true);
      getCurrentWebviewWindow().emit("ready", null);
    });
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
