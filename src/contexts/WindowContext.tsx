/**
 * WindowContext
 *
 * Purpose: Top-level React context that bootstraps each window — determines the
 * window label, initializes document state, handles file loading from URL params,
 * workspace setup, tab transfers from other windows, and signals "ready" to Rust.
 *
 * Pipeline: Tauri creates window → WindowProvider mounts → detect label →
 * rehydrate workspace store → handle transfer / URL params / empty init →
 * emit "ready" to Rust → render children.
 *
 * Key decisions:
 *   - initStartedRef guards against React.StrictMode double-init in dev,
 *     which would create duplicate tabs and documents.
 *   - Tab transfer: when a window is created via drag-out, the URL includes a
 *     ?transfer param. handleTabTransfer claims the transfer data from Rust
 *     (stored in a global pending map) and sets up the tab + document.
 *   - Runtime transfers (tab:transfer event) are handled by a separate listener
 *     set up after isReady, enabling cross-window tab moves at any time.
 *   - The "ready" event is delayed by READY_EVENT_DELAY_MS to ensure child
 *     components' useEffect hooks have registered their menu event listeners
 *     before Rust starts sending events.
 *   - Workspace resolution: for files opened via Finder/drag, resolves the
 *     workspace root using openPolicy logic. For URL-provided workspace roots,
 *     loads config from disk.
 *   - Settings and non-document windows (label !== main/doc-*) skip document
 *     initialization entirely.
 *   - Settings window reads workspace state from the source document window's
 *     localStorage key so workspace config toggles work cross-window.
 *   - Doc-window localStorage is cleared on mount to prevent inheriting
 *     main window's persisted workspace state.
 *
 * @coordinates-with tab_transfer.rs — claims transfer data from Rust registry
 * @coordinates-with tabTransferActions.ts — prepares transfer payloads for new windows
 * @coordinates-with workspaceStorage.ts — per-window localStorage key scoping + findActiveWorkspaceLabel
 * @coordinates-with useWorkspaceSync.ts — cross-window workspace config rehydration
 * @coordinates-with openPolicy.ts — resolves workspace root for external files
 * @coordinates-with lib.rs (Rust) — listens for "ready" event per window
 * @module contexts/WindowContext
 */
import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from "react";
import { useWorkspaceSync } from "@/hooks/useWorkspaceSync";
import { invoke } from "@tauri-apps/api/core";
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
  findActiveWorkspaceLabel,
} from "../utils/workspaceStorage";
import { resolveWorkspaceRootForExternalFile } from "../utils/openPolicy";
import { isWithinRoot } from "../utils/paths";
import type { TabTransferPayload } from "@/types/tabTransfer";
import { windowCloseWarn, windowContextError } from "@/utils/debug";
import { getFileName } from "@/utils/pathUtils";

async function applyTabTransferData(label: string, data: TabTransferPayload): Promise<void> {
  // Set up workspace: prefer transferred root, fall back to file's parent
  const workspaceRoot = data.workspaceRoot
    ?? (data.filePath ? resolveWorkspaceRootForExternalFile(data.filePath) : null);
  if (workspaceRoot) {
    try {
      await openWorkspaceWithConfig(workspaceRoot);
    } catch {
      // Non-fatal — proceed without workspace
    }
  }

  const tabId = useTabStore.getState().createTransferredTab(label, {
    id: data.tabId,
    filePath: data.filePath,
    title: data.title,
    isPinned: false,
  });
  useTabStore.getState().updateTabTitle(tabId, data.title);
  useDocumentStore.getState().initDocument(
    tabId,
    data.content,
    data.filePath,
    data.savedContent
  );
  if (data.filePath) {
    useRecentFilesStore.getState().addFile(data.filePath);
  }
}

async function removeTransferredTabData(label: string, tabId: string): Promise<void> {
  useTabStore.getState().detachTab(label, tabId);
  useDocumentStore.getState().removeDocument(tabId);

  const remaining = useTabStore.getState().getTabsByWindow(label);
  if (remaining.length === 0 && label !== "main") {
    const win = getCurrentWebviewWindow();
    await invoke("close_window", { label: win.label }).catch((error: unknown) => {
      /* v8 ignore next -- @preserve String(error) fallback: invoke errors are always Error instances */
      windowCloseWarn("Failed to close window:", error instanceof Error ? error.message : String(error));
    });
  }
}

/**
 * Claim transfer data from Rust and create the tab + document.
 * Returns true if a transfer was handled (caller should skip normal init).
 */
async function handleTabTransfer(label: string): Promise<boolean> {
  const urlParams = new URLSearchParams(globalThis.location?.search || "");
  if (!urlParams.has("transfer")) return false;

  const data = await invoke<TabTransferPayload | null>(
    "claim_tab_transfer",
    { windowLabel: label }
  );
  if (!data) return false;
  await applyTabTransferData(label, data);

  return true;
}

/**
 * Delay before emitting "ready" event to Rust.
 * This ensures child components' useEffect hooks have run and set up menu listeners.
 * Without sufficient delay, menu events (e.g., menu:open) arrive before
 * useFileOperations has registered its listener.
 */
const READY_EVENT_DELAY_MS = 100;

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

        // Settings window: read workspace state from the source document window
        // so workspace config toggles work correctly across windows
        if (label === "settings") {
          const sourceLabel = findActiveWorkspaceLabel();
          if (sourceLabel) {
            setCurrentWindowLabel(sourceLabel);
          }
        }

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
        // Settings and other non-document windows don't need document state
        if (label === "main" || label.startsWith("doc-")) {
          // Check if we already have tabs for this window
          // Also check initStartedRef to prevent double-init from StrictMode
          const existingTabs = useTabStore.getState().getTabsByWindow(label);
          if (existingTabs.length === 0 && !initStartedRef.current) {
            initStartedRef.current = true;

            // Handle tab transfer (drag-out from another window)
            try {
              const transferred = await handleTabTransfer(label);
              if (transferred) {
                setIsReady(true);
                setTimeout(() => window.emit("ready", label), READY_EVENT_DELAY_MS);
                return;
              }
            } catch (err) {
              windowContextError("Failed to claim tab transfer:", err);
            }

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
                windowContextError("Failed to parse files param:", error);
              }
            }

            // If workspace root is provided, open it first and load config from disk
            if (workspaceRootParam) {
              try {
                await openWorkspaceWithConfig(workspaceRootParam);
              } catch (e) {
                windowContextError("Failed to open workspace from URL param:", e);
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
                  windowContextError("Failed to load file:", path, error);
                  useDocumentStore.getState().initDocument(tabId, "", null);
                  /* v8 ignore next -- @preserve reason: getFileName always returns a value for valid paths; || path is a defensive fallback */
                  const filename = getFileName(path) || path;
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
                  windowContextError("Failed to load file:", filePath, error);
                  // Initialize with empty content if file can't be read
                  useDocumentStore.getState().initDocument(tabId, "", null);
                  const filename = getFileName(filePath) || filePath;
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
        // Notify Rust that the window is ready to receive events.
        // Delay ensures:
        // 1. Rust's window.once("ready") listener is registered
        // 2. Child components' useEffect hooks have run and set up menu listeners
        // Without sufficient delay, menu events (e.g., menu:open) arrive before
        // useFileOperations has registered its listener.
        // Pass the window label so Rust can track which windows are ready.
        setTimeout(() => window.emit("ready", label), READY_EVENT_DELAY_MS);
      } catch (error) {
        windowContextError("Init failed:", error);
        // Still set ready to allow error boundary to catch render errors
        setIsReady(true);
        // Notify Rust even on error so waiting handlers don't hang
        const errorWindow = getCurrentWebviewWindow();
        setTimeout(() => errorWindow.emit("ready", errorWindow.label), READY_EVENT_DELAY_MS);
      }
    };

    /* v8 ignore start -- @preserve reason: .catch() callback on init() only fires on unhandled init errors; not triggered in controlled tests */
    init().catch((e) => {
      windowContextError("Unhandled init error:", e);
      setIsReady(true);
      const errorWindow = getCurrentWebviewWindow();
      setTimeout(() => errorWindow.emit("ready", errorWindow.label), READY_EVENT_DELAY_MS);
    });
    /* v8 ignore stop */
  }, []);

  useEffect(() => {
    if (!isReady) return;
    if (windowLabel !== "main" && !windowLabel.startsWith("doc-")) return;

    const currentWindow = getCurrentWebviewWindow();
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    currentWindow.listen<TabTransferPayload>("tab:transfer", async (event) => {
      if (cancelled) return;
      try {
        await applyTabTransferData(windowLabel, event.payload);
      } catch (error) {
        windowContextError("Failed to apply runtime tab transfer:", error);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    }).catch((error) => {
      windowContextError("Failed to setup tab transfer listener:", error);
    });

    let unlistenRemove: (() => void) | null = null;
    currentWindow.listen<{ tabId: string }>("tab:remove-by-id", (event) => {
      if (cancelled) return;
      const { tabId } = event.payload;
      void removeTransferredTabData(windowLabel, tabId);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenRemove = fn;
      }
    }).catch((error) => {
      windowContextError("Failed to setup tab removal listener:", error);
    });

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
      if (unlistenRemove) {
        unlistenRemove();
      }
    };
  }, [isReady, windowLabel]);

  // Sync workspace config changes across windows (settings ↔ document windows)
  useWorkspaceSync();

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
