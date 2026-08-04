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
import { canonicalizeChordString } from "@/utils/keybinding/canonicalChord";
import type { Binding, BindingContext, Scope } from "./bindingRegistry";

/** Scopes where a text caret lives — Mod+A there is the editor's own select-all. */
const TEXT_EDITABLE_SCOPES = new Set<Scope>([
  "editor-wysiwyg",
  "editor-source",
  "input",
  "terminal",
]);
const notTextEditable = (ctx: BindingContext): boolean =>
  !ctx.activeScopes.some((s) => TEXT_EDITABLE_SCOPES.has(s));

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
    // No `when` at all for an unconditional binding — the dispatcher treats
    // the key's absence as "always applies", which is not the same claim as
    // "there is a predicate and it is nothing".
    ...(opts.suppressInInput ? { when: notInInput } : {}),
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

/**
 * Build a NATIVE-owned binding (WI-5.2). Identical to a global binding but with
 * `captureOwner: "native-menu"`, so the window DOM router (which resolves only
 * `captureOwner: "window"`) never executes it — the native menu accelerator is
 * the sole owner. Used for chords that MUST be native: while the embedded
 * WKWebView browser holds first responder, `window.keydown` never fires, so a
 * DOM binding would be dead there; and AppKit dispatches the menu accelerator
 * regardless of focus, so a DOM binding elsewhere would double-fire it. The
 * binding still enters the index (referential integrity + conflict detection);
 * it is simply not the window adapter's to execute.
 */
function nativeMenuBinding(shortcutId: string, commandId: string): Binding {
  return { ...globalBinding(shortcutId, commandId), captureOwner: "native-menu" };
}

export const KEYBINDINGS: readonly Binding[] = [
  // Global overlays (migrated from useCommandPaletteShortcut / useContentSearch /
  // useQuickOpenShortcuts). The router now mounts per document window, so these
  // work wherever their overlay renders (previously main-window-only). Menu
  // events route to the same commands via useCommandBootstrap.
  globalBinding("commandPalette", "app.commandPalette"),
  globalBinding("contentSearch", "view.contentSearch"),
  globalBinding("quickOpen", "app.quickOpen"),
  // Tabs + status bar (migrated from useTabShortcuts). closeFile is the Mod+W
  // "Close" shortcut (the only Mod-w definition) — now a real rebindable binding
  // driving tab.close (WI-3.3).
  globalBinding("newTab", "tab.new"),
  // newBrowserTab is NATIVE-owned (WI-5.2): the native menu accelerator is the sole
  // owner so the chord isn't double-delivered (DOM + native) in a document window,
  // and still works while the WKWebView browser holds keyboard focus.
  nativeMenuBinding("newBrowserTab", "browser.newTab"),
  globalBinding("nextTab", "tab.next"),
  globalBinding("prevTab", "tab.prev"),
  globalBinding("closeFile", "tab.close"),
  globalBinding("toggleStatusBar", "view.toggleStatusBar"),
  // Save / Save As (migrated from useFileShortcuts). On the window listener
  // because menu accelerators are unreliable while Tiptap has focus; the menu
  // events route to the same commands via useCommandBootstrap.
  globalBinding("save", "file.save"),
  globalBinding("saveAs", "file.saveAs"),
  // AI genie picker (migrated from useGenieShortcuts' Cmd+Y keydown). Toggles
  // the per-window picker; the "Search Genies…" menu event routes to the
  // sibling genies.openPicker command via useCommandBootstrap.
  globalBinding("aiPrompts", "genies.togglePicker"),
  ...VIEW_BINDINGS,
  // File explorer (capture-phase, workspace-only).
  explorerBinding("toggleHiddenFiles", "explorer.toggleHiddenFiles"),
  explorerBinding("toggleAllFiles", "explorer.toggleAllFiles"),
  // Select-all containment (migrated from useSelectAllScope): capture-phase
  // browser-default guard. When focus is NOT text-editable, block the browser's
  // page-wide Cmd/Ctrl+A; when it IS (editor/input/terminal), do nothing so the
  // editor's own select-all runs. No command, no stopPropagation. `fixedChord`
  // (not a rebindable shortcut) — canonicalized for the host platform.
  {
    kind: "containment",
    fixedChord: canonicalizeChordString("Mod-a") ?? "meta+KeyA",
    scope: "window",
    when: notTextEditable,
    priority: 0,
    captureOwner: "window",
    windowPhase: "capture",
    repeat: "allow",
    ime: "chord-exempt",
    consumption: "preventDefault",
  },
];
