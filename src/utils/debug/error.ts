/**
 * Debug *Error loggers — production-persistent errors.
 *
 * In dev, routes to `console.error`. In production, also forwards the message
 * to `@tauri-apps/plugin-log` so users can attach log files to bug reports.
 *
 * @module utils/debug/error
 */

/* v8 ignore start -- @preserve reason: Logger declarations are compile-time
   ternaries on import.meta.env.DEV. In tests (DEV=true), only the dev branch
   executes; the production branch is verified via prodError/formatArgs tests. */

import { isDev, prodError } from "./internals";

/** Error logger for Window Context. */
export const windowContextError = isDev
  ? (...args: unknown[]) => console.error("[WindowContext]", ...args)
  : (...args: unknown[]) => prodError("[WindowContext]", ...args);

/** Error logger for Source Link. */
export const sourceLinkError = isDev
  ? (...args: unknown[]) => console.error("[SourceLink]", ...args)
  : (...args: unknown[]) => prodError("[SourceLink]", ...args);

/** Error logger for Resolve Media. */
export const resolveMediaError = isDev
  ? (...args: unknown[]) => console.error("[ResolveMedia]", ...args)
  : (...args: unknown[]) => prodError("[ResolveMedia]", ...args);

/** Error logger for Source Peek. */
export const sourcePeekError = isDev
  ? (...args: unknown[]) => console.error("[SourcePeek]", ...args)
  : (...args: unknown[]) => prodError("[SourcePeek]", ...args);

/** Error logger for Save. */
export const saveError = isDev
  ? (...args: unknown[]) => console.error("[Save]", ...args)
  : (...args: unknown[]) => prodError("[Save]", ...args);

/** Error logger for Table Actions. */
export const tableActionsError = isDev
  ? (...args: unknown[]) => console.error("[TableActions]", ...args)
  : (...args: unknown[]) => prodError("[TableActions]", ...args);

/** Error logger for Image Hash Registry. */
export const imageHashError = isDev
  ? (...args: unknown[]) => console.error("[ImageHashRegistry]", ...args)
  : (...args: unknown[]) => prodError("[ImageHashRegistry]", ...args);

/** Error logger for WYSIWYG Adapter. */
export const wysiwygAdapterError = isDev
  ? (...args: unknown[]) => console.error("[wysiwygAdapter]", ...args)
  : (...args: unknown[]) => prodError("[wysiwygAdapter]", ...args);

/** Error logger for Link Popup. */
export const linkPopupError = isDev
  ? (...args: unknown[]) => console.error("[LinkPopup]", ...args)
  : (...args: unknown[]) => prodError("[LinkPopup]", ...args);

/** Error logger for Media Popup. */
export const mediaPopupError = isDev
  ? (...args: unknown[]) => console.error("[MediaPopup]", ...args)
  : (...args: unknown[]) => prodError("[MediaPopup]", ...args);

/** Error logger for Wiki Link Popup. */
export const wikiLinkPopupError = isDev
  ? (...args: unknown[]) => console.error("[WikiLinkPopup]", ...args)
  : (...args: unknown[]) => prodError("[WikiLinkPopup]", ...args);

/** Error logger for Markdown/HTML paste. */
export const pasteError = isDev
  ? (...args: unknown[]) => console.error("[Paste]", ...args)
  : (...args: unknown[]) => prodError("[Paste]", ...args);

/** Error logger for Image Handler. */
export const imageHandlerError = isDev
  ? (...args: unknown[]) => console.error("[ImageHandler]", ...args)
  : (...args: unknown[]) => prodError("[ImageHandler]", ...args);

/** Error logger for Source mode actions. */
export const sourceActionError = isDev
  ? (...args: unknown[]) => console.error("[SourceAction]", ...args)
  : (...args: unknown[]) => prodError("[SourceAction]", ...args);

/** Error logger for Smart Paste. */
export const smartPasteError = isDev
  ? (...args: unknown[]) => console.error("[SmartPaste]", ...args)
  : (...args: unknown[]) => prodError("[SmartPaste]", ...args);

/** Error logger for Footnote Popup. */
export const footnotePopupError = isDev
  ? (...args: unknown[]) => console.error("[FootnotePopup]", ...args)
  : (...args: unknown[]) => prodError("[FootnotePopup]", ...args);

/** Error logger for Image Preview. */
export const imagePreviewError = isDev
  ? (...args: unknown[]) => console.error("[ImagePreview]", ...args)
  : (...args: unknown[]) => prodError("[ImagePreview]", ...args);

/** Error logger for Link Commands. */
export const linkCommandsError = isDev
  ? (...args: unknown[]) => console.error("[LinkCommands]", ...args)
  : (...args: unknown[]) => prodError("[LinkCommands]", ...args);

/** Error logger for Media Handler. */
export const mediaHandlerError = isDev
  ? (...args: unknown[]) => console.error("[MediaHandler]", ...args)
  : (...args: unknown[]) => prodError("[MediaHandler]", ...args);

/** Error logger for History. */
export const historyError = isDev
  ? (...args: unknown[]) => console.error("[History]", ...args)
  : (...args: unknown[]) => prodError("[History]", ...args);

/** Error logger for File Explorer. */
export const fileExplorerError = isDev
  ? (...args: unknown[]) => console.error("[FileExplorer]", ...args)
  : (...args: unknown[]) => prodError("[FileExplorer]", ...args);

/** Error logger for Tiptap Editor. */
export const tiptapError = isDev
  ? (...args: unknown[]) => console.error("[Tiptap]", ...args)
  : (...args: unknown[]) => prodError("[Tiptap]", ...args);

/** Error logger for Tab Context Menu. */
export const tabContextError = isDev
  ? (...args: unknown[]) => console.error("[TabContext]", ...args)
  : (...args: unknown[]) => prodError("[TabContext]", ...args);

/** Error logger for File Operations (open, save, rename). */
export const fileOpsError = isDev
  ? (...args: unknown[]) => console.error("[FileOps]", ...args)
  : (...args: unknown[]) => prodError("[FileOps]", ...args);

/** Error logger for Export. */
export const exportError = isDev
  ? (...args: unknown[]) => console.error("[Export]", ...args)
  : (...args: unknown[]) => prodError("[Export]", ...args);

/** Error logger for Hot Exit. */
export const hotExitError = isDev
  ? (...args: unknown[]) => console.error("[HotExit]", ...args)
  : (...args: unknown[]) => prodError("[HotExit]", ...args);

/** Error logger for Orphan Asset Cleanup. */
export const orphanCleanupError = isDev
  ? (...args: unknown[]) => console.error("[OrphanCleanup]", ...args)
  : (...args: unknown[]) => prodError("[OrphanCleanup]", ...args);

/** Error logger for Safe Storage. */
export const safeStorageError = isDev
  ? (...args: unknown[]) => console.error("[SafeStorage]", ...args)
  : (...args: unknown[]) => prodError("[SafeStorage]", ...args);

/** Error logger for App-level. */
export const appError = isDev
  ? (...args: unknown[]) => console.error("[App]", ...args)
  : (...args: unknown[]) => prodError("[App]", ...args);

/** Error logger for PDF Preview. */
export const pdfPreviewError = isDev
  ? (...args: unknown[]) => console.error("[PDF Preview]", ...args)
  : (...args: unknown[]) => prodError("[PDF Preview]", ...args);

/** Error logger for Print. */
export const printError = isDev
  ? (...args: unknown[]) => console.error("[Print]", ...args)
  : (...args: unknown[]) => prodError("[Print]", ...args);

/** Error logger for PDF export dialog. */
export const pdfError = isDev
  ? (...args: unknown[]) => console.error("[PDF]", ...args)
  : (...args: unknown[]) => prodError("[PDF]", ...args);

/** Error logger for Window Close. */
export const windowCloseError = isDev
  ? (...args: unknown[]) => console.error("[WindowClose]", ...args)
  : (...args: unknown[]) => prodError("[WindowClose]", ...args);

/** Error logger for Workspace. */
export const workspaceError = isDev
  ? (...args: unknown[]) => console.error("[Workspace]", ...args)
  : (...args: unknown[]) => prodError("[Workspace]", ...args);

/** Error logger for Outline Sync. */
export const outlineSyncError = isDev
  ? (...args: unknown[]) => console.error("[OutlineSync]", ...args)
  : (...args: unknown[]) => prodError("[OutlineSync]", ...args);

/** Error logger for MCP Bridge. */
export const mcpBridgeError = isDev
  ? (...args: unknown[]) => console.error("[MCP Bridge]", ...args)
  : (...args: unknown[]) => prodError("[MCP Bridge]", ...args);

/** Error logger for Menu dispatch. */
export const menuError = isDev
  ? (...args: unknown[]) => console.error("[Menu]", ...args)
  : (...args: unknown[]) => prodError("[Menu]", ...args);

/** Error logger for Drag & Drop. */
export const dragDropError = isDev
  ? (...args: unknown[]) => console.error("[DragDrop]", ...args)
  : (...args: unknown[]) => prodError("[DragDrop]", ...args);

/** Error logger for Genie/AI. */
export const genieError = isDev
  ? (...args: unknown[]) => console.error("[Genie]", ...args)
  : (...args: unknown[]) => prodError("[Genie]", ...args);

/** Error logger for Image Context Menu. */
export const imageContextMenuError = isDev
  ? (...args: unknown[]) => console.error("[ImageContextMenu]", ...args)
  : (...args: unknown[]) => prodError("[ImageContextMenu]", ...args);

/** Error logger for Finder File Open. */
export const finderFileOpenError = isDev
  ? (...args: unknown[]) => console.error("[FinderFileOpen]", ...args)
  : (...args: unknown[]) => prodError("[FinderFileOpen]", ...args);

/* v8 ignore stop */
