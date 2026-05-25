/**
 * Quick Open Shortcuts Hook
 *
 * Purpose: Listens for the Quick Open keyboard shortcut and menu event, toggling the Quick Open palette.
 *
 * @module hooks/useQuickOpenShortcuts
 */

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";
import { useShortcutsStore } from "@/stores/settingsStore";
import { useQuickOpenStore } from "@/components/QuickOpen/quickOpenStore";
import { matchesShortcutEvent } from "@/utils/shortcutMatch";
import { isImeKeyEvent } from "@/utils/imeGuard";

export function useQuickOpenShortcuts(): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      /* v8 ignore next -- @preserve reason: IME key event guard not reachable in jsdom test environment */
      if (isImeKeyEvent(e)) return;
      const quickOpenKey = useShortcutsStore.getState().getShortcut("quickOpen");
      if (matchesShortcutEvent(e, quickOpenKey)) {
        e.preventDefault();
        useQuickOpenStore.getState().toggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const unlisten = listen("menu:quick-open", () => {
      useQuickOpenStore.getState().open();
    });
    return () => safeUnlistenAsync(unlisten);
  }, []);
}
