/**
 * useCommandBootstrap — single menu-events bootstrap (T06).
 *
 * Replaces the six legacy `use*MenuEvents` hooks. Registers every
 * command surface once, then mounts a single Tauri menu-event
 * dispatcher that routes every `menu:*` event through CommandBus.
 *
 * Order contract:
 *   1. Sync registrations run first (idempotent — each register* is
 *      a no-op on the second call).
 *   2. Async Pandoc-format expansion runs next; the format list is
 *      not known until pandocExport.ts dynamically loads.
 *   3. The combined binding list is mounted via mountMenuCommands, which
 *      then signals `menuCommandsReady` — the barrier the window-ready
 *      handshake waits on.
 *
 * @module services/commands/useCommandBootstrap
 */

import { useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { menuError, appError } from "@/utils/debug";
import { mountMenuCommands, type MenuCommandBinding } from "@/services/commands/menuListener";
import { MENU_TO_ACTION } from "@/plugins/actions/actionRegistry";
import { registerExportCommands, registerPandocFormatCommands } from "@/services/commands/exportCommands";
import { registerMiscCommands } from "@/services/commands/miscCommands";
import { registerClipboardCommands } from "@/services/commands/clipboardCommands";
import { registerRecentFilesCommands } from "@/services/commands/recentFilesCommands";
import { registerRecentWorkspacesCommands } from "@/services/commands/recentWorkspacesCommands";
import { registerClaimCommands } from "@/services/commands/claimCommands";
import { registerViewCommands } from "@/services/commands/viewCommands";
import { registerWorkspaceCommands } from "@/services/commands/workspaceCommands";
import { registerFormatCommands } from "@/services/commands/formatCommands";
import { registerBrowserCommands } from "@/services/commands/browserCommands";
import { registerEditorCommands } from "@/services/commands/editorCommandBridge";
import { registerTabCommands } from "@/services/commands/tabCommands";
import { registerFileCommands } from "@/services/commands/fileCommands";
import { registerGenieCommands } from "@/services/commands/genieCommands";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";
import { startGrantSync } from "@/services/browser/grantSync";
import { browserAvailableHere } from "@/services/commands/browserCommands";
import { startBrowserLeaseWiring } from "@/services/browser/browserLeaseWiring";
import { startBrowserTabEvents } from "@/services/browser/browserTabEvents";
import { closeBrowserTabById, startBrowserTabLifecycle } from "@/services/browser/browserTabLifecycle";
import { startRecorderWiring } from "@/services/browser/recorderWiring";
import { startCoherenceScanOnChange } from "@/services/coherence/scanOnChange";
import { startWindowWorkspaceSync } from "@/services/mcpBridge/windowWorkspaceSync";
import { startBrowserAiPolicySync } from "@/services/browser/browserAiPolicySync";
import { startWorkflowEnginePolicySync } from "@/services/workflow/workflowEnginePolicySync";
import { publishDebugHandle } from "@/utils/devDebugHandle";
import { executeCommand } from "@/services/commands/CommandBus";
import { signalMenuCommandsMounted } from "@/services/commands/menuCommandsReady";

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
  { menuEvent: "menu:save-all-quit", commandId: "file.saveAllQuit" },
  { menuEvent: "menu:quick-open", commandId: "app.quickOpen" },
  { menuEvent: "menu:new-browser-tab", commandId: "browser.newTab" },
  { menuEvent: "menu:preferences", commandId: "app.preferences" },
  { menuEvent: "menu:clear-history", commandId: "history.clearAll" },
  { menuEvent: "menu:clear-workspace-history", commandId: "history.clearWorkspace" },
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
// with a single mount-time duplicate-rejection pass (Phase 2, WI-2.2).
const EDITOR_ACTION_BINDINGS: MenuCommandBinding[] = Object.entries(MENU_TO_ACTION).map(
  ([menuEvent, mapping]) => ({ kind: "editorAction", menuEvent, mapping }),
);

export function useCommandBootstrap(): void {
  useEffect(() => {
    registerMiscCommands();
    registerClipboardCommands();
    registerExportCommands();
    registerWorkspaceCommands();
    registerRecentFilesCommands();
    registerRecentWorkspacesCommands();
    registerViewCommands();
    registerClaimCommands();
    registerFormatCommands();
    registerBrowserCommands();
    registerTabCommands();
    registerFileCommands();
    registerGenieCommands();
    // Lift every editor ActionId into the bus so the palette can find them
    // (WI-3.4). Owner-based batch registration is HMR-safe (replace-own).
    const disposeEditorCommands = registerEditorCommands();

    // DEV-only harness seam (WI-4.0). The E2E journeys have no other way to
    // invoke a command: the debug bridge offers only execute_js, a Tauri event
    // emitted inside the webview never reaches the app's own listeners (verified
    // with a non-browser control event), and synthetic key events do not reach
    // the keybinding layer. Publishing `executeCommand` — the SAME function the
    // menu route calls (menuListener.ts) — means a journey exercises the real
    // dispatch path rather than a test-only shortcut past it.
    //
    // Compiled out of production: `publishDebugHandle` is DEV-gated, so this
    // cannot become a way for page script in the app webview to run commands.
    publishDebugHandle(
      "runCommand",
      (commandId: string, payload?: unknown, windowLabel?: string) =>
        executeCommand(commandId, payload, { windowLabel: windowLabel ?? "main" }),
    );
    // Same seam, for teardown: the harness closes the tabs it created through the
    // app's own lifecycle instead of tearing the native view out from under it.
    publishDebugHandle("closeBrowserTab", closeBrowserTabById);

    // Mirror the user's standing browser grants into the Rust driver, which is the
    // authoritative gate for R4/R5/R7a (WI-2.1). Without this the driver stays
    // default-deny — safe, but the user's approvals would never take effect.
    const stopGrantSync = startGrantSync();
    // Lease event sources (WI-NB5.1): native page input reclaims an AI-held
    // tab; tab close drops lease state.
    const stopLeaseWiring = startBrowserLeaseWiring();
    // Native views stay alive while their tab exists (audit 2026-09-03 L-01): one
    // window-level consumer keeps every tab's mirror honest, and the removal bus
    // is what finally destroys a view.
    const stopBrowserTabEvents = startBrowserTabEvents();
    const stopBrowserTabLifecycle = startBrowserTabLifecycle();
    // Recorder event sources (WI-NB7.1): a navigation re-arms the capture shim in
    // the new document; tab close discards the recording.
    const stopRecorderWiring = startRecorderWiring();
    const stopCoherenceScan = startCoherenceScanOnChange();
    const stopWindowWorkspaceSync = startWindowWorkspaceSync();
    const stopBrowserAiPolicySync = startBrowserAiPolicySync();
    // The Rust workflow runner starts fail-closed; without this push it refuses
    // every command even for a user who has the engine switched on (WI-19).
    const stopWorkflowEnginePolicySync = startWorkflowEnginePolicySync();

    // Keep the native "New Browser Tab" menu item in step with the setting (WI-S0.5).
    // The item exists natively so its accelerator survives the browser taking keyboard
    // focus; it starts disabled because the feature is off by default, and a
    // permanently-dead menu item is worse than no item.
    const pushBrowserMenuEnabled = (enabled: boolean) => {
      void invoke("set_browser_menu_enabled", { enabled }).catch(() => {
        // The menu may not exist yet (early boot) or on a platform branch without the
        // item. Not worth surfacing: the command still works from the palette.
      });
    };
    // Setting AND platform: off macOS the surface is a stub, and an enabled menu item
    // there is the permanently-dead item the Rust side warns about (audit X-04).
    pushBrowserMenuEnabled(browserAvailableHere());
    const stopBrowserMenuSync = useSettingsStore.subscribe((state, prev) => {
      if (state.browser.enabled !== prev.browser.enabled) {
        pushBrowserMenuEnabled(browserAvailableHere());
      }
    });

    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    void (async () => {
      const bindings: MenuCommandBinding[] = [
        ...MISC_BINDINGS,
        ...EXPORT_BINDINGS,
        ...WORKSPACE_BINDINGS,
        ...RECENT_FILES_BINDINGS,
        ...RECENT_WORKSPACES_BINDINGS,
        ...VIEW_BINDINGS,
        ...EDITOR_ACTION_BINDINGS,
      ];

      try {
        const formats = await registerPandocFormatCommands();
        for (const fmt of formats) {
          bindings.push({
            menuEvent: `menu:export-pandoc-${fmt}`,
            commandId: `export.pandoc-${fmt}`,
          });
        }
      } catch (err) {
        menuError("Failed to expand Pandoc menu bindings:", err);
      }

      // mountMenuCommands wires the Tauri menu→command bridge. A rejection
      // here is critical: every native menu item, accelerator, and palette
      // entry stops routing. Without this catch the rejection becomes an
      // unhandled-promise warning and the user sees no error — just
      // silently dead menus. (Audit finding H6.)
      try {
        const off = await mountMenuCommands(bindings);
        if (cancelled) {
          off();
          return;
        }
        unlisten = off;
      } catch (err) {
        menuError("Failed to mount menu commands:", err);
      } finally {
        // The window-ready handshake waits on this instead of guessing how
        // long the `await` above takes — it is a dynamic import, so no
        // constant could bound it. Signalled in a `finally` because a mount
        // that THREW will never become mounted: hanging the handshake on it
        // would turn dead menus into a window that never reports ready at all.
        signalMenuCommandsMounted();
      }
    })().catch((err) => appError("Command bootstrap failed:", err));

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      disposeEditorCommands();
      stopGrantSync();
      stopLeaseWiring();
      stopBrowserTabEvents();
      stopBrowserTabLifecycle();
      stopRecorderWiring();
      stopCoherenceScan();
      stopWindowWorkspaceSync();
      stopBrowserAiPolicySync();
      stopWorkflowEnginePolicySync();
      stopBrowserMenuSync();
    };
  }, []);
}
