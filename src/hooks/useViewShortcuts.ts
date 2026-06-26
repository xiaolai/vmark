/**
 * View Shortcuts Hook
 *
 * Purpose: Keyboard shortcut handler for view-mode toggles — source mode,
 *   focus mode, typewriter mode, word wrap, line numbers, terminal, sidebar
 *   panels, and the Knowledge Base panel.
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
 * @coordinates-with contentServerStore.ts — toggles the Knowledge Base panel
 * @module hooks/useViewShortcuts
 */

import { useEffect } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useContentServerStore } from "@/stores/contentServerStore";
import { useShortcutsStore } from "@/stores/settingsStore";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { matchesShortcutEvent, isMacPlatform } from "@/utils/shortcutMatch";
import { cleanupBeforeModeSwitch } from "@/services/assembly/modeSwitchCleanup";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { toggleSourceModeWithCheckpoint } from "@/hooks/useUnifiedHistory";
import { requestToggleTerminal } from "@/components/Terminal/terminalGate";
import { toggleDocumentReadOnlyWithOwnership } from "@/services/workspaces/fileOwnership";
import { useSettingsStore } from "@/stores/settingsStore";
import { useLintStore } from "@/stores/documentStore";
import { getActiveTabId } from "@/services/navigation/activeDocument";
import { scrollToSelectedDiagnostic } from "@/hooks/lintNavigation";
import { runActiveLint } from "@/services/lint/runActiveLint";

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
  | "viewHistory"
  | "knowledgeBase";

/** All shortcut ids the view-shortcut resolver/executors consult. */
const VIEW_SHORTCUT_IDS: ViewAction[] = [
  "toggleTerminal",
  "sourceMode",
  "focusMode",
  "typewriterMode",
  "wordWrap",
  "lineNumbers",
  "readOnly",
  "fitTables",
  "validateMarkdown",
  "lintNext",
  "lintPrev",
  "toggleOutline",
  "fileExplorer",
  "viewHistory",
  "knowledgeBase",
];

/** Build the action-id → binding map resolveViewAction expects from the store. */
function collectViewShortcuts(
  getShortcut: (id: string) => string,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const id of VIEW_SHORTCUT_IDS) {
    map[id] = getShortcut(id);
  }
  return map;
}

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
    ["knowledgeBase", "knowledgeBase"],
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
// Action executors — keyed by ViewAction so handleKeyDown stays a thin
// resolve-then-dispatch loop instead of a 200-line if-chain. Each executor owns
// the side effect for one action; resolveViewAction owns the matching rules.
// ---------------------------------------------------------------------------

/** Read the freshest content for the active tab (live editor first, doc store fallback). */
/**
 * Run lint/validation on the active document and toast the combined result.
 * Delegates to the shared lint command service so the keyboard-shortcut path
 * and the `lint.check` command bus path can't drift.
 */
function executeValidateMarkdown(): void {
  runActiveLint(getCurrentWindowLabel());
}

function executeLintNav(direction: "next" | "prev"): void {
  const tabId = getActiveTabId(getCurrentWindowLabel());
  if (!tabId) return;
  const lint = useLintStore.getState();
  if (direction === "next") lint.selectNext(tabId);
  else lint.selectPrev(tabId);
  scrollToSelectedDiagnostic(tabId);
}

/** Side-effect executors for each resolved view action. */
const VIEW_ACTION_EXECUTORS: Record<ViewAction, () => void> = {
  toggleTerminal: () => requestToggleTerminal(),
  sourceMode: () => {
    cleanupBeforeModeSwitch();
    toggleSourceModeWithCheckpoint(getCurrentWindowLabel());
  },
  focusMode: () => useUIStore.getState().toggleFocusMode(),
  typewriterMode: () => useUIStore.getState().toggleTypewriterMode(),
  wordWrap: () => useUIStore.getState().toggleWordWrap(),
  lineNumbers: () => useUIStore.getState().toggleLineNumbers(),
  readOnly: () => {
    const tabId = getActiveTabId(getCurrentWindowLabel());
    if (tabId) toggleDocumentReadOnlyWithOwnership(tabId);
  },
  fitTables: () => {
    const current = useSettingsStore.getState().markdown.tableFitToWidth;
    useSettingsStore.getState().updateMarkdownSetting("tableFitToWidth", !current);
  },
  validateMarkdown: executeValidateMarkdown,
  lintNext: () => executeLintNav("next"),
  lintPrev: () => executeLintNav("prev"),
  toggleOutline: () => useUIStore.getState().toggleSidebarView("outline"),
  fileExplorer: () => useUIStore.getState().toggleSidebarView("files"),
  viewHistory: () => useUIStore.getState().toggleSidebarView("history"),
  knowledgeBase: () => useContentServerStore.getState().togglePanel(),
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Hook that handles keyboard shortcuts for view-mode toggles (source, focus, typewriter, wrap, line numbers, terminal, sidebar panels). */
export function useViewShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;

      // Single source of truth: resolveViewAction owns the matching rules
      // (terminal-first, input/textarea suppression, ordered fall-through).
      const shortcuts = collectViewShortcuts(useShortcutsStore.getState().getShortcut);
      const action = resolveViewAction(e, shortcuts);
      if (!action) return;

      e.preventDefault();
      VIEW_ACTION_EXECUTORS[action]();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
