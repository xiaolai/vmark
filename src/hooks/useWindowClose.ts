import { useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useWindowLabel } from "../contexts/WindowContext";
import { useDocumentStore } from "../stores/documentStore";
import { useTabStore } from "../stores/tabStore";
import {
  promptSaveForDirtyDocument,
  promptSaveForMultipleDocuments,
  type CloseSaveContext,
} from "@/hooks/closeSave";
import { persistWorkspaceSession } from "@/hooks/workspaceSession";

// Dev-only logging for debugging window close issues
// Logs to console and Rust debug_log
const closeLog = import.meta.env.DEV
  ? (label: string, ...args: unknown[]) => {
      const msg = `[WindowClose:${label}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
      console.log(msg);
      // Log to terminal via Rust (fire-and-forget, but log failures in dev)
      invoke("debug_log", { message: msg }).catch((e) => {
        console.warn("[closeLog] debug_log invoke failed:", e);
      });
    }
  : () => {};

/**
 * Handle window close with save confirmation dialog.
 * Listens to both:
 * - menu:close (Cmd+W) - emitted only to focused window by Rust
 * - window:close-requested (traffic light) - window-specific from Rust
 */
export function useWindowClose() {
  const windowLabel = useWindowLabel();
  // Prevent re-entry during close handling (avoids duplicate dialogs)
  const isClosingRef = useRef(false);
  const isQuitRequestRef = useRef(false);

  const handleCloseRequest = useCallback(async (): Promise<boolean> => {
    closeLog(windowLabel, "handleCloseRequest called");
    // Debug: capture stack trace to find what's triggering the close
    if (import.meta.env.DEV) {
      console.trace(`[WindowClose:${windowLabel}] call stack`);
    }
    // Guard against duplicate close requests
    if (isClosingRef.current) {
      closeLog(windowLabel, "already closing, ignoring");
      return false;
    }
    isClosingRef.current = true;

    try {
      // Get all tabs for this window
      const allTabs = useTabStore.getState().tabs;
      const tabs = allTabs[windowLabel] ?? [];
      closeLog(windowLabel, "tabs state:", {
        windowLabel,
        allWindowLabels: Object.keys(allTabs),
        tabCount: tabs.length,
        tabIds: tabs.map(t => t.id)
      });

      // Check if any tabs have unsaved changes
      const dirtyTabs = tabs.filter((tab) => {
        const doc = useDocumentStore.getState().getDocument(tab.id);
        return doc?.isDirty;
      });

      // If no dirty tabs, just close
      if (dirtyTabs.length === 0) {
        closeLog(windowLabel, "no dirty tabs, closing window");
        tabs.forEach((tab) => useDocumentStore.getState().removeDocument(tab.id));
        await persistWorkspaceSession(windowLabel);
        useTabStore.getState().removeWindow(windowLabel);
        closeLog(windowLabel, "invoking close_window with label:", windowLabel);
        await invoke("close_window", { label: windowLabel });
        closeLog(windowLabel, "close_window returned");
        return true;
      }

      // Build contexts for dirty documents
      const dirtyContexts: CloseSaveContext[] = dirtyTabs
        .map((tab) => {
          const doc = useDocumentStore.getState().getDocument(tab.id);
          if (!doc?.isDirty) return null;
          return {
            windowLabel,
            tabId: tab.id,
            title: doc.filePath || tab.title,
            filePath: doc.filePath,
            content: doc.content,
          };
        })
        .filter((ctx): ctx is CloseSaveContext => ctx !== null);

      // Single dirty document: use individual prompt
      if (dirtyContexts.length === 1) {
        const result = await promptSaveForDirtyDocument(dirtyContexts[0]);
        if (result.action === "cancelled") {
          return false;
        }
      } else {
        // Multiple dirty documents: use summary dialog
        const result = await promptSaveForMultipleDocuments(dirtyContexts);
        if (result.action === "cancelled") {
          return false;
        }
      }

      // All dirty tabs handled - close the window
      tabs.forEach((tab) => useDocumentStore.getState().removeDocument(tab.id));
      await persistWorkspaceSession(windowLabel);
      useTabStore.getState().removeWindow(windowLabel);
      await invoke("close_window", { label: windowLabel });
      return true;
    } catch (error) {
      console.error("Failed to close window:", error);
      return false;
    } finally {
      isClosingRef.current = false;
    }
  }, [windowLabel]);

  useEffect(() => {
    const currentWindow = getCurrentWebviewWindow();
    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      closeLog(windowLabel, "setting up event listeners");

      // Listen to menu:close (Cmd+W)
      // Note: Tauri's window.emit() broadcasts to all windows, so we filter by target label
      const unlistenMenu = await currentWindow.listen<string>("menu:close", (event) => {
        const targetLabel = event.payload;
        closeLog(windowLabel, "menu:close received, target:", targetLabel);
        if (targetLabel === windowLabel) {
          void handleCloseRequest();
        }
      });
      unlisteners.push(unlistenMenu);

      // Listen to window:close-requested (traffic light button)
      // Note: Tauri's window.emit() broadcasts to all windows, so we filter by target label
      const unlistenClose = await currentWindow.listen<string>(
        "window:close-requested",
        (event) => {
          const targetLabel = event.payload;
          closeLog(windowLabel, "window:close-requested received, target:", targetLabel);
          // Only handle if this event is for our window
          if (targetLabel === windowLabel) {
            void handleCloseRequest();
          }
        }
      );
      unlisteners.push(unlistenClose);

      const unlistenQuit = await currentWindow.listen<string>(
        "app:quit-requested",
        async (event) => {
          const targetLabel = event.payload;
          if (targetLabel !== windowLabel) return;
          // Guard against duplicate listeners (React Strict Mode creates two)
          // If already closing, another handler is processing - don't interfere
          if (isClosingRef.current) {
            closeLog(windowLabel, "quit-requested: already closing, skipping duplicate handler");
            return;
          }

          isQuitRequestRef.current = true;
          const closed = await handleCloseRequest();
          if (!closed) {
            invoke("cancel_quit").catch((e) => {
              if (import.meta.env.DEV) {
                console.warn("[WindowClose] cancel_quit failed:", e);
              }
            });
          }
          isQuitRequestRef.current = false;
        }
      );
      unlisteners.push(unlistenQuit);

      closeLog(windowLabel, "event listeners set up");
    };

    setup();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [windowLabel, handleCloseRequest]);
}
