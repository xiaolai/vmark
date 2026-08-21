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
#[cfg(target_os = "macos")]
mod finder_open_delivery;
mod native_theme;
mod path_validation;
mod settings_window;

/// Where macOS draws this app's window controls.
///
/// A window built at runtime does NOT inherit `tauri.conf.json`'s window entry,
/// so setting `trafficLightPosition` there moves the main window's buttons and
/// nothing else. Every builder that asks for the overlay title bar has to place
/// them itself, from this one constant — miss one and that window's lights sit
/// 10pt away from the main window's, in the same app on the same screen.
///
/// The value matches Finder, measured: 19pt in from the window's left and top
/// edges. `y` carries the standard titlebar inset AppKit applies before this
/// value is used, so `19 + 9 = 28`; `x` is one to one. See
/// `src/shell/trafficLights.ts`, which derives the app's own clearances from
/// the same numbers and has the test that keeps all three declarations equal.
///
/// Needs the `macos-private-api` cargo feature — see `Cargo.toml`.
#[cfg(target_os = "macos")]
pub(crate) const TRAFFIC_LIGHT_POSITION: tauri::LogicalPosition<f64> =
    tauri::LogicalPosition { x: 19.0, y: 28.0 };

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
