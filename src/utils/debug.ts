/**
 * Debug Logging Utilities
 *
 * Purpose: Conditional logging with two tiers:
 *   - Debug loggers (console.log/debug): dev-only, tree-shaken in production
 *   - Warn/error loggers: active in BOTH dev and production — writes to
 *     tauri-plugin-log file + console so users can submit log files with bug reports
 *
 * In production, warn/error calls are forwarded to @tauri-apps/plugin-log
 * which writes to ~/Library/Logs/app.vmark/ (macOS). The Tauri log plugin
 * must be initialized before these fire (it is — registered first in lib.rs).
 *
 * @coordinates-with @tauri-apps/plugin-log — production warn/error sink
 * @module utils/debug
 */

const isDev = import.meta.env.DEV;

// Production warn/error: forward to tauri-plugin-log for file persistence.
// Lazy-loaded to avoid blocking startup; always falls back to console.
let _tauriWarn: ((msg: string) => Promise<void>) | null = null;
let _tauriError: ((msg: string) => Promise<void>) | null = null;

/* v8 ignore start -- @preserve reason: production-only plugin loading */
if (!isDev) {
  import("@tauri-apps/plugin-log").then(({ warn, error }) => {
    _tauriWarn = warn;
    _tauriError = error;
  }).catch(() => {
    // Plugin not available (e.g., unit tests) — console fallback continues
  });
}
/* v8 ignore stop */

/** Serialize args preserving Error.stack and object structure. */
function formatArgs(tag: string, args: unknown[]): string {
  const parts = [tag];
  for (const a of args) {
    if (a instanceof Error) {
      parts.push(a.stack ?? a.message);
    } else if (typeof a === "object" && a !== null) {
      try { parts.push(JSON.stringify(a)); } catch { parts.push(String(a)); }
    } else {
      parts.push(String(a));
    }
  }
  return parts.join(" ");
}

/** Warn logger that persists to file in production. Always outputs to console as fallback. */
function prodWarn(tag: string, ...args: unknown[]) {
  /* v8 ignore next 5 -- @preserve reason: isDev is always true in Vitest */
  if (isDev) {
    console.warn(tag, ...args);
  } else {
    console.warn(tag, ...args);
    if (_tauriWarn) void _tauriWarn(formatArgs(tag, args)).catch((e) => { console.error("[Log] persist warn failed:", e); });
  }
}

/** Error logger that persists to file in production. Always outputs to console as fallback. */
function prodError(tag: string, ...args: unknown[]) {
  /* v8 ignore next 5 -- @preserve reason: isDev is always true in Vitest */
  if (isDev) {
    console.error(tag, ...args);
  } else {
    console.error(tag, ...args);
    if (_tauriError) void _tauriError(formatArgs(tag, args)).catch((e) => { console.error("[Log] persist error failed:", e); });
  }
}

/* v8 ignore start -- @preserve reason: Logger declarations are compile-time
   ternaries on import.meta.env.DEV. In tests (DEV=true), only the dev branch
   executes; the production branch (prodWarn/prodError) is untestable per-logger
   but verified via prodWarn/prodError/formatArgs tests. */

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
 * Logs in dev (console) and production (log file).
 */
export const hotExitWarn = isDev
  ? (...args: unknown[]) => console.warn("[HotExit]", ...args)
  : (...args: unknown[]) => prodWarn("[HotExit]", ...args);

/**
 * Debug logger for File Operations (open, save, save-as, move).
 * Only logs in development mode.
 */
export const fileOpsLog = isDev
  ? (...args: unknown[]) => console.log("[FileOps]", ...args)
  : () => {};

/**
 * Debug logger for File Operations warnings.
 * Logs in dev (console) and production (log file).
 */
export const fileOpsWarn = isDev
  ? (...args: unknown[]) => console.warn("[FileOps]", ...args)
  : (...args: unknown[]) => prodWarn("[FileOps]", ...args);

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
 * Logs in dev (console) and production (log file).
 */
export const aiProviderWarn = isDev
  ? (...args: unknown[]) => console.warn("[AIProvider]", ...args)
  : (...args: unknown[]) => prodWarn("[AIProvider]", ...args);

/**
 * Debug logger for Genies store operations.
 * Only logs in development mode.
 */
export const geniesLog = isDev
  ? (...args: unknown[]) => console.log("[Genies]", ...args)
  : () => {};

/**
 * Debug logger for Genies warnings.
 * Logs in dev (console) and production (log file).
 */
export const geniesWarn = isDev
  ? (...args: unknown[]) => console.warn("[Genies]", ...args)
  : (...args: unknown[]) => prodWarn("[Genies]", ...args);

/**
 * Debug logger for Recent Files/Workspaces warnings.
 * Logs in dev (console) and production (log file).
 */
export const recentWarn = isDev
  ? (...args: unknown[]) => console.warn("[Recent]", ...args)
  : (...args: unknown[]) => prodWarn("[Recent]", ...args);

/**
 * Debug logger for Shortcuts store warnings.
 * Logs in dev (console) and production (log file).
 */
export const shortcutsWarn = isDev
  ? (...args: unknown[]) => console.warn("[Shortcuts]", ...args)
  : (...args: unknown[]) => prodWarn("[Shortcuts]", ...args);

/**
 * Debug logger for Image Handler operations.
 * Logs in dev (console) and production (log file).
 */
export const imageHandlerWarn = isDev
  ? (...args: unknown[]) => console.warn("[imageHandler]", ...args)
  : (...args: unknown[]) => prodWarn("[imageHandler]", ...args);

/**
 * Debug logger for Smart Paste operations.
 * Logs in dev (console) and production (log file).
 */
export const smartPasteWarn = isDev
  ? (...args: unknown[]) => console.warn("[smartPaste]", ...args)
  : (...args: unknown[]) => prodWarn("[smartPaste]", ...args);

/**
 * Debug logger for Footnote Popup warnings.
 * Logs in dev (console) and production (log file).
 */
export const footnotePopupWarn = isDev
  ? (...args: unknown[]) => console.warn("[FootnotePopup]", ...args)
  : (...args: unknown[]) => prodWarn("[FootnotePopup]", ...args);


/**
 * Debug logger for Media Popup warnings.
 * Logs in dev (console) and production (log file).
 */
export const mediaPopupWarn = isDev
  ? (...args: unknown[]) => console.warn("[MediaPopup]", ...args)
  : (...args: unknown[]) => prodWarn("[MediaPopup]", ...args);

/**
 * Debug logger for WYSIWYG Adapter warnings.
 * Logs in dev (console) and production (log file).
 */
export const wysiwygAdapterWarn = isDev
  ? (...args: unknown[]) => console.warn("[wysiwygAdapter]", ...args)
  : (...args: unknown[]) => prodWarn("[wysiwygAdapter]", ...args);

/**
 * Debug logger for Mermaid/Markmap/SVG diagram warnings.
 * Logs in dev (console) and production (log file).
 */
export const diagramWarn = isDev
  ? (...args: unknown[]) => console.warn("[Diagram]", ...args)
  : (...args: unknown[]) => prodWarn("[Diagram]", ...args);

/**
 * Debug logger for HTML/Markdown paste warnings.
 * Logs in dev (console) and production (log file).
 */
export const pasteWarn = isDev
  ? (...args: unknown[]) => console.warn("[Paste]", ...args)
  : (...args: unknown[]) => prodWarn("[Paste]", ...args);

/**
 * Debug logger for Image View security warnings.
 * Logs in dev (console) and production (log file).
 */
export const imageViewWarn = isDev
  ? (...args: unknown[]) => console.warn("[ImageView]", ...args)
  : (...args: unknown[]) => prodWarn("[ImageView]", ...args);

/**
 * Debug logger for Source mode popup warnings.
 * Logs in dev (console) and production (log file).
 */
export const sourcePopupWarn = isDev
  ? (...args: unknown[]) => console.warn("[SourcePopup]", ...args)
  : (...args: unknown[]) => prodWarn("[SourcePopup]", ...args);

/**
 * Debug logger for Action Registry warnings.
 * Logs in dev (console) and production (log file).
 */
export const actionRegistryWarn = isDev
  ? (...args: unknown[]) => console.warn("[ActionRegistry]", ...args)
  : (...args: unknown[]) => prodWarn("[ActionRegistry]", ...args);

/**
 * Debug logger for Markdown Copy warnings.
 * Logs in dev (console) and production (log file).
 */
export const markdownCopyWarn = isDev
  ? (...args: unknown[]) => console.warn("[markdownCopy]", ...args)
  : (...args: unknown[]) => prodWarn("[markdownCopy]", ...args);

/**
 * Debug logger for Wiki Link Popup warnings.
 * Logs in dev (console) and production (log file).
 */
export const wikiLinkPopupWarn = isDev
  ? (...args: unknown[]) => console.warn("[WikiLinkPopup]", ...args)
  : (...args: unknown[]) => prodWarn("[WikiLinkPopup]", ...args);

/** Debug logger for History warnings. */
export const historyWarn = isDev
  ? (...args: unknown[]) => console.warn("[History]", ...args)
  : (...args: unknown[]) => prodWarn("[History]", ...args);

/** Debug logger for Window Close operations. */
export const windowCloseLog = isDev
  ? (...args: unknown[]) => console.log("[WindowClose]", ...args)
  : () => {};

/** Debug logger for Window Close warnings. */
export const windowCloseWarn = isDev
  ? (...args: unknown[]) => console.warn("[WindowClose]", ...args)
  : (...args: unknown[]) => prodWarn("[WindowClose]", ...args);

/** Debug logger for Unified Menu Dispatcher operations. */
export const menuDispatcherLog = isDev
  ? (...args: unknown[]) => console.debug("[UnifiedMenuDispatcher]", ...args)
  : () => {};

/** Debug logger for Unified Menu Dispatcher warnings. */
export const menuDispatcherWarn = isDev
  ? (...args: unknown[]) => console.warn("[UnifiedMenuDispatcher]", ...args)
  : (...args: unknown[]) => prodWarn("[UnifiedMenuDispatcher]", ...args);

/** Debug logger for File Watcher warnings. */
export const watcherWarn = isDev
  ? (...args: unknown[]) => console.warn("[Watcher]", ...args)
  : (...args: unknown[]) => prodWarn("[Watcher]", ...args);

/** Debug logger for Export warnings. */
export const exportWarn = isDev
  ? (...args: unknown[]) => console.warn("[Export]", ...args)
  : (...args: unknown[]) => prodWarn("[Export]", ...args);

/** Debug logger for MCP Bridge operations. */
export const mcpBridgeLog = isDev
  ? (...args: unknown[]) => console.debug("[MCP Bridge]", ...args)
  : () => {};

/** Debug logger for Markdown Pipeline warnings. */
export const mdPipelineWarn = isDev
  ? (...args: unknown[]) => console.warn("[MarkdownPipeline]", ...args)
  : (...args: unknown[]) => prodWarn("[MarkdownPipeline]", ...args);

/** Debug logger for Workspace warnings. */
export const workspaceWarn = isDev
  ? (...args: unknown[]) => console.warn("[Workspace]", ...args)
  : (...args: unknown[]) => prodWarn("[Workspace]", ...args);

/** Debug logger for Title Bar warnings. */
export const titleBarWarn = isDev
  ? (...args: unknown[]) => console.warn("[TitleBar]", ...args)
  : (...args: unknown[]) => prodWarn("[TitleBar]", ...args);

/** Debug logger for Genie (AI inline) warnings. */
export const genieWarn = isDev
  ? (...args: unknown[]) => console.warn("[Genie]", ...args)
  : (...args: unknown[]) => prodWarn("[Genie]", ...args);

/** Debug logger for Image Context Menu warnings. */
export const imageContextMenuWarn = isDev
  ? (...args: unknown[]) => console.warn("[ImageContextMenu]", ...args)
  : (...args: unknown[]) => prodWarn("[ImageContextMenu]", ...args);

/** Debug logger for Orphan Image Cleanup warnings. */
export const orphanCleanupWarn = isDev
  ? (...args: unknown[]) => console.warn("[OrphanCleanup]", ...args)
  : (...args: unknown[]) => prodWarn("[OrphanCleanup]", ...args);

/** Debug logger for Confirm Quit warnings. */
export const confirmQuitWarn = isDev
  ? (...args: unknown[]) => console.warn("[ConfirmQuit]", ...args)
  : (...args: unknown[]) => prodWarn("[ConfirmQuit]", ...args);

/** Debug logger for Finder File Open warnings. */
export const finderFileOpenWarn = isDev
  ? (...args: unknown[]) => console.warn("[FinderFileOpen]", ...args)
  : (...args: unknown[]) => prodWarn("[FinderFileOpen]", ...args);

/** Debug logger for Image Hash Registry warnings. */
export const imageHashWarn = isDev
  ? (...args: unknown[]) => console.warn("[ImageHashRegistry]", ...args)
  : (...args: unknown[]) => prodWarn("[ImageHashRegistry]", ...args);

/** Debug logger for Image Resize operations. */
export const imageResizeLog = isDev
  ? (...args: unknown[]) => console.log("[ImageResize]", ...args)
  : () => {};

/** Debug logger for Workspace Storage warnings. */
export const workspaceStorageWarn = isDev
  ? (...args: unknown[]) => console.warn("[WorkspaceStorage]", ...args)
  : (...args: unknown[]) => prodWarn("[WorkspaceStorage]", ...args);

/** Debug logger for Clipboard warnings. */
export const clipboardWarn = isDev
  ? (...args: unknown[]) => console.warn("[Clipboard]", ...args)
  : (...args: unknown[]) => prodWarn("[Clipboard]", ...args);

/** Debug logger for Render warnings. */
export const renderWarn = isDev
  ? (...args: unknown[]) => console.warn("[Render]", ...args)
  : (...args: unknown[]) => prodWarn("[Render]", ...args);

/** Debug logger for Cleanup warnings. */
export const cleanupWarn = isDev
  ? (...args: unknown[]) => console.warn("[Cleanup]", ...args)
  : (...args: unknown[]) => prodWarn("[Cleanup]", ...args);

/** Debug logger for Status Bar warnings. */
export const statusBarWarn = isDev
  ? (...args: unknown[]) => console.warn("[StatusBar]", ...args)
  : (...args: unknown[]) => prodWarn("[StatusBar]", ...args);

/** Debug logger for List Click Fix warnings. */
export const listClickFixWarn = isDev
  ? (...args: unknown[]) => console.warn("[ListClickFix]", ...args)
  : (...args: unknown[]) => prodWarn("[ListClickFix]", ...args);

/** Debug logger for Window Context errors. */
export const windowContextError = isDev
  ? (...args: unknown[]) => console.error("[WindowContext]", ...args)
  : (...args: unknown[]) => prodError("[WindowContext]", ...args);

/** Debug logger for Source Link errors. */
export const sourceLinkError = isDev
  ? (...args: unknown[]) => console.error("[SourceLink]", ...args)
  : (...args: unknown[]) => prodError("[SourceLink]", ...args);

/** Debug logger for Resolve Media errors. */
export const resolveMediaError = isDev
  ? (...args: unknown[]) => console.error("[ResolveMedia]", ...args)
  : (...args: unknown[]) => prodError("[ResolveMedia]", ...args);

/** Debug logger for Source Peek errors. */
export const sourcePeekError = isDev
  ? (...args: unknown[]) => console.error("[SourcePeek]", ...args)
  : (...args: unknown[]) => prodError("[SourcePeek]", ...args);

/** Debug logger for Save errors. */
export const saveError = isDev
  ? (...args: unknown[]) => console.error("[Save]", ...args)
  : (...args: unknown[]) => prodError("[Save]", ...args);

/** Debug logger for Table Actions errors. */
export const tableActionsError = isDev
  ? (...args: unknown[]) => console.error("[TableActions]", ...args)
  : (...args: unknown[]) => prodError("[TableActions]", ...args);

/** Debug logger for Image Hash Registry errors. */
export const imageHashError = isDev
  ? (...args: unknown[]) => console.error("[ImageHashRegistry]", ...args)
  : (...args: unknown[]) => prodError("[ImageHashRegistry]", ...args);

/** Debug logger for WYSIWYG Adapter errors. */
export const wysiwygAdapterError = isDev
  ? (...args: unknown[]) => console.error("[wysiwygAdapter]", ...args)
  : (...args: unknown[]) => prodError("[wysiwygAdapter]", ...args);

// --- Error loggers for plugin console.error migration ---

/** Error logger for Link Popup operations. */
export const linkPopupError = isDev
  ? (...args: unknown[]) => console.error("[LinkPopup]", ...args)
  : (...args: unknown[]) => prodError("[LinkPopup]", ...args);

/** Error logger for Media Popup operations. */
export const mediaPopupError = isDev
  ? (...args: unknown[]) => console.error("[MediaPopup]", ...args)
  : (...args: unknown[]) => prodError("[MediaPopup]", ...args);

/** Error logger for Wiki Link Popup operations. */
export const wikiLinkPopupError = isDev
  ? (...args: unknown[]) => console.error("[WikiLinkPopup]", ...args)
  : (...args: unknown[]) => prodError("[WikiLinkPopup]", ...args);

/** Error logger for Markdown/HTML paste operations. */
export const pasteError = isDev
  ? (...args: unknown[]) => console.error("[Paste]", ...args)
  : (...args: unknown[]) => prodError("[Paste]", ...args);

/** Error logger for Image Handler operations. */
export const imageHandlerError = isDev
  ? (...args: unknown[]) => console.error("[ImageHandler]", ...args)
  : (...args: unknown[]) => prodError("[ImageHandler]", ...args);

/** Error logger for Source mode actions. */
export const sourceActionError = isDev
  ? (...args: unknown[]) => console.error("[SourceAction]", ...args)
  : (...args: unknown[]) => prodError("[SourceAction]", ...args);

/** Error logger for Smart Paste operations. */
export const smartPasteError = isDev
  ? (...args: unknown[]) => console.error("[SmartPaste]", ...args)
  : (...args: unknown[]) => prodError("[SmartPaste]", ...args);

/** Error logger for Footnote Popup operations. */
export const footnotePopupError = isDev
  ? (...args: unknown[]) => console.error("[FootnotePopup]", ...args)
  : (...args: unknown[]) => prodError("[FootnotePopup]", ...args);

/** Error logger for Image Preview operations. */
export const imagePreviewError = isDev
  ? (...args: unknown[]) => console.error("[ImagePreview]", ...args)
  : (...args: unknown[]) => prodError("[ImagePreview]", ...args);

/** Error logger for Link Commands operations. */
export const linkCommandsError = isDev
  ? (...args: unknown[]) => console.error("[LinkCommands]", ...args)
  : (...args: unknown[]) => prodError("[LinkCommands]", ...args);

/** Error logger for Media Handler operations. */
export const mediaHandlerError = isDev
  ? (...args: unknown[]) => console.error("[MediaHandler]", ...args)
  : (...args: unknown[]) => prodError("[MediaHandler]", ...args);

// --- Error loggers for component/util console.error migration ---

/** Error logger for History operations. */
export const historyError = isDev
  ? (...args: unknown[]) => console.error("[History]", ...args)
  : (...args: unknown[]) => prodError("[History]", ...args);

/** Error logger for File Explorer operations. */
export const fileExplorerError = isDev
  ? (...args: unknown[]) => console.error("[FileExplorer]", ...args)
  : (...args: unknown[]) => prodError("[FileExplorer]", ...args);

/** Error logger for Tiptap Editor operations. */
export const tiptapError = isDev
  ? (...args: unknown[]) => console.error("[Tiptap]", ...args)
  : (...args: unknown[]) => prodError("[Tiptap]", ...args);

/** Error logger for Tab Context Menu operations. */
export const tabContextError = isDev
  ? (...args: unknown[]) => console.error("[TabContext]", ...args)
  : (...args: unknown[]) => prodError("[TabContext]", ...args);

/** Error logger for File Operations (open, save, rename). */
export const fileOpsError = isDev
  ? (...args: unknown[]) => console.error("[FileOps]", ...args)
  : (...args: unknown[]) => prodError("[FileOps]", ...args);

/** Error logger for Export operations. */
export const exportError = isDev
  ? (...args: unknown[]) => console.error("[Export]", ...args)
  : (...args: unknown[]) => prodError("[Export]", ...args);

/** Error logger for Hot Exit operations. */
export const hotExitError = isDev
  ? (...args: unknown[]) => console.error("[HotExit]", ...args)
  : (...args: unknown[]) => prodError("[HotExit]", ...args);

/** Error logger for Orphan Asset Cleanup operations. */
export const orphanCleanupError = isDev
  ? (...args: unknown[]) => console.error("[OrphanCleanup]", ...args)
  : (...args: unknown[]) => prodError("[OrphanCleanup]", ...args);

/** Error logger for Safe Storage operations. */
export const safeStorageError = isDev
  ? (...args: unknown[]) => console.error("[SafeStorage]", ...args)
  : (...args: unknown[]) => prodError("[SafeStorage]", ...args);

/** Error logger for App-level operations. */
export const appError = isDev
  ? (...args: unknown[]) => console.error("[App]", ...args)
  : (...args: unknown[]) => prodError("[App]", ...args);

/** Error logger for PDF Preview operations. */
export const pdfPreviewError = isDev
  ? (...args: unknown[]) => console.error("[PDF Preview]", ...args)
  : (...args: unknown[]) => prodError("[PDF Preview]", ...args);

/** Error logger for Print operations. */
export const printError = isDev
  ? (...args: unknown[]) => console.error("[Print]", ...args)
  : (...args: unknown[]) => prodError("[Print]", ...args);

/** Error logger for PDF export dialog operations. */
export const pdfError = isDev
  ? (...args: unknown[]) => console.error("[PDF]", ...args)
  : (...args: unknown[]) => prodError("[PDF]", ...args);

/** Warn logger for Terminal Settings operations. */
export const terminalSettingsWarn = isDev
  ? (...args: unknown[]) => console.warn("[TerminalSettings]", ...args)
  : (...args: unknown[]) => prodWarn("[TerminalSettings]", ...args);

/** Warn logger for i18n (language switching) operations. */
export const i18nWarn = isDev
  ? (...args: unknown[]) => console.warn("[i18n]", ...args)
  : (...args: unknown[]) => prodWarn("[i18n]", ...args);

// --- Loggers needed by prior migration effort on this branch ---

/** Error logger for Window Close operations. */
export const windowCloseError = isDev
  ? (...args: unknown[]) => console.error("[WindowClose]", ...args)
  : (...args: unknown[]) => prodError("[WindowClose]", ...args);

/** Error logger for Workspace operations. */
export const workspaceError = isDev
  ? (...args: unknown[]) => console.error("[Workspace]", ...args)
  : (...args: unknown[]) => prodError("[Workspace]", ...args);

/** Error logger for Outline Sync operations. */
export const outlineSyncError = isDev
  ? (...args: unknown[]) => console.error("[OutlineSync]", ...args)
  : (...args: unknown[]) => prodError("[OutlineSync]", ...args);

/** Error logger for MCP Bridge operations. */
export const mcpBridgeError = isDev
  ? (...args: unknown[]) => console.error("[MCP Bridge]", ...args)
  : (...args: unknown[]) => prodError("[MCP Bridge]", ...args);

/** Error logger for Menu dispatch operations. */
export const menuError = isDev
  ? (...args: unknown[]) => console.error("[Menu]", ...args)
  : (...args: unknown[]) => prodError("[Menu]", ...args);

/** Error logger for Drag & Drop operations. */
export const dragDropError = isDev
  ? (...args: unknown[]) => console.error("[DragDrop]", ...args)
  : (...args: unknown[]) => prodError("[DragDrop]", ...args);

/** Error logger for Genie/AI operations. */
export const genieError = isDev
  ? (...args: unknown[]) => console.error("[Genie]", ...args)
  : (...args: unknown[]) => prodError("[Genie]", ...args);

/** Error logger for Image Context Menu operations. */
export const imageContextMenuError = isDev
  ? (...args: unknown[]) => console.error("[ImageContextMenu]", ...args)
  : (...args: unknown[]) => prodError("[ImageContextMenu]", ...args);

/** Error logger for Finder File Open operations. */
export const finderFileOpenError = isDev
  ? (...args: unknown[]) => console.error("[FinderFileOpen]", ...args)
  : (...args: unknown[]) => prodError("[FinderFileOpen]", ...args);

/** Debug logger for Workflow Engine operations. */
export const workflowLog = isDev
  ? (...args: unknown[]) => console.log("[Workflow]", ...args)
  : () => {};

/** Warning logger for Workflow Engine operations. */
export const workflowWarn = isDev
  ? (...args: unknown[]) => console.warn("[Workflow]", ...args)
  : (...args: unknown[]) => prodWarn("[Workflow]", ...args);

/** Debug logger for Content Search operations. */
export const contentSearchLog = isDev
  ? (...args: unknown[]) => console.log("[ContentSearch]", ...args)
  : () => {};

/** Warn logger for Content Search operations. */
export const contentSearchWarn = isDev
  ? (...args: unknown[]) => console.warn("[ContentSearch]", ...args)
  : (...args: unknown[]) => prodWarn("[ContentSearch]", ...args);

/** Warn logger for Menu Sync (startup menu rebuild) operations. */
export const menuSyncWarn = isDev
  ? (...args: unknown[]) => console.warn("[MenuSync]", ...args)
  : (...args: unknown[]) => prodWarn("[MenuSync]", ...args);

/** Warn logger for Update Sync (cross-window state) operations. */
export const updateSyncWarn = isDev
  ? (...args: unknown[]) => console.warn("[UpdateSync]", ...args)
  : (...args: unknown[]) => prodWarn("[UpdateSync]", ...args);

