/**
 * Universal Toolbar Toggle Hook
 *
 * Purpose: Listens for the configurable keyboard shortcut to toggle the
 *   universal toolbar visibility — works in both WYSIWYG and Source modes.
 *
 * @coordinates-with uiStore.ts — toggles toolbar visibility
 * @coordinates-with shortcutsStore.ts — reads configurable shortcut binding
 * @module hooks/useUniversalToolbar
 */
import { useEffect, useCallback } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useSearchStore } from "@/stores/searchStore";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { matchesShortcutEvent } from "@/utils/shortcutMatch";

/**
 * Hook to handle the universal toolbar toggle shortcut.
 *
 * Attaches a global keydown listener for the configured shortcut.
 *
 * @example
 * function App() {
 *   useUniversalToolbar();
 *   return <Editor />;
 * }
 */
export function useUniversalToolbar(): void {
  const toggleToolbar = useCallback(() => {
    const ui = useUIStore.getState();
    if (!ui.universalToolbarVisible) {
      // Opening UniversalToolbar: close StatusBar and FindBar
      ui.setStatusBarVisible(false);
      useSearchStore.getState().close();
    }
    ui.toggleUniversalToolbar();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle Escape with two-step cascade per spec Section 3.3
      if (e.key === "Escape" && useUIStore.getState().universalToolbarVisible) {
        const activeEl = document.activeElement as HTMLElement | null;
        // Don't intercept Escape in inputs/textareas
        if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) {
          return;
        }
        // Check if focus is inside toolbar - let toolbar handle it for two-step
        const toolbarEl = document.querySelector(".universal-toolbar");
        if (toolbarEl && toolbarEl.contains(activeEl)) {
          // Toolbar's own keydown handler will implement two-step cascade
          return;
        }
        // Focus outside toolbar - check dropdown state for two-step
        const ui = useUIStore.getState();
        if (ui.toolbarDropdownOpen) {
          // Step 1: Close dropdown only (toolbar stays, dropdown state will be cleared by component)
          e.preventDefault();
          e.stopPropagation();
          ui.setToolbarDropdownOpen(false);
          return;
        }
        // Step 2: Close toolbar entirely
        e.preventDefault();
        e.stopPropagation();
        ui.clearToolbarSession();
        return;
      }
      const shortcut = useShortcutsStore.getState().getShortcut("formatToolbar");
      if (matchesShortcutEvent(e, shortcut)) {
        e.preventDefault();
        e.stopPropagation();
        toggleToolbar();
      }
    };

    // Use capture phase to intercept before editors
    document.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [toggleToolbar]);
}
