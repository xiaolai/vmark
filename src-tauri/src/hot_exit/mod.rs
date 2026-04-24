//! Hot Exit Module
//!
//! Provides session capture and restore functionality for update restarts.
//! The Rust coordinator ensures atomic file writes and multi-window coordination.

pub mod session;
pub mod storage;
pub mod coordinator;
pub mod commands;
pub mod dedup;
pub mod migration;
pub mod validation;

// Re-export commonly used types

/// Tauri event emitted to request session state capture from all windows.
pub const EVENT_CAPTURE_REQUEST: &str = "hot-exit:capture-request";
/// Tauri event emitted by each window with its captured state.
pub const EVENT_CAPTURE_RESPONSE: &str = "hot-exit:capture-response";
/// Tauri event emitted when the capture timeout expires.
pub const EVENT_CAPTURE_TIMEOUT: &str = "hot-exit:capture-timeout";
/// Tauri event emitted to signal a window to pull its restore state.
pub const EVENT_RESTORE_START: &str = "hot-exit:restore-start";
// Note: EVENT_RESTORE_COMPLETE, EVENT_RESTORE_FAILED, EVENT_TRIGGER_RESTART
// are defined in TypeScript (src/utils/hotExit/types.ts) and emitted from frontend

/// Main window label constant (must match TypeScript MAIN_WINDOW_LABEL)
pub const MAIN_WINDOW_LABEL: &str = "main";
