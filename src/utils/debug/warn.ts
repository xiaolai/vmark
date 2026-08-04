/**
 * Debug *Warn loggers — production-persistent warnings.
 *
 * In dev, routes to `console.warn`. In production, also forwards the message
 * to `@tauri-apps/plugin-log` so users can attach log files to bug reports.
 *
 * Every logger is one `createWarnLogger(tag)` call — the dev/prod branching
 * lives once inside `prodWarn` (see ./internals), not copy-pasted per logger.
 *
 * @module utils/debug/warn
 */

import { createWarnLogger } from "./internals";

/** Warn logger for Hot Exit operations. */
export const hotExitWarn = createWarnLogger("[HotExit]");

/** Warn logger for File Operations. */
export const fileOpsWarn = createWarnLogger("[FileOps]");

/** Warn logger for Large File open routing. */
export const largeFileWarn = createWarnLogger("[LargeFile]");

/** Warn logger for AI Provider operations. */
export const aiProviderWarn = createWarnLogger("[AIProvider]");

/** Warn logger for Genies operations. */
export const geniesWarn = createWarnLogger("[Genies]");

/** Warn logger for Recent Files/Workspaces. */
export const recentWarn = createWarnLogger("[Recent]");

/** Warn logger for Shortcuts store. */
export const shortcutsWarn = createWarnLogger("[Shortcuts]");

/** Warn logger for the keybinding registry (ADR-018). */
export const keybindingWarn = createWarnLogger("[Keybinding]");

/** Warn logger for the content server (KB / Slidev). */
export const contentServerWarn = createWarnLogger("[ContentServer]");

/** Warn logger for the embedded browser (driver gate, grants, surface). */
export const browserWarn = createWarnLogger("[Browser]");

/** Terminal lifecycle events worth a log line in production — a shell exit that
 *  silently hides the panel is otherwise indistinguishable from a crash. */
export const terminalWarn = createWarnLogger("[Terminal]");

/** Warn logger for Image Handler. */
export const imageHandlerWarn = createWarnLogger("[imageHandler]");

/** Warn logger for Smart Paste. */
export const smartPasteWarn = createWarnLogger("[smartPaste]");

/** Warn logger for Footnote Popup. */
export const footnotePopupWarn = createWarnLogger("[FootnotePopup]");

/** Warn logger for Media Popup. */
export const mediaPopupWarn = createWarnLogger("[MediaPopup]");

/** Warn logger for WYSIWYG Adapter. */
export const wysiwygAdapterWarn = createWarnLogger("[wysiwygAdapter]");

/** Warn logger for Mermaid/Markmap/SVG diagrams. */
export const diagramWarn = createWarnLogger("[Diagram]");

/** Warn logger for HTML/Markdown paste. */
export const pasteWarn = createWarnLogger("[Paste]");

/** Warn logger for Image View security. */
export const imageViewWarn = createWarnLogger("[ImageView]");

/** Warn logger for Source mode popups. */
export const sourcePopupWarn = createWarnLogger("[SourcePopup]");

/** Warn logger for Action Registry. */
export const actionRegistryWarn = createWarnLogger("[ActionRegistry]");

/** Warn logger for Markdown Copy. */
export const markdownCopyWarn = createWarnLogger("[markdownCopy]");

/** Warn logger for Wiki Link Popup. */
export const wikiLinkPopupWarn = createWarnLogger("[WikiLinkPopup]");

/** Warn logger for History. */
export const historyWarn = createWarnLogger("[History]");

/** Warn logger for Window Close. */
export const windowCloseWarn = createWarnLogger("[WindowClose]");

/** Warn logger for Unified Menu Dispatcher. */
export const menuDispatcherWarn = createWarnLogger("[UnifiedMenuDispatcher]");

/** Warn logger for File Watcher. */
export const watcherWarn = createWarnLogger("[Watcher]");

/** Warn logger for the workspace event layer (normalized fs events). */
export const workspaceEventsWarn = createWarnLogger("[WorkspaceEvents]");

/** Warn logger for Export. */
export const exportWarn = createWarnLogger("[Export]");

/** Warn logger for Markdown Pipeline. */
export const mdPipelineWarn = createWarnLogger("[MarkdownPipeline]");

/** Warn logger for Workspace. */
export const workspaceWarn = createWarnLogger("[Workspace]");

/** Warn logger for Title Bar. */
export const titleBarWarn = createWarnLogger("[TitleBar]");

/** Warn logger for Genie (AI inline). */
export const genieWarn = createWarnLogger("[Genie]");

/** Warn logger for Image Context Menu. */
export const imageContextMenuWarn = createWarnLogger("[ImageContextMenu]");

/** Warn logger for Confirm Quit. */
export const confirmQuitWarn = createWarnLogger("[ConfirmQuit]");

/** Warn logger for Finder File Open. */
export const finderFileOpenWarn = createWarnLogger("[FinderFileOpen]");

/** Warn logger for Image Hash Registry. */
export const imageHashWarn = createWarnLogger("[ImageHashRegistry]");

/** Warn logger for Workspace Storage. */
export const workspaceStorageWarn = createWarnLogger("[WorkspaceStorage]");

/** Warn logger for Clipboard. */
export const clipboardWarn = createWarnLogger("[Clipboard]");

/** Warn logger for Render. */
export const renderWarn = createWarnLogger("[Render]");

/** Warn logger for Cleanup. */
export const cleanupWarn = createWarnLogger("[Cleanup]");

/** Warn logger for Status Bar. */
export const statusBarWarn = createWarnLogger("[StatusBar]");

/** Warn logger for List Click Fix. */
export const listClickFixWarn = createWarnLogger("[ListClickFix]");

/** Warn logger for PTY IPC operations (write/resize failures). */
export const ptyWarn = createWarnLogger("[PTY]");

/** Warn logger for Terminal Settings. */
export const terminalSettingsWarn = createWarnLogger("[TerminalSettings]");

/** Warn logger for i18n (language switching). */
export const i18nWarn = createWarnLogger("[i18n]");

/** Warn logger for Workflow Engine. */
export const workflowWarn = createWarnLogger("[Workflow]");

/** Warn logger for Content Search. */
export const contentSearchWarn = createWarnLogger("[ContentSearch]");

/** Warn logger for Quick Open. */
export const quickOpenWarn = createWarnLogger("[QuickOpen]");

/** Warn logger for Menu Sync (startup menu rebuild). */
export const menuSyncWarn = createWarnLogger("[MenuSync]");

/** Warn logger for Update Sync (cross-window state). */
export const updateSyncWarn = createWarnLogger("[UpdateSync]");

/** Warn logger for Settings Sync (cross-window settings). */
export const settingsSyncWarn = createWarnLogger("[SettingsSync]");

/** Warn logger for Shortcuts Sync (cross-window shortcut rebinds). */
export const shortcutsSyncWarn = createWarnLogger("[ShortcutsSync]");

/** Warn logger for Table of Contents. */
export const tocWarn = createWarnLogger("[TOC]");

/** Warn logger for CJK Formatter integrity checks. */
export const cjkFmtWarn = createWarnLogger("[CJK Formatter]");

/** Warn logger for MCP bridge wire-contract violations (WI-15). Persists in
 *  production on purpose: an undeclared payload field is how a dead branch
 *  gets fed, and it must be visible in a user's log file. */
export const mcpContractWarn = createWarnLogger("[MCP Contract]");

/** Warn logger for format-adapter degradation — a language pack or an editor
 *  extension whose chunk failed to load. The editor keeps working with less,
 *  so the only trace a user could otherwise report is "completion stopped
 *  working"; this makes the cause visible in the log file. */
export const formatsWarn = createWarnLogger("[Formats]");
