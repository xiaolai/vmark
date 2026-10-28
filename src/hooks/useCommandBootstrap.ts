/**
 * useCommandBootstrap — single menu-events bootstrap (T06).
 *
 * Replaces the six legacy `use*MenuEvents` hooks. Registers every
 * command surface once, then mounts a single Tauri menu-event
 * dispatcher that routes every `menu:*` event through CommandBus.
 *
 * Order contract:
 *   1. Sync registrations run first (`registerAllCommands`). A second call is
 *      safe but not a no-op: each non-editor batch is replace-own (it removes
 *      its owner's previous batch and installs the new one), and a registrar
 *      that throws part-way restores the bus to its pre-batch snapshot.
 *   2. The window-lifetime services start (`startRuntimeServices`, one disposer).
 *   3. The Pandoc-format expansion runs next, synchronously: the format list
 *      is a leaf module, so nothing — not the exporter chunk — is awaited
 *      before the menu listeners are requested.
 *   4. The combined binding list is mounted via mountMenuCommands, whose
 *      COMPLETENESS is then signalled to `menuCommandsReady` — the barrier the
 *      window-ready handshake waits on — only from a setup that is still live:
 *      a StrictMode-cancelled first pass must never trip it (pinned by test).
 *      A binding that cannot listen costs its own menu item and nothing else:
 *      the rest stay mounted, and readiness says `false` rather
 *      than announcing a menu that routes nowhere. A Pandoc expansion that
 *      failed counts the same way — its menu items exist and
 *      route to commands that were never registered.
 *
 * The effect is only that order and its teardown; each step and its disposer
 * live in `services/commands/commandBootstrap.ts`.
 *
 * @coordinates-with services/commands/commandBootstrap.ts — the steps and their disposers
 * @module hooks/useCommandBootstrap
 */

import { useEffect } from "react";
import type { MenuCommandBinding } from "@/services/commands/menuListener";
import { MENU_TO_ACTION } from "@/plugins/actions/actionRegistry";
import { registerAllCommands } from "@/services/commands/registerAllCommands";
import {
  mountMenuBridge,
  publishCommandDebugHandles,
  startRuntimeServicesOrRollback,
} from "@/services/commands/commandBootstrap";

const EXPORT_BINDINGS: MenuCommandBinding[] = [
  { menuEvent: "menu:export-html", commandId: "export.html" },
  { menuEvent: "menu:export-pdf", commandId: "export.pdf" },
  { menuEvent: "menu:export-pdf-native", commandId: "export.pdfNative" },
  { menuEvent: "menu:export-pandoc-hint", commandId: "export.pandocHint" },
  { menuEvent: "menu:copy-html", commandId: "export.copyHtml" },
];

const MISC_BINDINGS: MenuCommandBinding[] = [
  // #1354 — Windows-only menu items (macOS keeps PredefinedMenuItems, whose
  // responder-chain path never emits these ids). Bound unconditionally: an id
  // that never fires costs nothing, and the binding stays platform-symmetric.
  { menuEvent: "menu:edit-cut", commandId: "edit.cut" },
  { menuEvent: "menu:edit-copy", commandId: "edit.copy" },
  { menuEvent: "menu:edit-paste", commandId: "edit.paste" },
  { menuEvent: "menu:edit-select-all", commandId: "edit.selectAll" },
  { menuEvent: "menu:new", commandId: "file.new" },
  { menuEvent: "menu:open", commandId: "file.open" },
  { menuEvent: "menu:save", commandId: "file.save" },
  { menuEvent: "menu:save-as", commandId: "file.saveAs" },
  { menuEvent: "menu:move-to", commandId: "file.moveTo" },
  { menuEvent: "menu:quick-open", commandId: "app.quickOpen" },
  { menuEvent: "menu:new-browser-tab", commandId: "browser.newTab" },
  { menuEvent: "menu:reopen-closed-tab", commandId: "tab.reopenClosed" },
  // macOS Window menu: this id used to be emitted to nothing.
  { menuEvent: "menu:bring-all-to-front", commandId: "window.bringAllToFront" },
  { menuEvent: "menu:clear-history", commandId: "history.clearAll" },
  { menuEvent: "menu:clear-workspace-history", commandId: "history.clearWorkspace" },
  { menuEvent: "menu:export-journal-git", commandId: "history.exportToGit" },
  { menuEvent: "menu:cleanup-images", commandId: "image.cleanupOrphans" },
  { menuEvent: "menu:vmark-help", commandId: "help.vmarkHelp" },
  { menuEvent: "menu:keyboard-shortcuts", commandId: "help.keyboardShortcuts" },
  { menuEvent: "menu:report-issue", commandId: "help.reportIssue" },
  { menuEvent: "menu:open-genies-folder", commandId: "genies.openFolder" },
  { menuEvent: "menu:search-genies", commandId: "genies.openPicker" },
];

const RECENT_FILES_BINDINGS: MenuCommandBinding[] = [
  { menuEvent: "menu:clear-recent", commandId: "file.clearRecent" },
  { menuEvent: "menu:open-recent-file", commandId: "file.openRecent" },
];

const RECENT_WORKSPACES_BINDINGS: MenuCommandBinding[] = [
  { menuEvent: "menu:clear-recent-workspaces", commandId: "workspace.clearRecent" },
  { menuEvent: "menu:open-recent-workspace", commandId: "workspace.openRecent" },
];

const VIEW_BINDINGS: MenuCommandBinding[] = [
  { menuEvent: "menu:find-in-files", commandId: "view.contentSearch" },
  { menuEvent: "menu:last-used-tab", commandId: "tab.lastUsed" },
  { menuEvent: "menu:split-documents", commandId: "view.toggleSplitDocuments" },
  { menuEvent: "menu:close-pane", commandId: "view.closePane" },
  { menuEvent: "menu:focus-other-pane", commandId: "view.focusOtherPane" },
  { menuEvent: "menu:sync-pane-scroll", commandId: "view.toggleSyncScroll" },
  { menuEvent: "menu:wysiwyg-mode", commandId: "view.setWysiwygMode" },
  { menuEvent: "menu:source-mode", commandId: "view.toggleSourceMode" },
  { menuEvent: "menu:markdown-split", commandId: "view.toggleMarkdownSplit" },
  { menuEvent: "menu:focus-mode", commandId: "view.toggleFocusMode" },
  { menuEvent: "menu:typewriter-mode", commandId: "view.toggleTypewriterMode" },
  { menuEvent: "menu:outline", commandId: "view.toggleOutline" },
  { menuEvent: "menu:file-explorer", commandId: "view.toggleFileExplorer" },
  { menuEvent: "menu:view-history", commandId: "view.toggleHistory" },
  { menuEvent: "menu:knowledge-base", commandId: "view.toggleKnowledgeBase" },
  { menuEvent: "menu:window-status", commandId: "view.toggleWindowStatus" },
  { menuEvent: "menu:breakdown", commandId: "view.toggleBreakdown" },
  { menuEvent: "menu:word-wrap", commandId: "view.toggleWordWrap" },
  { menuEvent: "menu:line-numbers", commandId: "view.toggleLineNumbers" },
  { menuEvent: "menu:universal-toolbar", commandId: "view.toggleUniversalToolbar" },
  { menuEvent: "menu:diagram-preview", commandId: "view.toggleDiagramPreview" },
  { menuEvent: "menu:fit-tables", commandId: "view.toggleFitTables" },
  { menuEvent: "menu:read-only", commandId: "view.toggleReadOnly" },
  { menuEvent: "menu:show-invisibles", commandId: "view.toggleShowInvisibles" },
  { menuEvent: "menu:toggle-terminal", commandId: "view.toggleTerminal" },
  { menuEvent: "menu:zoom-actual", commandId: "view.zoomActual" },
  { menuEvent: "menu:zoom-in", commandId: "view.zoomIn" },
  { menuEvent: "menu:zoom-out", commandId: "view.zoomOut" },
  { menuEvent: "menu:check-markdown", commandId: "lint.check" },
  { menuEvent: "menu:lint-next", commandId: "lint.next" },
  { menuEvent: "menu:lint-prev", commandId: "lint.prev" },
];

const WORKSPACE_BINDINGS: MenuCommandBinding[] = [
  { menuEvent: "menu:open-folder", commandId: "workspace.openFolder" },
  { menuEvent: "menu:close-workspace", commandId: "workspace.close" },
];

// Editor formatting/CJK/line-op menu events (86) — dispatched through the editor
// executor (runEditorAction), NOT executeCommand. Folded in from the former
// useUnifiedMenuCommands hook so ONE dispatcher owns the whole menu:{id} space
// with a single mount-time duplicate-rejection pass.
const EDITOR_ACTION_BINDINGS: MenuCommandBinding[] = Object.entries(MENU_TO_ACTION).map(
  ([menuEvent, mapping]) => ({ kind: "editorAction", menuEvent, mapping }),
);

/**
 * Every menu binding except the per-format Pandoc ones, which
 * `registerPandocFormatCommands` returns.
 *
 * Exported so a test can assert the property `mountMenuCommands`' preflight now
 * DEPENDS on: each command binding must name a command
 * `registerAllCommands` registers. An unresolvable one is dropped from the
 * mount and makes readiness report `false`, which is right — and would be
 * silent without an assertion that it never happens.
 */
export const STATIC_MENU_BINDINGS: readonly MenuCommandBinding[] = [
  ...MISC_BINDINGS,
  ...EXPORT_BINDINGS,
  ...WORKSPACE_BINDINGS,
  ...RECENT_FILES_BINDINGS,
  ...RECENT_WORKSPACES_BINDINGS,
  ...VIEW_BINDINGS,
  ...EDITOR_ACTION_BINDINGS,
];

export function useCommandBootstrap(): void {
  useEffect(() => {
    const disposeEditorCommands = registerAllCommands();
    publishCommandDebugHandles();
    const stopRuntimeServices = startRuntimeServicesOrRollback(disposeEditorCommands);
    const unmountMenu = mountMenuBridge(STATIC_MENU_BINDINGS);
    return () => {
      unmountMenu();
      disposeEditorCommands();
      stopRuntimeServices();
    };
  }, []);
}
