/**
 * View Shortcuts Hook
 *
 * Handles keyboard shortcuts for view modes (configurable).
 * Menu accelerators don't always work reliably, so we listen directly.
 */

import { useEffect } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { matchesShortcutEvent } from "@/utils/shortcutMatch";
import { cleanupBeforeModeSwitch } from "@/utils/modeSwitchCleanup";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import { toggleSourceModeWithCheckpoint } from "@/hooks/useUnifiedHistory";
import { requestToggleTerminal } from "@/components/Terminal/terminalGate";

export function useViewShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;

      const shortcuts = useShortcutsStore.getState();

      // Toggle terminal — must fire even from terminal's textarea
      const toggleTerminalKey = shortcuts.getShortcut("toggleTerminal");
      if (matchesShortcutEvent(e, toggleTerminalKey)) {
        e.preventDefault();
        requestToggleTerminal();
        return;
      }

      // Ignore if in input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        return;
      }

      // Source mode
      const sourceModeKey = shortcuts.getShortcut("sourceMode");
      if (matchesShortcutEvent(e, sourceModeKey)) {
        e.preventDefault();
        cleanupBeforeModeSwitch();
        toggleSourceModeWithCheckpoint(getCurrentWindowLabel());
        return;
      }

      // Focus mode
      const focusModeKey = shortcuts.getShortcut("focusMode");
      if (matchesShortcutEvent(e, focusModeKey)) {
        e.preventDefault();
        useEditorStore.getState().toggleFocusMode();
        return;
      }

      // Typewriter mode
      const typewriterModeKey = shortcuts.getShortcut("typewriterMode");
      if (matchesShortcutEvent(e, typewriterModeKey)) {
        e.preventDefault();
        useEditorStore.getState().toggleTypewriterMode();
        return;
      }

      // Word wrap
      const wordWrapKey = shortcuts.getShortcut("wordWrap");
      if (matchesShortcutEvent(e, wordWrapKey)) {
        e.preventDefault();
        useEditorStore.getState().toggleWordWrap();
        return;
      }

      // Line numbers
      const lineNumbersKey = shortcuts.getShortcut("lineNumbers");
      if (matchesShortcutEvent(e, lineNumbersKey)) {
        e.preventDefault();
        useEditorStore.getState().toggleLineNumbers();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
