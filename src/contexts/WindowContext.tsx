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
 *   - initStartedRef guards against React.StrictMode double-init in dev.
 *   - Transfer windows claim Rust registry payloads before normal init.
 *   - Runtime transfers are handled by listeners set up after isReady.
 *   - Workspace resolution: for files opened via Finder/drag, resolves the
 *     workspace root using openPolicy logic. For URL-provided workspace roots,
 *     loads config from disk.
 *   - Settings and non-document windows (label !== main/doc-*) skip document
 *     initialization entirely.
 *   - Settings window reads workspace state from the source document window's
 *     localStorage key so workspace config toggles work cross-window.
 *   - Doc-window localStorage is cleared on mount to prevent inheriting
 *     main window's persisted workspace state.
 *   - Workspace re-entry without a specific file (e.g. dock-icon reopen
 *     into a workspace) does NOT auto-create a blank untitled tab — the
 *     file explorer is the entry point, and a forced blank tab feels
 *     orphaned. Cold start without any workspace context still creates
 *     one (familiar new-file UX). Hot-exit / lastOpenTabs restore can
 *     still populate tabs after init.
 *
 * @coordinates-with tabTransferHandlers.ts — applies incoming transfers, answers the removal handshake
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
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useTabStore } from "../stores/tabStore";
import { useRecentWorkspacesStore } from "../stores/workspaceStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useUIStore } from "../stores/uiStore";
import { openWorkspaceWithConfig } from "../hooks/openWorkspaceWithConfig";
import { loadStartupFileIntoTab, createBlankStartupTab } from "./startupFileOpen";
import {
  applyTabTransferData,
  handleTabTransfer,
  handleTabRemovalRequest,
} from "./tabTransferHandlers";
import {
  setCurrentWindowLabel,
  migrateWorkspaceStorage,
  getWorkspaceStorageKey,
  findActiveWorkspaceLabel,
} from "@/services/persistence/workspaceStorage";
import { resolveWorkspaceRootForExternalFile } from "../utils/openPolicy";
import { isWithinRoot } from "../utils/paths";
import type { TabRemovalRequestEvent, TabTransferPayload } from "@/types/tabTransfer";
import { windowContextError } from "@/utils/debug";
import { claimWorkspaceTransferForWindow } from "@/services/workspaces/workspaceWindowActions";

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

export const WindowContext = createContext<WindowContextValue | null>(null);

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

            // Handle workspace/tab transfer (drag-out from another window)
            try {
              const workspaceTransferred = await claimWorkspaceTransferForWindow(label, openWorkspaceWithConfig);
              if (workspaceTransferred) {
                setIsReady(true);
                setTimeout(() => window.emit("ready", label), READY_EVENT_DELAY_MS);
                return;
              }
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

            // If workspace root is provided, open it, reveal the file explorer,
            // and remember it — mirroring the same-window Open Workspace flow so a
            // new window actually lands in the selected workspace (#1005). Without
            // showSidebarWithView the workspace opened "headless" (no file tree).
            let workspaceConfig: Awaited<
              ReturnType<typeof openWorkspaceWithConfig>
            > = null;
            if (workspaceRootParam) {
              try {
                workspaceConfig = await openWorkspaceWithConfig(workspaceRootParam, { windowLabel: label });
                useUIStore.getState().showSidebarWithView("files");
                useRecentWorkspacesStore.getState().addWorkspace(workspaceRootParam);
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
                  await openWorkspaceWithConfig(derivedRoot, { windowLabel: label });
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
            // Shared per-file open: delegates to openFileInNewTabCore (size
            // routing, dedupe + close-during-read guards, file ownership /
            // read-only conflict handling, recents, large-file source marking)
            // and guarantees the window ends up non-empty. See startupFileOpen.
            if (filePaths && filePaths.length > 0) {
              for (const path of filePaths) {
                await loadStartupFileIntoTab(label, path);
              }
            } else if (filePath) {
              await loadStartupFileIntoTab(label, filePath);
            } else if (workspaceRootParam) {
              // Restore the workspace's last open tabs in the new window (#1005),
              // matching the same-window Open Workspace behavior.
              for (const restorePath of workspaceConfig?.lastOpenTabs ?? []) {
                await loadStartupFileIntoTab(label, restorePath);
              }
            } else {
              // No file AND no workspace context: fresh new-file UX — create
              // a blank untitled tab so the window has a live document.
              // In workspace mode we deliberately skip this; the file explorer
              // is the entry point, and a forced blank tab feels orphaned
              // (the user wanted "into the workspace," not "into the workspace
              // plus a blank doc"). Hot-exit / lastOpenTabs restore can still
              // populate tabs after this — see useHotExitStartup and
              // useWorkspaceBootstrap.
              createBlankStartupTab(label);
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
    currentWindow.listen<TabRemovalRequestEvent>("tab:remove-by-id", (event) => {
      if (cancelled) return;
      // Two-phase handshake — see tabTransferHandlers. `prepare` reports this
      // window's live tab state and removes nothing; only `commit` removes.
      void handleTabRemovalRequest(windowLabel, event.payload).catch((error) => {
        windowContextError("Failed to handle tab removal request:", error);
      });
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
