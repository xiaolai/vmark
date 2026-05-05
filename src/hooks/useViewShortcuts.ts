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
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { matchesShortcutEvent, isMacPlatform } from "@/utils/shortcutMatch";
import { cleanupBeforeModeSwitch } from "@/utils/modeSwitchCleanup";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import { toggleSourceModeWithCheckpoint } from "@/hooks/useUnifiedHistory";
import { requestToggleTerminal } from "@/components/Terminal/terminalGate";
import { useSettingsStore } from "@/stores/settingsStore";
import { useLintStore } from "@/stores/lintStore";
import { getActiveDocument, getActiveTabId } from "@/utils/activeDocument";
import { imeToast as toast } from "@/utils/imeToast";
import i18n from "@/i18n";
import { triggerLintRefresh } from "@/plugins/codemirror/sourceLint";
import { isYamlFileName } from "@/utils/dropPaths";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { useTiptapEditorStore } from "@/stores/tiptapEditorStore";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import { scrollToSelectedDiagnostic } from "@/hooks/lintNavigation";

// ---------------------------------------------------------------------------
// Pure functions — exported for testing, no DOM or store access
// ---------------------------------------------------------------------------

/** Return true if the event should be skipped entirely (IME composition). */
export function shouldSkipKeyEvent(event: KeyboardEvent): boolean {
  return isImeKeyEvent(event);
}

/** View action identifiers returned by resolveViewAction. */
export type ViewAction =
  | "toggleTerminal"
  | "sourceMode"
  | "focusMode"
  | "typewriterMode"
  | "wordWrap"
  | "lineNumbers"
  | "readOnly"
  | "fitTables"
  | "validateMarkdown"
  | "lintNext"
  | "lintPrev"
  | "toggleOutline"
  | "fileExplorer"
  | "viewHistory";

/**
 * Resolve a keyboard event to a view action identifier. Pure — no DOM mutation or store access.
 * Returns null if the event does not match any view shortcut.
 */
export function resolveViewAction(
  event: KeyboardEvent,
  shortcuts: Record<string, string>,
  platform: "mac" | "other" = isMacPlatform() ? "mac" : "other"
): ViewAction | null {
  // Terminal toggle fires even from textarea
  if (shortcuts.toggleTerminal && matchesShortcutEvent(event, shortcuts.toggleTerminal, platform)) {
    return "toggleTerminal";
  }

  // All other shortcuts are suppressed when in input/textarea
  const target = event.target as HTMLElement;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
    return null;
  }

  // Ordered shortcut-to-action map (order matters for early return)
  const actionMap: Array<[string, ViewAction]> = [
    ["sourceMode", "sourceMode"],
    ["focusMode", "focusMode"],
    ["typewriterMode", "typewriterMode"],
    ["wordWrap", "wordWrap"],
    ["lineNumbers", "lineNumbers"],
    ["readOnly", "readOnly"],
    ["fitTables", "fitTables"],
    ["validateMarkdown", "validateMarkdown"],
    ["lintNext", "lintNext"],
    ["lintPrev", "lintPrev"],
    ["toggleOutline", "toggleOutline"],
    ["fileExplorer", "fileExplorer"],
    ["viewHistory", "viewHistory"],
  ];

  for (const [key, action] of actionMap) {
    const binding = shortcuts[key];
    if (binding && matchesShortcutEvent(event, binding, platform)) {
      return action;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Hook that handles keyboard shortcuts for view-mode toggles (source, focus, typewriter, wrap, line numbers, terminal, sidebar panels). */
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

      // Read-only mode
      const readOnlyKey = shortcuts.getShortcut("readOnly");
      if (readOnlyKey && matchesShortcutEvent(e, readOnlyKey)) {
        e.preventDefault();
        const tabId = getActiveTabId(getCurrentWindowLabel());
        if (tabId) useDocumentStore.getState().toggleReadOnly(tabId);
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

      // Validate markdown (run lint)
      const validateMarkdownKey = shortcuts.getShortcut("validateMarkdown");
      if (validateMarkdownKey && matchesShortcutEvent(e, validateMarkdownKey)) {
        e.preventDefault();
        const lintEnabled = useSettingsStore.getState().markdown.lintEnabled;
        if (!lintEnabled) return;
        const windowLabel = getCurrentWindowLabel();
        const tabId = getActiveTabId(windowLabel);
        if (!tabId) return;

        // Prefer fresh content from the active editor over potentially stale doc store.
        // In Source mode: read from CM view. In WYSIWYG mode: serialize Tiptap content.
        let content: string | undefined;
        const editorStoreState = useEditorStore.getState();
        const { activeSourceView } = useActiveEditorStore.getState();

        if (editorStoreState.sourceMode && activeSourceView) {
          // Source mode — read directly from CM document
          content = activeSourceView.state.doc.toString();
        } else {
          // WYSIWYG mode — serialize Tiptap editor to markdown
          const tiptapEditor = useTiptapEditorStore.getState().editor;
          if (tiptapEditor) {
            content = serializeMarkdown(tiptapEditor.state.schema, tiptapEditor.state.doc);
          }
        }

        // Fall back to persisted doc content if live content unavailable
        if (content === undefined) {
          const doc = getActiveDocument(windowLabel);
          content = doc?.content;
        }

        if (content !== undefined) {
          const filePath = getActiveDocument(windowLabel)?.filePath ?? null;
          const isYaml = filePath
            ? isYamlFileName(filePath.split(/[\\/]/).pop() ?? "")
            : false;
          const finalize = (totalCount: number) => {
            triggerLintRefresh();
            if (totalCount === 0) {
              toast.success(i18n.t("statusbar:lint.clean.toast"));
            } else {
              toast.info(
                i18n.t("dialog:toast.lintFoundIssues", { count: totalCount }),
              );
            }
          };
          if (isYaml) {
            // Codex audit MED-3 close-out: YAML files now run their
            // own lint pipeline and write to lintStore. Same toast,
            // same badge, same F2 navigation as markdown.
            const yamlDiags = useLintStore
              .getState()
              .runYamlLint(tabId, content);
            finalize(yamlDiags.length);
          } else {
            const syncDiagnostics = useLintStore
              .getState()
              .runLint(tabId, content);
            triggerLintRefresh();
            // Codex audit MED-4: toast reflects the COMBINED
            // (sync + async link-check) result.
            if (filePath) {
              void useLintStore
                .getState()
                .runLinkCheck(tabId, content, filePath)
                .then((merged) => finalize(merged.length));
            } else {
              finalize(syncDiagnostics.length);
            }
          }
        }
        return;
      }

      // Navigate to next lint issue
      const lintNextKey = shortcuts.getShortcut("lintNext");
      if (lintNextKey && matchesShortcutEvent(e, lintNextKey)) {
        e.preventDefault();
        const windowLabel = getCurrentWindowLabel();
        const tabId = getActiveTabId(windowLabel);
        if (tabId) {
          useLintStore.getState().selectNext(tabId);
          scrollToSelectedDiagnostic(tabId);
        }
        return;
      }

      // Navigate to previous lint issue
      const lintPrevKey = shortcuts.getShortcut("lintPrev");
      if (lintPrevKey && matchesShortcutEvent(e, lintPrevKey)) {
        e.preventDefault();
        const windowLabel = getCurrentWindowLabel();
        const tabId = getActiveTabId(windowLabel);
        if (tabId) {
          useLintStore.getState().selectPrev(tabId);
          scrollToSelectedDiagnostic(tabId);
        }
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
