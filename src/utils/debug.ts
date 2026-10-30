/**
 * Debug Logging Utilities — barrel.
 *
 * Purpose: Conditional logging with two tiers:
 *   - Debug loggers (console.log/debug): dev-only, tree-shaken in production
 *   - Warn/error loggers: active in BOTH dev and production — writes to
 *     tauri-plugin-log file + console so users can submit log files with bug reports
 *
 * In production, warn/error calls are forwarded to @tauri-apps/plugin-log
 * which writes to ~/Library/Logs/app.vmark/ (macOS). The Tauri log plugin
 * must be initialized before these fire. It is registered in
 * `src-tauri/src/app_plugins.rs`, after only the single-instance plugin (on
 * Windows, its holder plugin) and the webview navigation guard.
 *
 * @coordinates-with @tauri-apps/plugin-log — production warn/error sink
 * @module utils/debug
 */

export * from "./debug/log";
export * from "./debug/warn";
export * from "./debug/error";
