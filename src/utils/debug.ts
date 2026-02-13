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
