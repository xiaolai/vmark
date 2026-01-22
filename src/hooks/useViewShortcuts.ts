/**
 * View Shortcuts Hook
 *
 * Handles keyboard shortcuts for view modes (configurable).
 * Menu accelerators don't always work reliably, so we listen directly.
 *
 * Respects shortcut scopes:
 * - "global" shortcuts work everywhere
 * - "editor" shortcuts (default) only work when terminal is not focused
 */

import { useEffect } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useShortcutsStore, type ShortcutScope } from "@/stores/shortcutsStore";
import { useTerminalStore } from "@/stores/terminalStore";
import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { matchesShortcutEvent } from "@/utils/shortcutMatch";
import { isTerminalFocused } from "@/utils/focus";

/**
 * Check if a shortcut should run based on its scope and current focus.
 * Global shortcuts always run; editor shortcuts only run when terminal is not focused.
 */
function shouldRunShortcut(scope: ShortcutScope | undefined): boolean {
  const terminalFocused = isTerminalFocused();
  // Global shortcuts work everywhere
  if (scope === "global") return true;
  // Editor shortcuts (default) only work when terminal is not focused
  return !terminalFocused;
}

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

      // Source mode (editor scope)
      const sourceModeKey = shortcuts.getShortcut("sourceMode");
      const sourceModeDef = shortcuts.getDefinition("sourceMode");
      if (matchesShortcutEvent(e, sourceModeKey) && shouldRunShortcut(sourceModeDef?.scope)) {
        e.preventDefault();
        // Close any open image paste toast (don't paste - user is switching modes)
        const toastStore = useImagePasteToastStore.getState();
        if (toastStore.isOpen) {
          toastStore.hideToast();
        }
        flushActiveWysiwygNow();
        useEditorStore.getState().toggleSourceMode();
        return;
      }

      // Focus mode (global scope)
      const focusModeKey = shortcuts.getShortcut("focusMode");
      const focusModeDef = shortcuts.getDefinition("focusMode");
      if (matchesShortcutEvent(e, focusModeKey) && shouldRunShortcut(focusModeDef?.scope)) {
        e.preventDefault();
        useEditorStore.getState().toggleFocusMode();
        return;
      }

      // Typewriter mode (global scope)
      const typewriterModeKey = shortcuts.getShortcut("typewriterMode");
      const typewriterModeDef = shortcuts.getDefinition("typewriterMode");
      if (matchesShortcutEvent(e, typewriterModeKey) && shouldRunShortcut(typewriterModeDef?.scope)) {
        e.preventDefault();
        useEditorStore.getState().toggleTypewriterMode();
        return;
      }

      // Word wrap (editor scope)
      const wordWrapKey = shortcuts.getShortcut("wordWrap");
      const wordWrapDef = shortcuts.getDefinition("wordWrap");
      if (matchesShortcutEvent(e, wordWrapKey) && shouldRunShortcut(wordWrapDef?.scope)) {
        e.preventDefault();
        useEditorStore.getState().toggleWordWrap();
        return;
      }

      // Line numbers (editor scope)
      const lineNumbersKey = shortcuts.getShortcut("lineNumbers");
      const lineNumbersDef = shortcuts.getDefinition("lineNumbers");
      if (matchesShortcutEvent(e, lineNumbersKey) && shouldRunShortcut(lineNumbersDef?.scope)) {
        e.preventDefault();
        useEditorStore.getState().toggleLineNumbers();
        return;
      }

      // Terminal toggle (global scope) - only when terminal feature is enabled
      const terminalEnabled = useSettingsStore.getState().advanced.terminalEnabled;
      if (terminalEnabled) {
        const terminalKey = shortcuts.getShortcut("toggleTerminal");
        const terminalDef = shortcuts.getDefinition("toggleTerminal");
        if (matchesShortcutEvent(e, terminalKey) && shouldRunShortcut(terminalDef?.scope)) {
          e.preventDefault();
          useTerminalStore.getState().toggle();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
