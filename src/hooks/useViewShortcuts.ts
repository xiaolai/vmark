/**
 * View Shortcuts Hook
 *
 * Purpose: Keyboard shortcut handler for view-mode toggles — source mode,
 *   focus mode, typewriter mode, word wrap, line numbers, and terminal.
 *
 * Key decisions:
 *   - Listens directly on keydown because menu accelerators aren't always
 *     reliable (e.g., when editor has focus and intercepts keys)
 *   - IME events filtered out via isImeKeyEvent to avoid false triggers
 *   - Uses matchesShortcutEvent for configurable shortcut matching
 *   - Source mode toggle creates a history checkpoint for undo across modes
 *
 * @coordinates-with shortcutsStore.ts — reads configurable shortcut bindings
 * @coordinates-with editorStore.ts — toggles sourceMode, focusMode, etc.
 * @module hooks/useViewShortcuts
 */

import { useEffect } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { matchesShortcutEvent } from "@/utils/shortcutMatch";
import { cleanupBeforeModeSwitch } from "@/utils/modeSwitchCleanup";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import { toggleSourceModeWithCheckpoint } from "@/hooks/useUnifiedHistory";
import { requestToggleTerminal } from "@/components/Terminal/terminalGate";
import { useSettingsStore } from "@/stores/settingsStore";

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

      // Fit tables to width
      const fitTablesKey = shortcuts.getShortcut("fitTables");
      if (fitTablesKey && matchesShortcutEvent(e, fitTablesKey)) {
        e.preventDefault();
        const current = useSettingsStore.getState().markdown.tableFitToWidth;
        useSettingsStore.getState().updateMarkdownSetting("tableFitToWidth", !current);
        return;
      }

      // Sidebar panel toggles
      const toggleOutlineKey = shortcuts.getShortcut("toggleOutline");
      if (matchesShortcutEvent(e, toggleOutlineKey)) {
        e.preventDefault();
        useUIStore.getState().toggleSidebarView("outline");
        return;
      }

      const fileExplorerKey = shortcuts.getShortcut("fileExplorer");
      if (matchesShortcutEvent(e, fileExplorerKey)) {
        e.preventDefault();
        useUIStore.getState().toggleSidebarView("files");
        return;
      }

      const viewHistoryKey = shortcuts.getShortcut("viewHistory");
      if (matchesShortcutEvent(e, viewHistoryKey)) {
        e.preventDefault();
        useUIStore.getState().toggleSidebarView("history");
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
