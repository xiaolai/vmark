import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { useDocumentStore } from "../stores/documentStore";
import { useWindowLabel } from "../contexts/WindowContext";

// Re-entry guard for quit handling (prevents duplicate dialogs)
let isQuittingRef = false;

/**
 * Handle app quit request with confirmation for unsaved documents.
 * Only the main window handles quit confirmation to avoid duplicate dialogs.
 */
export function useAppQuit() {
  const windowLabel = useWindowLabel();

  useEffect(() => {
    // Only main window handles quit confirmation
    if (windowLabel !== "main") return;

    const handleQuitRequest = async () => {
      // Prevent re-entry (duplicate dialogs from rapid Cmd+Q)
      if (isQuittingRef) return;
      isQuittingRef = true;

      try {
        const dirtyWindows = useDocumentStore.getState().getAllDirtyWindows();

        if (dirtyWindows.length === 0) {
          // No unsaved documents - quit immediately
          await invoke("force_quit");
          return;
        }

        // Ask user for confirmation
        const confirmed = await ask(
          `You have ${dirtyWindows.length} unsaved document(s). Quit without saving?`,
          {
            title: "Unsaved Changes",
            kind: "warning",
            okLabel: "Quit",
            cancelLabel: "Cancel",
          }
        );

        if (confirmed) {
          await invoke("force_quit");
        }
      } catch (error) {
        console.error("Failed to quit application:", error);
      } finally {
        isQuittingRef = false;
      }
    };

    // Global listen is fine for app-wide events
    const unlistenPromise = listen("app:quit-requested", handleQuitRequest);

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [windowLabel]);
}
