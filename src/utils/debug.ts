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
