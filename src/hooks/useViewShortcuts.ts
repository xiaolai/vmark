/**
 * View Shortcuts Hook
 *
 * Handles keyboard shortcuts for view modes (configurable).
 * Menu accelerators don't always work reliably, so we listen directly.
 */

import { useEffect } from "react";
import { useViewSettingsStore } from "@/stores/viewSettingsStore";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { matchesShortcutEvent } from "@/utils/shortcutMatch";

export function useViewShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;
      // Ignore if in input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        return;
      }

      const shortcuts = useShortcutsStore.getState();

      // Source mode
      const sourceModeKey = shortcuts.getShortcut("sourceMode");
      if (matchesShortcutEvent(e, sourceModeKey)) {
        e.preventDefault();
        // Close any open image paste toast (don't paste - user is switching modes)
        const toastStore = useImagePasteToastStore.getState();
        if (toastStore.isOpen) {
          toastStore.hideToast();
        }
        flushActiveWysiwygNow();
        useViewSettingsStore.getState().toggleSourceMode();
        return;
      }

      // Focus mode
      const focusModeKey = shortcuts.getShortcut("focusMode");
      if (matchesShortcutEvent(e, focusModeKey)) {
        e.preventDefault();
        useViewSettingsStore.getState().toggleFocusMode();
        return;
      }

      // Typewriter mode
      const typewriterModeKey = shortcuts.getShortcut("typewriterMode");
      if (matchesShortcutEvent(e, typewriterModeKey)) {
        e.preventDefault();
        useViewSettingsStore.getState().toggleTypewriterMode();
        return;
      }

      // Word wrap
      const wordWrapKey = shortcuts.getShortcut("wordWrap");
      if (matchesShortcutEvent(e, wordWrapKey)) {
        e.preventDefault();
        useViewSettingsStore.getState().toggleWordWrap();
        return;
      }

      // Line numbers
      const lineNumbersKey = shortcuts.getShortcut("lineNumbers");
      if (matchesShortcutEvent(e, lineNumbersKey)) {
        e.preventDefault();
        useViewSettingsStore.getState().toggleLineNumbers();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
