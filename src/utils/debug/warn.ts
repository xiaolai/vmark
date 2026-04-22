/**
 * Debug *Warn loggers — production-persistent warnings.
 *
 * In dev, routes to `console.warn`. In production, also forwards the message
 * to `@tauri-apps/plugin-log` so users can attach log files to bug reports.
 *
 * @module utils/debug/warn
 */

/* v8 ignore start -- @preserve reason: Logger declarations are compile-time
   ternaries on import.meta.env.DEV. In tests (DEV=true), only the dev branch
   executes; the production branch is verified via prodWarn/formatArgs tests. */

import { isDev, prodWarn } from "./internals";

/** Warn logger for Hot Exit operations. */
export const hotExitWarn = isDev
  ? (...args: unknown[]) => console.warn("[HotExit]", ...args)
  : (...args: unknown[]) => prodWarn("[HotExit]", ...args);

/** Warn logger for File Operations. */
export const fileOpsWarn = isDev
  ? (...args: unknown[]) => console.warn("[FileOps]", ...args)
  : (...args: unknown[]) => prodWarn("[FileOps]", ...args);

/** Warn logger for Large File open routing. */
export const largeFileWarn = isDev
  ? (...args: unknown[]) => console.warn("[LargeFile]", ...args)
  : (...args: unknown[]) => prodWarn("[LargeFile]", ...args);

/** Warn logger for AI Provider operations. */
export const aiProviderWarn = isDev
  ? (...args: unknown[]) => console.warn("[AIProvider]", ...args)
  : (...args: unknown[]) => prodWarn("[AIProvider]", ...args);

/** Warn logger for Genies operations. */
export const geniesWarn = isDev
  ? (...args: unknown[]) => console.warn("[Genies]", ...args)
  : (...args: unknown[]) => prodWarn("[Genies]", ...args);

/** Warn logger for Recent Files/Workspaces. */
export const recentWarn = isDev
  ? (...args: unknown[]) => console.warn("[Recent]", ...args)
  : (...args: unknown[]) => prodWarn("[Recent]", ...args);

/** Warn logger for Shortcuts store. */
export const shortcutsWarn = isDev
  ? (...args: unknown[]) => console.warn("[Shortcuts]", ...args)
  : (...args: unknown[]) => prodWarn("[Shortcuts]", ...args);

/** Warn logger for Image Handler. */
export const imageHandlerWarn = isDev
  ? (...args: unknown[]) => console.warn("[imageHandler]", ...args)
  : (...args: unknown[]) => prodWarn("[imageHandler]", ...args);

/** Warn logger for Smart Paste. */
export const smartPasteWarn = isDev
  ? (...args: unknown[]) => console.warn("[smartPaste]", ...args)
  : (...args: unknown[]) => prodWarn("[smartPaste]", ...args);

/** Warn logger for Footnote Popup. */
export const footnotePopupWarn = isDev
  ? (...args: unknown[]) => console.warn("[FootnotePopup]", ...args)
  : (...args: unknown[]) => prodWarn("[FootnotePopup]", ...args);

/** Warn logger for Media Popup. */
export const mediaPopupWarn = isDev
  ? (...args: unknown[]) => console.warn("[MediaPopup]", ...args)
  : (...args: unknown[]) => prodWarn("[MediaPopup]", ...args);

/** Warn logger for WYSIWYG Adapter. */
export const wysiwygAdapterWarn = isDev
  ? (...args: unknown[]) => console.warn("[wysiwygAdapter]", ...args)
  : (...args: unknown[]) => prodWarn("[wysiwygAdapter]", ...args);

/** Warn logger for Mermaid/Markmap/SVG diagrams. */
export const diagramWarn = isDev
  ? (...args: unknown[]) => console.warn("[Diagram]", ...args)
  : (...args: unknown[]) => prodWarn("[Diagram]", ...args);

/** Warn logger for HTML/Markdown paste. */
export const pasteWarn = isDev
  ? (...args: unknown[]) => console.warn("[Paste]", ...args)
  : (...args: unknown[]) => prodWarn("[Paste]", ...args);

/** Warn logger for Image View security. */
export const imageViewWarn = isDev
  ? (...args: unknown[]) => console.warn("[ImageView]", ...args)
  : (...args: unknown[]) => prodWarn("[ImageView]", ...args);

/** Warn logger for Source mode popups. */
export const sourcePopupWarn = isDev
  ? (...args: unknown[]) => console.warn("[SourcePopup]", ...args)
  : (...args: unknown[]) => prodWarn("[SourcePopup]", ...args);

/** Warn logger for Action Registry. */
export const actionRegistryWarn = isDev
  ? (...args: unknown[]) => console.warn("[ActionRegistry]", ...args)
  : (...args: unknown[]) => prodWarn("[ActionRegistry]", ...args);

/** Warn logger for Markdown Copy. */
export const markdownCopyWarn = isDev
  ? (...args: unknown[]) => console.warn("[markdownCopy]", ...args)
  : (...args: unknown[]) => prodWarn("[markdownCopy]", ...args);

/** Warn logger for Wiki Link Popup. */
export const wikiLinkPopupWarn = isDev
  ? (...args: unknown[]) => console.warn("[WikiLinkPopup]", ...args)
  : (...args: unknown[]) => prodWarn("[WikiLinkPopup]", ...args);

/** Warn logger for History. */
export const historyWarn = isDev
  ? (...args: unknown[]) => console.warn("[History]", ...args)
  : (...args: unknown[]) => prodWarn("[History]", ...args);

/** Warn logger for Window Close. */
export const windowCloseWarn = isDev
  ? (...args: unknown[]) => console.warn("[WindowClose]", ...args)
  : (...args: unknown[]) => prodWarn("[WindowClose]", ...args);

/** Warn logger for Unified Menu Dispatcher. */
export const menuDispatcherWarn = isDev
  ? (...args: unknown[]) => console.warn("[UnifiedMenuDispatcher]", ...args)
  : (...args: unknown[]) => prodWarn("[UnifiedMenuDispatcher]", ...args);

/** Warn logger for File Watcher. */
export const watcherWarn = isDev
  ? (...args: unknown[]) => console.warn("[Watcher]", ...args)
  : (...args: unknown[]) => prodWarn("[Watcher]", ...args);

/** Warn logger for Export. */
export const exportWarn = isDev
  ? (...args: unknown[]) => console.warn("[Export]", ...args)
  : (...args: unknown[]) => prodWarn("[Export]", ...args);

/** Warn logger for Markdown Pipeline. */
export const mdPipelineWarn = isDev
  ? (...args: unknown[]) => console.warn("[MarkdownPipeline]", ...args)
  : (...args: unknown[]) => prodWarn("[MarkdownPipeline]", ...args);

/** Warn logger for Workspace. */
export const workspaceWarn = isDev
  ? (...args: unknown[]) => console.warn("[Workspace]", ...args)
  : (...args: unknown[]) => prodWarn("[Workspace]", ...args);

/** Warn logger for Title Bar. */
export const titleBarWarn = isDev
  ? (...args: unknown[]) => console.warn("[TitleBar]", ...args)
  : (...args: unknown[]) => prodWarn("[TitleBar]", ...args);

/** Warn logger for Genie (AI inline). */
export const genieWarn = isDev
  ? (...args: unknown[]) => console.warn("[Genie]", ...args)
  : (...args: unknown[]) => prodWarn("[Genie]", ...args);

/** Warn logger for Image Context Menu. */
export const imageContextMenuWarn = isDev
  ? (...args: unknown[]) => console.warn("[ImageContextMenu]", ...args)
  : (...args: unknown[]) => prodWarn("[ImageContextMenu]", ...args);

/** Warn logger for Orphan Image Cleanup. */
export const orphanCleanupWarn = isDev
  ? (...args: unknown[]) => console.warn("[OrphanCleanup]", ...args)
  : (...args: unknown[]) => prodWarn("[OrphanCleanup]", ...args);

/** Warn logger for Confirm Quit. */
export const confirmQuitWarn = isDev
  ? (...args: unknown[]) => console.warn("[ConfirmQuit]", ...args)
  : (...args: unknown[]) => prodWarn("[ConfirmQuit]", ...args);

/** Warn logger for Finder File Open. */
export const finderFileOpenWarn = isDev
  ? (...args: unknown[]) => console.warn("[FinderFileOpen]", ...args)
  : (...args: unknown[]) => prodWarn("[FinderFileOpen]", ...args);

/** Warn logger for Image Hash Registry. */
export const imageHashWarn = isDev
  ? (...args: unknown[]) => console.warn("[ImageHashRegistry]", ...args)
  : (...args: unknown[]) => prodWarn("[ImageHashRegistry]", ...args);

/** Warn logger for Workspace Storage. */
export const workspaceStorageWarn = isDev
  ? (...args: unknown[]) => console.warn("[WorkspaceStorage]", ...args)
  : (...args: unknown[]) => prodWarn("[WorkspaceStorage]", ...args);

/** Warn logger for Clipboard. */
export const clipboardWarn = isDev
  ? (...args: unknown[]) => console.warn("[Clipboard]", ...args)
  : (...args: unknown[]) => prodWarn("[Clipboard]", ...args);

/** Warn logger for Render. */
export const renderWarn = isDev
  ? (...args: unknown[]) => console.warn("[Render]", ...args)
  : (...args: unknown[]) => prodWarn("[Render]", ...args);

/** Warn logger for Cleanup. */
export const cleanupWarn = isDev
  ? (...args: unknown[]) => console.warn("[Cleanup]", ...args)
  : (...args: unknown[]) => prodWarn("[Cleanup]", ...args);

/** Warn logger for Status Bar. */
export const statusBarWarn = isDev
  ? (...args: unknown[]) => console.warn("[StatusBar]", ...args)
  : (...args: unknown[]) => prodWarn("[StatusBar]", ...args);

/** Warn logger for List Click Fix. */
export const listClickFixWarn = isDev
  ? (...args: unknown[]) => console.warn("[ListClickFix]", ...args)
  : (...args: unknown[]) => prodWarn("[ListClickFix]", ...args);

/** Warn logger for PTY IPC operations (write/resize failures). */
export const ptyWarn = isDev
  ? (...args: unknown[]) => console.warn("[PTY]", ...args)
  : (...args: unknown[]) => prodWarn("[PTY]", ...args);

/** Warn logger for Terminal Settings. */
export const terminalSettingsWarn = isDev
  ? (...args: unknown[]) => console.warn("[TerminalSettings]", ...args)
  : (...args: unknown[]) => prodWarn("[TerminalSettings]", ...args);

/** Warn logger for i18n (language switching). */
export const i18nWarn = isDev
  ? (...args: unknown[]) => console.warn("[i18n]", ...args)
  : (...args: unknown[]) => prodWarn("[i18n]", ...args);

/** Warn logger for Workflow Engine. */
export const workflowWarn = isDev
  ? (...args: unknown[]) => console.warn("[Workflow]", ...args)
  : (...args: unknown[]) => prodWarn("[Workflow]", ...args);

/** Warn logger for Content Search. */
export const contentSearchWarn = isDev
  ? (...args: unknown[]) => console.warn("[ContentSearch]", ...args)
  : (...args: unknown[]) => prodWarn("[ContentSearch]", ...args);

/** Warn logger for Menu Sync (startup menu rebuild). */
export const menuSyncWarn = isDev
  ? (...args: unknown[]) => console.warn("[MenuSync]", ...args)
  : (...args: unknown[]) => prodWarn("[MenuSync]", ...args);

/** Warn logger for Update Sync (cross-window state). */
export const updateSyncWarn = isDev
  ? (...args: unknown[]) => console.warn("[UpdateSync]", ...args)
  : (...args: unknown[]) => prodWarn("[UpdateSync]", ...args);

/** Warn logger for Table of Contents. */
export const tocWarn = isDev
  ? (...args: unknown[]) => console.warn("[TOC]", ...args)
  : (...args: unknown[]) => prodWarn("[TOC]", ...args);

/** Warn logger for CJK Formatter integrity checks. */
export const cjkFmtWarn = isDev
  ? (...args: unknown[]) => console.warn("[CJK Formatter]", ...args)
  : (...args: unknown[]) => prodWarn("[CJK Formatter]", ...args);

/* v8 ignore stop */
