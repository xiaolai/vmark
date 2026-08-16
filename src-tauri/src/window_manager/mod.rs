//! # Window Manager
//!
//! Purpose: Owns Tauri webview-window creation and lifecycle for document,
//! settings, and transfer windows plus Finder/CLI targeting and delivery.
//!
//! Pipeline: Menu/dock/CLI/Finder actions → functions here → `WebviewWindowBuilder` →
//! new OS window with the React frontend.
//!
//! Module map (one responsibility each, split from the former single file):
//!
//! | Module | Owns |
//! |---|---|
//! | `file_open_state` | Finder/CLI open decisions, pending queue, workspace grouping |
//! | `finder_open_delivery` | macOS hot-open focus, targeted emit, and retry fallback |
//! | `document_windows` | Document/main window construction, URLs, labels, dock-reopen pick |
//! | `path_validation` | Security gates for frontend-supplied paths / workspace roots |
//! | `commands` | `open_*_in_new_window`, `close_window`, quit commands |
//! | `settings_window` | Settings window singleton (create / focus / navigate) |
//! | `native_theme` | Keeps OS-drawn chrome (title bar, Windows menu bar) on the in-app theme |
//!
//! Everything is re-exported here so call sites keep using
//! `crate::window_manager::...` (and `lib.rs`'s `generate_handler!` paths
//! keep resolving — glob re-exports carry the `#[tauri::command]` macros).
//!
//! Known limitations:
//!   - Window counter is process-global (AtomicU32); labels are not recycled.

// Finder/dock-reopen helpers + the macOS-only settings `window` binding are
// compiled everywhere but only used on macOS; silence the off-macOS lints.
#![cfg_attr(not(target_os = "macos"), allow(dead_code, unused_variables))]

mod commands;
mod document_windows;
mod file_open_state;
#[cfg(target_os = "macos")]
mod finder_open_delivery;
mod native_theme;
mod path_validation;
mod settings_window;

pub use commands::*;
pub use document_windows::*;
pub use file_open_state::*;
#[cfg(target_os = "macos")]
pub(crate) use finder_open_delivery::*;
pub use native_theme::*;
pub use settings_window::*;

#[cfg(test)]
#[path = "mod.test.rs"]
mod tests;
