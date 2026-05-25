/**
 * Command Palette keyboard shortcut hook — ADR-012.
 */

import { useEffect } from "react";
import { useShortcutsStore } from "@/stores/settingsStore";
import { matchesShortcutEvent } from "@/utils/shortcutMatch";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useCommandPaletteStore } from "./commandPaletteStore";

export function useCommandPaletteShortcut(): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      /* v8 ignore next -- @preserve IME guard not reachable in jsdom */
      if (isImeKeyEvent(e)) return;
      const key = useShortcutsStore.getState().getShortcut("commandPalette");
      if (matchesShortcutEvent(e, key)) {
        e.preventDefault();
        useCommandPaletteStore.getState().toggle();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
