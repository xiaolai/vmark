import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settingsStore";

const STORAGE_KEY = "vmark-settings";

/**
 * Syncs settings across windows using storage events.
 * When one window updates localStorage, other windows receive the event.
 */
export function useSettingsSync() {
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue);
          const currentState = useSettingsStore.getState();
          const updates: Record<string, unknown> = {};

          // Sync appearance settings
          if (parsed.state?.appearance) {
            const newAppearance = parsed.state.appearance;
            if (
              JSON.stringify(currentState.appearance) !==
              JSON.stringify(newAppearance)
            ) {
              updates.appearance = newAppearance;
            }
          }

          // Sync CJK formatting settings
          if (parsed.state?.cjkFormatting) {
            const newCjkFormatting = parsed.state.cjkFormatting;
            if (
              JSON.stringify(currentState.cjkFormatting) !==
              JSON.stringify(newCjkFormatting)
            ) {
              updates.cjkFormatting = newCjkFormatting;
            }
          }

          // Apply updates if any
          if (Object.keys(updates).length > 0) {
            useSettingsStore.setState(updates);
          }
        } catch {
          // Ignore parse errors
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);
}
