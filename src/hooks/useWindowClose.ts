import { useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useWindowLabel } from "../contexts/WindowContext";
import { useDocumentStore } from "../stores/documentStore";
import { useTabStore } from "../stores/tabStore";
import { promptSaveForDirtyDocument } from "@/hooks/closeSave";

// Dev-only logging for debugging window close issues
// Logs to terminal via Rust command
const closeLog = import.meta.env.DEV
  ? (label: string, ...args: unknown[]) => {
      const msg = `[WindowClose:${label}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
      console.log(msg);
      // Log to terminal via Rust (fire-and-forget)
      invoke("debug_log", { message: msg }).catch(() => {});
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
        closeLog(windowLabel, "invoking close_window with label:", windowLabel);
        await invoke("close_window", { label: windowLabel });
        closeLog(windowLabel, "close_window returned");
        return true;
      }

      const { message } = await import("@tauri-apps/plugin-dialog");

      // Process each dirty tab - prompt user for each one
      for (const dirtyTab of dirtyTabs) {
        const doc = useDocumentStore.getState().getDocument(dirtyTab.id);
        if (!doc?.isDirty) continue; // May have been saved in a previous iteration

        const result = await promptSaveForDirtyDocument({
          windowLabel,
          tabId: dirtyTab.id,
          title: doc.filePath || dirtyTab.title,
          filePath: doc.filePath,
          content: doc.content,
        });

        if (result.action === "cancelled") {
          return false;
        }

        // If shouldSave is false, user chose "Don't Save" - continue to next tab
      }

      // All dirty tabs handled - close the window
      tabs.forEach((tab) => useDocumentStore.getState().removeDocument(tab.id));
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

          isQuitRequestRef.current = true;
          const closed = await handleCloseRequest();
          if (!closed) {
            invoke("cancel_quit").catch(() => {});
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
