/**
 * Debug Logging Utilities
 *
 * Conditional logging that only outputs in development mode.
 * Controlled by import.meta.env.DEV (Vite environment variable).
 */

const isDev = import.meta.env.DEV;

/**
 * Debug logger for History operations.
 * Only logs in development mode.
 */
export const historyLog = isDev
  ? (...args: unknown[]) => console.log("[History]", ...args)
  : () => {};

/**
 * Debug logger for AutoSave operations.
 * Only logs in development mode.
 */
export const autoSaveLog = isDev
  ? (...args: unknown[]) => console.log("[AutoSave]", ...args)
  : () => {};

/**
 * Debug logger for Terminal operations (IME composition, PTY events).
 * Only logs in development mode.
 */
export const terminalLog = isDev
  ? (...args: unknown[]) => console.log("[Terminal]", ...args)
  : () => {};

/**
 * Debug logger for Crash Recovery operations.
 * Only logs in development mode.
 */
export const crashRecoveryLog = isDev
  ? (...args: unknown[]) => console.log("[CrashRecovery]", ...args)
  : () => {};

/**
 * Debug logger for Hot Exit operations (capture, restore, restart).
 * Only logs in development mode.
 */
export const hotExitLog = isDev
  ? (...args: unknown[]) => console.log("[HotExit]", ...args)
  : () => {};

/**
 * Debug logger for Hot Exit warnings.
 * Only logs in development mode.
 */
export const hotExitWarn = isDev
  ? (...args: unknown[]) => console.warn("[HotExit]", ...args)
  : () => {};

/**
 * Debug logger for File Operations (open, save, save-as, move).
 * Only logs in development mode.
 */
export const fileOpsLog = isDev
  ? (...args: unknown[]) => console.log("[FileOps]", ...args)
  : () => {};

/**
 * Debug logger for File Operations warnings.
 * Only logs in development mode.
 */
export const fileOpsWarn = isDev
  ? (...args: unknown[]) => console.warn("[FileOps]", ...args)
  : () => {};

/**
 * Debug logger for MCP Auto-Start operations.
 * Only logs in development mode.
 */
export const mcpAutoStartLog = isDev
  ? (...args: unknown[]) => console.log("[MCP]", ...args)
  : () => {};

/**
 * Debug logger for Update Checker operations.
 * Only logs in development mode.
 */
export const updateCheckerLog = isDev
  ? (...args: unknown[]) => console.log("[UpdateChecker]", ...args)
  : () => {};

/**
 * Debug logger for AI Provider operations.
 * Only logs in development mode.
 */
export const aiProviderLog = isDev
  ? (...args: unknown[]) => console.log("[AIProvider]", ...args)
  : () => {};

/**
 * Debug logger for AI Provider warnings.
 * Only logs in development mode.
 */
export const aiProviderWarn = isDev
  ? (...args: unknown[]) => console.warn("[AIProvider]", ...args)
  : () => {};

/**
 * Debug logger for Genies store operations.
 * Only logs in development mode.
 */
export const geniesLog = isDev
  ? (...args: unknown[]) => console.log("[Genies]", ...args)
  : () => {};

/**
 * Debug logger for Genies warnings.
 * Only logs in development mode.
 */
export const geniesWarn = isDev
  ? (...args: unknown[]) => console.warn("[Genies]", ...args)
  : () => {};

/**
 * Debug logger for Recent Files/Workspaces warnings.
 * Only logs in development mode.
 */
export const recentWarn = isDev
  ? (...args: unknown[]) => console.warn("[Recent]", ...args)
  : () => {};

/**
 * Debug logger for Shortcuts store warnings.
 * Only logs in development mode.
 */
export const shortcutsWarn = isDev
  ? (...args: unknown[]) => console.warn("[Shortcuts]", ...args)
  : () => {};

/**
 * Debug logger for Image Handler operations.
 * Only logs in development mode.
 */
export const imageHandlerWarn = isDev
  ? (...args: unknown[]) => console.warn("[imageHandler]", ...args)
  : () => {};

/**
 * Debug logger for Smart Paste operations.
 * Only logs in development mode.
 */
export const smartPasteWarn = isDev
  ? (...args: unknown[]) => console.warn("[smartPaste]", ...args)
  : () => {};

/**
 * Debug logger for Footnote Popup warnings.
 * Only logs in development mode.
 */
export const footnotePopupWarn = isDev
  ? (...args: unknown[]) => console.warn("[FootnotePopup]", ...args)
  : () => {};

/**
 * Debug logger for Link/Wiki Link Popup warnings.
 * Only logs in development mode.
 */
export const linkPopupWarn = isDev
  ? (...args: unknown[]) => console.warn("[LinkPopup]", ...args)
  : () => {};

/**
 * Debug logger for Media Popup warnings.
 * Only logs in development mode.
 */
export const mediaPopupWarn = isDev
  ? (...args: unknown[]) => console.warn("[MediaPopup]", ...args)
  : () => {};

/**
 * Debug logger for WYSIWYG Adapter warnings.
 * Only logs in development mode.
 */
export const wysiwygAdapterWarn = isDev
  ? (...args: unknown[]) => console.warn("[wysiwygAdapter]", ...args)
  : () => {};

/**
 * Debug logger for Mermaid/Markmap/SVG diagram warnings.
 * Only logs in development mode.
 */
export const diagramWarn = isDev
  ? (...args: unknown[]) => console.warn("[Diagram]", ...args)
  : () => {};

/**
 * Debug logger for HTML/Markdown paste warnings.
 * Only logs in development mode.
 */
export const pasteWarn = isDev
  ? (...args: unknown[]) => console.warn("[Paste]", ...args)
  : () => {};

/**
 * Debug logger for Image View security warnings.
 * Only logs in development mode.
 */
export const imageViewWarn = isDev
  ? (...args: unknown[]) => console.warn("[ImageView]", ...args)
  : () => {};

/**
 * Debug logger for Source mode popup warnings.
 * Only logs in development mode.
 */
export const sourcePopupWarn = isDev
  ? (...args: unknown[]) => console.warn("[SourcePopup]", ...args)
  : () => {};

/**
 * Debug logger for Action Registry warnings.
 * Only logs in development mode.
 */
export const actionRegistryWarn = isDev
  ? (...args: unknown[]) => console.warn("[ActionRegistry]", ...args)
  : () => {};

/**
 * Debug logger for Markdown Copy warnings.
 * Only logs in development mode.
 */
export const markdownCopyWarn = isDev
  ? (...args: unknown[]) => console.warn("[markdownCopy]", ...args)
  : () => {};

/**
 * Debug logger for Wiki Link Popup warnings.
 * Only logs in development mode.
 */
export const wikiLinkPopupWarn = isDev
  ? (...args: unknown[]) => console.warn("[WikiLinkPopup]", ...args)
  : () => {};

export const historyWarn = isDev
  ? (...args: unknown[]) => console.warn("[History]", ...args)
  : () => {};

export const windowCloseLog = isDev
  ? (...args: unknown[]) => console.log("[WindowClose]", ...args)
  : () => {};

export const windowCloseWarn = isDev
  ? (...args: unknown[]) => console.warn("[WindowClose]", ...args)
  : () => {};

export const menuDispatcherLog = isDev
  ? (...args: unknown[]) => console.debug("[UnifiedMenuDispatcher]", ...args)
  : () => {};

export const menuDispatcherWarn = isDev
  ? (...args: unknown[]) => console.warn("[UnifiedMenuDispatcher]", ...args)
  : () => {};

export const watcherWarn = isDev
  ? (...args: unknown[]) => console.warn("[Watcher]", ...args)
  : () => {};

export const exportWarn = isDev
  ? (...args: unknown[]) => console.warn("[Export]", ...args)
  : () => {};

export const mcpBridgeLog = isDev
  ? (...args: unknown[]) => console.debug("[MCP Bridge]", ...args)
  : () => {};

export const mdPipelineWarn = isDev
  ? (...args: unknown[]) => console.warn("[MarkdownPipeline]", ...args)
  : () => {};

export const workspaceWarn = isDev
  ? (...args: unknown[]) => console.warn("[Workspace]", ...args)
  : () => {};

export const titleBarWarn = isDev
  ? (...args: unknown[]) => console.warn("[TitleBar]", ...args)
  : () => {};

export const genieWarn = isDev
  ? (...args: unknown[]) => console.warn("[Genie]", ...args)
  : () => {};

export const imageContextMenuWarn = isDev
  ? (...args: unknown[]) => console.warn("[ImageContextMenu]", ...args)
  : () => {};

export const orphanCleanupWarn = isDev
  ? (...args: unknown[]) => console.warn("[OrphanCleanup]", ...args)
  : () => {};

export const confirmQuitWarn = isDev
  ? (...args: unknown[]) => console.warn("[ConfirmQuit]", ...args)
  : () => {};

export const finderFileOpenWarn = isDev
  ? (...args: unknown[]) => console.warn("[FinderFileOpen]", ...args)
  : () => {};

export const imageHashWarn = isDev
  ? (...args: unknown[]) => console.warn("[ImageHashRegistry]", ...args)
  : () => {};

export const imageResizeLog = isDev
  ? (...args: unknown[]) => console.log("[ImageResize]", ...args)
  : () => {};

export const workspaceStorageWarn = isDev
  ? (...args: unknown[]) => console.warn("[WorkspaceStorage]", ...args)
  : () => {};

export const clipboardWarn = isDev
  ? (...args: unknown[]) => console.warn("[Clipboard]", ...args)
  : () => {};

export const renderWarn = isDev
  ? (...args: unknown[]) => console.warn("[Render]", ...args)
  : () => {};

export const cleanupWarn = isDev
  ? (...args: unknown[]) => console.warn("[Cleanup]", ...args)
  : () => {};
