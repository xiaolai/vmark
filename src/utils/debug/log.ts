/**
 * Debug *Log loggers — dev-only `console.log`/`console.debug` helpers.
 *
 * Each logger is compile-time ternary on `import.meta.env.DEV`. In production
 * the no-op arm is tree-shaken by the bundler so there is zero runtime cost.
 *
 * @module utils/debug/log
 */

/* v8 ignore start -- @preserve reason: Logger declarations are compile-time
   ternaries on import.meta.env.DEV. In tests (DEV=true), only the dev branch
   executes; the no-op production branch is unreachable under Vitest. */

import { isDev } from "./internals";

/** Debug logger for History operations. */
export const historyLog = isDev
  ? (...args: unknown[]) => console.log("[History]", ...args)
  : () => {};

/** Debug logger for AutoSave operations. */
export const autoSaveLog = isDev
  ? (...args: unknown[]) => console.log("[AutoSave]", ...args)
  : () => {};

/** Debug logger for Terminal operations (IME composition, PTY events). */
export const terminalLog = isDev
  ? (...args: unknown[]) => console.log("[Terminal]", ...args)
  : () => {};

/** Debug logger for Crash Recovery operations. */
export const crashRecoveryLog = isDev
  ? (...args: unknown[]) => console.log("[CrashRecovery]", ...args)
  : () => {};

/** Debug logger for Hot Exit operations (capture, restore, restart). */
export const hotExitLog = isDev
  ? (...args: unknown[]) => console.log("[HotExit]", ...args)
  : () => {};

/** Debug logger for File Operations (open, save, save-as, move). */
export const fileOpsLog = isDev
  ? (...args: unknown[]) => console.log("[FileOps]", ...args)
  : () => {};

/** Debug logger for MCP Auto-Start operations. */
export const mcpAutoStartLog = isDev
  ? (...args: unknown[]) => console.log("[MCP]", ...args)
  : () => {};

/** Debug logger for Update Checker operations. */
export const updateCheckerLog = isDev
  ? (...args: unknown[]) => console.log("[UpdateChecker]", ...args)
  : () => {};

/** Debug logger for AI Provider operations. */
export const aiProviderLog = isDev
  ? (...args: unknown[]) => console.log("[AIProvider]", ...args)
  : () => {};

/** Debug logger for Genies store operations. */
export const geniesLog = isDev
  ? (...args: unknown[]) => console.log("[Genies]", ...args)
  : () => {};

/** Debug logger for Window Close operations. */
export const windowCloseLog = isDev
  ? (...args: unknown[]) => console.log("[WindowClose]", ...args)
  : () => {};

/** Debug logger for Unified Menu Dispatcher operations. */
export const menuDispatcherLog = isDev
  ? (...args: unknown[]) => console.debug("[UnifiedMenuDispatcher]", ...args)
  : () => {};

/** Debug logger for MCP Bridge operations. */
export const mcpBridgeLog = isDev
  ? (...args: unknown[]) => console.debug("[MCP Bridge]", ...args)
  : () => {};

/** Debug logger for Image Resize operations. */
export const imageResizeLog = isDev
  ? (...args: unknown[]) => console.log("[ImageResize]", ...args)
  : () => {};

/** Debug logger for Workflow Engine operations. */
export const workflowLog = isDev
  ? (...args: unknown[]) => console.log("[Workflow]", ...args)
  : () => {};

/** Debug logger for Content Search operations. */
export const contentSearchLog = isDev
  ? (...args: unknown[]) => console.log("[ContentSearch]", ...args)
  : () => {};

/** Debug logger for Table of Contents NodeView operations. */
export const tocLog = isDev
  ? (...args: unknown[]) => console.log("[TOC]", ...args)
  : () => {};

/* v8 ignore stop */
