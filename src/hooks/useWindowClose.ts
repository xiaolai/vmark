/**
 * Window Close Hook
 *
 * Purpose: Handles window-level and tab-level close events — menu:close
 *   closes the active tab (with dirty check), while traffic-light close and
 *   Cmd+Q close the entire window after saving dirty documents.
 *
 * Pipeline (window close): Traffic light / Cmd+Q → Tauri close-requested →
 *   this hook → check dirty tabs → promptSaveForMultipleDocuments() →
 *   persist workspace session → allow close or cancel
 *
 * Pipeline (menu close): Cmd+W menu accelerator → menu:close event →
 *   closeTabWithDirtyCheck → closeWindowIfEmpty (closes window if last)
 *
 * Key decisions:
 *   - Prevents default close to run async save prompts first
 *   - Batches all dirty docs into one multi-save prompt
 *   - When no tab is dirty but at least one is pinned, prompts before
 *     closing — honors the same "keep this around" signal that tab close
 *     (Cmd+W) already enforces. Skipped when dirty docs trigger the save
 *     dialog (that dialog already interrupts intent).
 *   - Persists workspace session (open tabs) before closing
 *   - Dev-only closeLog for debugging window close race conditions
 *
 * @coordinates-with closeSave.ts — promptSaveForMultipleDocuments dialog
 * @coordinates-with useTabOperations.ts — closeTabWithDirtyCheck for menu:close
 * @coordinates-with workspaceSession.ts — persists last open tabs
 * @module hooks/useWindowClose
 */

import { useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { useWindowLabel } from "../contexts/WindowContext";
import { useDocumentStore } from "../stores/documentStore";
import { useTabStore } from "../stores/tabStore";
import {
  promptSaveForDirtyDocument,
  promptSaveForMultipleDocuments,
  type CloseSaveContext,
} from "@/hooks/closeSave";
import { closeTabWithDirtyCheck } from "@/hooks/useTabOperations";
import { persistWorkspaceSession } from "@/hooks/workspaceSession";
import { windowCloseLog, windowCloseWarn, windowCloseError } from "@/utils/debug";

// Dev-only logging for debugging window close issues
// Logs to console and Rust debug_log
/* v8 ignore start -- import.meta.env.DEV=true in vitest; production no-op branch never reached in tests */
const closeLog = import.meta.env.DEV
  ? (label: string, ...args: unknown[]) => {
      const msg = `[WindowClose:${label}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
      windowCloseLog(msg);
      // Log to terminal via Rust (fire-and-forget, but log failures in dev)
      invoke("debug_log", { message: msg }).catch((e) => {
        windowCloseWarn("debug_log invoke failed:", e);
      });
    }
  : () => {};
/* v8 ignore stop */

/**
 * Handle window and tab close events with save confirmation.
 * Listens to:
 * - menu:close (Cmd+W) — closes the active tab (not the window)
 * - window:close-requested (traffic light) — closes the entire window
 * - app:quit-requested (Cmd+Q) — closes window as part of app quit
 */
export function useWindowClose() {
  const windowLabel = useWindowLabel();
  // Prevent re-entry during close handling (avoids duplicate dialogs)
  const isClosingRef = useRef(false);

  const handleCloseRequest = useCallback(async (): Promise<boolean> => {
    closeLog(windowLabel, "handleCloseRequest called");
    // Debug: capture stack trace to find what's triggering the close
    /* v8 ignore start -- import.meta.env.DEV=true in vitest; production false-branch never taken */
    if (import.meta.env.DEV) {
      console.trace(`[WindowClose:${windowLabel}] call stack`);
    }
    /* v8 ignore stop */
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

      // If no dirty tabs, just close — but first check for pinned tabs.
      // Pin is the user's "keep this around" signal; the per-tab close path
      // (closeTab in tabStore) already refuses to drop a pinned tab without
      // explicit unpin. Window close used to ignore the signal and silently
      // drop pinned tabs. Confirm once when no dirty docs are involved; when
      // there ARE dirty docs, the save dialog already interrupts intent and
      // stacking a second prompt is friction-on-friction.
      if (dirtyTabs.length === 0) {
        const pinnedTabs = tabs.filter((tab) => tab.isPinned);
        if (pinnedTabs.length > 0) {
          const confirmed = await ask(
            i18n.t("dialog:windowClose.pinnedPrompt", {
              count: pinnedTabs.length,
            }),
            {
              title: i18n.t("dialog:windowClose.pinnedTitle"),
              kind: "warning",
              okLabel: i18n.t("dialog:windowClose.confirmClose"),
              cancelLabel: i18n.t("dialog:common.cancel"),
            },
          );
          if (!confirmed) {
            closeLog(windowLabel, "close cancelled by pinned-tabs prompt");
            return false;
          }
        }
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
      windowCloseError("Failed to close window:", error);
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

      // Listen to menu:close (Cmd+W menu accelerator).
      // Close the active tab. closeWindowIfEmpty (inside closeTabWithDirtyCheck)
      // closes the window when the last tab is closed (macOS standard behavior).
      // useTabShortcuts also handles Cmd+W via keydown; the second invocation
      // is a safe no-op because the tab is already removed by the time it runs.
      const unlistenMenu = await currentWindow.listen<string>("menu:close", async (event) => {
        const targetLabel = event.payload;
        closeLog(windowLabel, "menu:close received, target:", targetLabel);
        if (targetLabel === windowLabel) {
          const activeTabId = useTabStore.getState().activeTabId[windowLabel];
          if (activeTabId) {
            try {
              await closeTabWithDirtyCheck(windowLabel, activeTabId);
            } catch (error) {
              windowCloseError("menu:close tab close failed:", error);
            }
          }
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

          const closed = await handleCloseRequest();
          if (!closed) {
            invoke("cancel_quit").catch((e) => {
              /* v8 ignore start -- import.meta.env.DEV=true in vitest; production false-branch never taken */
              if (import.meta.env.DEV) {
                windowCloseWarn("cancel_quit failed:", e);
              }
              /* v8 ignore stop */
            });
          }
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
