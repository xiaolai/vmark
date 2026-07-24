/**
 * Keybinding definitions — the declarative bindings routed through the registry
 * (ADR-018). This set GROWS one migration slice at a time; each entry replaces a
 * bespoke `window` keydown hook. Every `command` binding's `commandId` must be a
 * registered CommandBus command (the invariant: keyboard enters via
 * `executeCommand`).
 *
 * @module services/keybinding/keybindingDefinitions
 */

import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { Binding, BindingContext } from "./bindingRegistry";

/** View shortcuts are suppressed while a plain INPUT/TEXTAREA is focused (they
 * fire in the editor — an editor focus yields an `editor-*` scope, not `input`).
 * Mirrors useViewShortcuts' INPUT/TEXTAREA guard. */
const notInInput = (ctx: BindingContext): boolean => !ctx.activeScopes.includes("input");

/** Build a global window-scope view binding (chord-exempt IME, no repeat). */
function viewBinding(
  shortcutId: string,
  commandId: string,
  opts: { suppressInInput: boolean },
): Binding {
  return {
    kind: "command",
    commandId,
    shortcutId,
    scope: "window",
    when: opts.suppressInInput ? notInInput : undefined,
    priority: 0,
    captureOwner: "window",
    repeat: "deny",
    // View shortcuts are command chords; exempt them from the keyCode-229 IME
    // false positive but honor a real composition (so terminal toggle works
    // under a CJK IME) — matches useViewShortcuts.shouldSkipKeyEvent.
    ime: "chord-exempt",
    consumption: "preventDefault",
  };
}

/**
 * View shortcut → command, verified 1:1 against the registered view/lint command
 * set. Terminal toggle fires everywhere (incl. inputs); all others are
 * input-suppressed. (Migrated from useViewShortcuts.)
 */
const VIEW_BINDINGS: Binding[] = [
  viewBinding("toggleTerminal", "view.toggleTerminal", { suppressInInput: false }),
  viewBinding("sourceMode", "view.toggleSourceMode", { suppressInInput: true }),
  viewBinding("focusMode", "view.toggleFocusMode", { suppressInInput: true }),
  viewBinding("typewriterMode", "view.toggleTypewriterMode", { suppressInInput: true }),
  viewBinding("wordWrap", "view.toggleWordWrap", { suppressInInput: true }),
  viewBinding("lineNumbers", "view.toggleLineNumbers", { suppressInInput: true }),
  viewBinding("readOnly", "view.toggleReadOnly", { suppressInInput: true }),
  viewBinding("fitTables", "view.toggleFitTables", { suppressInInput: true }),
  viewBinding("validateMarkdown", "lint.check", { suppressInInput: true }),
  viewBinding("lintNext", "lint.next", { suppressInInput: true }),
  viewBinding("lintPrev", "lint.prev", { suppressInInput: true }),
  viewBinding("toggleSidebar", "view.toggleSidebar", { suppressInInput: true }),
  viewBinding("toggleOutline", "view.toggleOutline", { suppressInInput: true }),
  viewBinding("fileExplorer", "view.toggleFileExplorer", { suppressInInput: true }),
  viewBinding("viewHistory", "view.toggleHistory", { suppressInInput: true }),
  viewBinding("knowledgeBase", "view.toggleKnowledgeBase", { suppressInInput: true }),
  viewBinding("markdownSplit", "view.toggleMarkdownSplit", { suppressInInput: true }),
  viewBinding("splitDocuments", "view.toggleSplitDocuments", { suppressInInput: true }),
];

/**
 * File-explorer shortcuts (migrated from useFileExplorerShortcuts): capture-phase
 * (to pre-empt), workspace-mode only, input-suppressed. IME-blocked.
 */
function explorerBinding(shortcutId: string, commandId: string): Binding {
  return {
    kind: "command",
    commandId,
    shortcutId,
    scope: "window",
    when: (ctx) => notInInput(ctx) && !!useWorkspaceStore.getState().rootPath,
    priority: 0,
    captureOwner: "window",
    windowPhase: "capture",
    repeat: "deny",
    ime: "block",
    consumption: "preventDefault",
  };
}

/** Build a global window-scope command binding (IME-blocked, no repeat). */
function globalBinding(shortcutId: string, commandId: string): Binding {
  return {
    kind: "command",
    commandId,
    shortcutId,
    scope: "window",
    priority: 0,
    captureOwner: "window",
    repeat: "deny",
    ime: "block",
    consumption: "preventDefault",
  };
}

export const KEYBINDINGS: readonly Binding[] = [
  // Global overlays (migrated from useCommandPaletteShortcut / useContentSearch /
  // useQuickOpenShortcuts). The router now mounts per document window, so these
  // work wherever their overlay renders (previously main-window-only). Menu
  // events route to the same commands via useCommandBootstrap.
  globalBinding("commandPalette", "app.commandPalette"),
  globalBinding("contentSearch", "view.contentSearch"),
  globalBinding("quickOpen", "app.quickOpen"),
  ...VIEW_BINDINGS,
  // File explorer (capture-phase, workspace-only).
  explorerBinding("toggleHiddenFiles", "explorer.toggleHiddenFiles"),
  explorerBinding("toggleAllFiles", "explorer.toggleAllFiles"),
];
