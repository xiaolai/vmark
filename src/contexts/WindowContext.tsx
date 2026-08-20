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
 *   - A forced blank untitled tab is created ONLY for an explicitly created
 *     `doc-*` window with no file. Workspace re-entry does not (the file
 *     explorer is the entry point), and neither does the LAUNCH window, which
 *     lands on the WelcomeScreen instead (#1313). Hot-exit / lastOpenTabs
 *     restore can still populate tabs after init.
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
import { useRecentWorkspacesStore, useWorkspaceStore } from "../stores/workspaceStore";
import { useUIStore } from "../stores/uiStore";
import { openWorkspaceWithConfig } from "@/services/workspaces/openWorkspaceWithConfig";
import { restoreWindowBrowserSession } from "@/services/persistence/windowBrowserSession";
import { openStartupContent, parseStartupFilesParam } from "./startupFileOpen";
import { isLaunchWindow, isDocumentWindowLabel } from "@/utils/windowLabels";
import { useWindowReady } from "./useWindowReady";
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
import { windowContextError, workspaceWarn, appError } from "@/utils/debug";
import { claimWorkspaceTransferForWindow } from "@/services/workspaces/workspaceWindowActions";
import { voidAsync } from "@/utils/voidAsync";

/**
 * Delay before emitting "ready" event to Rust.
 * This ensures child components' useEffect hooks have run and set up menu listeners.
 * Without sufficient delay, menu events (e.g., menu:open) arrive before
 * useFileOperations has registered its listener.
 */

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
  const { isReady, markReady } = useWindowReady();
  // Guard against double-init from React.StrictMode in dev
  const initStartedRef = useRef(false);

  useEffect(() => {
    // StrictMode invokes this effect twice in dev. The document-init block below
    // was already guarded, but `markReady` was NOT: the second pass reached it
    // while the first was still awaiting, so Rust got two `ready` events and the
    // children mounted before initialisation had finished. The guard belongs to
    // the whole effect, and must be set SYNCHRONOUSLY — setting it after an
    // await would let both passes through before either recorded it.
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    const init = async () => {
      try {
        const window = getCurrentWebviewWindow();
        const label = window.label;

        // For main window, migrate legacy workspace storage first
        if (isLaunchWindow(label)) {
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
        void Promise.resolve(useWorkspaceStore.persist.rehydrate()).catch((e) => workspaceWarn("Workspace rehydrate failed:", e));

        setWindowLabel(label);

        // CRITICAL: Only init documents for document windows (main, doc-*)
        // Settings and other non-document windows don't need document state
        if (isDocumentWindowLabel(label)) {
          // Check if we already have tabs for this window
          // Also check initStartedRef to prevent double-init from StrictMode
          const existingTabs = useTabStore.getState().getTabsByWindow(label);
          if (existingTabs.length === 0) {

            // Handle workspace/tab transfer (drag-out from another window)
            try {
              const workspaceTransferred = await claimWorkspaceTransferForWindow(label, openWorkspaceWithConfig);
              if (workspaceTransferred) {
                markReady(window);
                return;
              }
              const transferred = await handleTabTransfer(label);
              if (transferred) {
                markReady(window);
                return;
              }
            } catch (err) {
              windowContextError("Failed to claim tab transfer:", err);
            }

            // Check if we have a file path and/or workspace root in the URL query params
            const urlParams = new URLSearchParams(globalThis.location?.search || "");
            const filePath = urlParams.get("file");
            const workspaceRootParam = urlParams.get("workspaceRoot");
            const filePaths = parseStartupFilesParam(urlParams.get("files"));

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
                } else if (isLaunchWindow(label)) {
                  useWorkspaceStore.getState().closeWorkspace();
                }
              }
            }

            // If opening fresh (no file and no workspace root), clear any persisted workspace
            // This ensures a clean slate when launching the app without a file
            if (!filePath && !workspaceRootParam && isLaunchWindow(label)) {
              useWorkspaceStore.getState().closeWorkspace();
            }
            // What this window opens, and why, lives in startupFileOpen.
            await openStartupContent(label, {
              filePaths,
              filePath,
              workspaceRoot: workspaceRootParam,
              lastOpenTabs: workspaceConfig?.lastOpenTabs,
            });
            // The LAUNCH window with nothing to open falls through to no tab at
            // all, which `Editor.tsx` already renders as the WelcomeScreen
            // (#1313) — a forced blank tab only meant startup could never reach
            // it. Hot-exit/lastOpenTabs still populate tabs afterwards; an empty
            // window is a valid intermediate state, not a broken one.
            // WI-8.2: restore the window's human browser pages (background).
            restoreWindowBrowserSession(label);
          }
        }

        markReady(window);
      } catch (error) {
        windowContextError("Init failed:", error);
        // Still set ready to allow error boundary to catch render errors
        // Notify Rust even on error so waiting handlers don't hang
        markReady(getCurrentWebviewWindow());
      }
    };

    /* v8 ignore start -- @preserve reason: .catch() callback on init() only fires on unhandled init errors; not triggered in controlled tests */
    init().catch((e) => {
      windowContextError("Unhandled init error:", e);
      markReady(getCurrentWebviewWindow());
    });
    /* v8 ignore stop */
  }, []);

  useEffect(() => {
    if (!isReady) return;
    if (!isDocumentWindowLabel(windowLabel)) return;

    const currentWindow = getCurrentWebviewWindow();
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    currentWindow.listen<TabTransferPayload>("tab:transfer", voidAsync(async (event) => {
      if (cancelled) return;
      try {
        await applyTabTransferData(windowLabel, event.payload);
      } catch (error) {
        windowContextError("Failed to apply runtime tab transfer:", error);
      }
    }, (err) => appError("Tab transfer listener failed:", err))).then((fn) => {
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

  const isDocumentWindow = isDocumentWindowLabel(windowLabel);

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
