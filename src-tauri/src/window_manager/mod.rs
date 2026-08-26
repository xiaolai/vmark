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
//! | `finder_open_delivery` | Hot-open focus, targeted emit, and retry fallback |
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
//! **Every command that creates a window is `#[tauri::command(async)]`, and that
//! is load-bearing on Windows (#1301, #1302).** A command without `async` is
//! `ExecutionContext::Blocking`: Tauri runs the body inline on the thread that
//! delivered the IPC message, which on Windows is inside WebView2's
//! `WebMessageReceived` COM callback. Creating a webview from inside a WebView2
//! callback is the reentrancy case WebView2 forbids, so the app hangs — the
//! Settings window paints white and the process needs `taskkill /F`. Both
//! upstreams document it: `WebviewWindowBuilder::new` ("deadlocks when used in a
//! synchronous command"), and tauri-runtime-wry's `create_webview` ("must be
//! called from a separate thread, otherwise the channel will introduce a
//! deadlock").
//!
//! The same window opened from the NATIVE MENU works, because a menu click
//! arrives through tao's event loop rather than a WebView2 callback — which is
//! why #1301 could report the toolbar entry point hanging while the menu entry
//! point did not, and why macOS shows no symptom at all. `pnpm lint:window-thread`
//! (`scripts/check-window-creation-thread.mjs`) holds the property so the next
//! window command cannot be added synchronously.
//!
//! Known limitations:
//!   - Window counter is process-global (AtomicU32); labels are not recycled.

// Finder/dock-reopen helpers + the macOS-only settings `window` binding are
// compiled everywhere but only used on macOS; silence the off-macOS lints.
#![cfg_attr(not(target_os = "macos"), allow(dead_code, unused_variables))]

mod commands;
mod document_windows;
mod file_open_state;
mod finder_open_delivery;
mod native_theme;
mod path_validation;
mod settings_window;
#[cfg(target_os = "macos")]
mod traffic_lights;
mod window_events;

pub use commands::*;
pub use document_windows::*;
pub use file_open_state::*;
// Not macOS-gated: `file_open::route_file_opens` is the shared destination for
// BOTH macOS `RunEvent::Opened` and the Windows/Linux single-instance callback
// (#1330), and this is where it delivers.
pub(crate) use finder_open_delivery::*;
pub use native_theme::*;
pub use settings_window::*;
#[cfg(target_os = "macos")]
pub(crate) use traffic_lights::*;
pub(crate) use window_events::*;

#[cfg(test)]
#[path = "mod.test.rs"]
mod tests;
