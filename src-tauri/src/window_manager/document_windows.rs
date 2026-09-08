//! Document/main window construction: cascade positioning, URL building,
//! label allocation, and the macOS dock-reopen workspace pick.
//!
//! Key decisions:
//!   - Windows are created VISIBLE. This module and `lib.rs` both used to claim
//!     they "start hidden and are shown after the frontend emits `ready`",
//!     preventing flash-of-unstyled-content — no builder here calls
//!     `.visible(false)`, `tauri.conf.json` sets no `visible` key (so Tauri's
//!     default `true` applies), and `menu_events::mark_window_ready` flushes
//!     queued menu events without ever calling `.show()`. The lifecycle was
//!     never implemented; the claim is removed rather than left to mislead.
//!     Implementing it is a real option, but it must come with a failure path —
//!     a window that never receives `ready` would stay invisible forever.
//!   - "main" remains the first document-window label and cold-start queue owner;
//!     hot Finder opens can target any last-focused document window.
//!   - macOS dock-icon reactivation restores the user's most-recent workspace via
//!     `pick_reopen_workspace_root` (validated against the live filesystem) instead
//!     of opening an unscoped untitled doc.
//!   - Every builder is generic over the Tauri runtime, so the creation
//!     commands and the second-launch surfacing can be driven on
//!     `tauri::test::MockRuntime` (#246, #249). Production callers pass the
//!     Wry handle and infer it.

use super::window_url::build_window_url;
// Re-exported so `commands.rs` keeps importing the window surface from one
// place; the builder itself lives in `window_url.rs` with its grammar.
pub(super) use super::window_url::build_window_url_with_files;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Runtime, WebviewUrl, WebviewWindowBuilder};

static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(0);

/// Cascade offset for new windows (logical pixels)
const CASCADE_OFFSET: f64 = 25.0;
/// Base position for first window
const BASE_X: f64 = 100.0;
const BASE_Y: f64 = 100.0;
/// Max cascade steps before wrapping
const MAX_CASCADE: u32 = 10;
/// Size a new document window opens at.
const DEFAULT_WIDTH: f64 = 800.0;
const DEFAULT_HEIGHT: f64 = 600.0;
/// Smallest size the user can drag a document window to. Equal to the default
/// today, so a window opens at its minimum — stated as two constants because
/// they answer different questions and only one of them may move.
const MIN_WIDTH: f64 = 800.0;
const MIN_HEIGHT: f64 = 600.0;

/// Get cascaded position based on window counter
fn get_cascaded_position(count: u32) -> (f64, f64) {
    // Wrap around after MAX_CASCADE to avoid windows going off-screen
    let step = (count % MAX_CASCADE) as f64;
    (
        BASE_X + step * CASCADE_OFFSET,
        BASE_Y + step * CASCADE_OFFSET,
    )
}

/// The native title a window starts with, before the frontend replaces it with
/// the document's filename.
///
/// macOS hides the native title (`TitleBarStyle::Overlay` + `hidden_title`
/// below) and the app draws its own strip, so an empty string is right there —
/// anything else would surface only in the Window menu, naming something the
/// title bar never shows. Every other platform draws a real, visible title bar,
/// where an empty string is a blank window until the first title update (#1296).
fn initial_window_title(app_name: &str) -> String {
    if cfg!(target_os = "macos") {
        String::new()
    } else {
        app_name.to_string()
    }
}

/// Build a document window with the shared document-window configuration.
///
/// All document-window entry points (cascade-positioned doc windows, the
/// special "main" window, restore-with-label, transfers) funnel through here so
/// size / title-bar / focus settings can't drift between call sites. `position`
/// is `None` for the "main" window (it relies on saved window state / OS
/// placement); document windows pass an explicit cascade position.
fn build_document_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    url: String,
    position: Option<(f64, f64)>,
) -> Result<(), tauri::Error> {
    let title = initial_window_title(&app.package_info().name);

    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(&title)
        .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .resizable(true)
        .fullscreen(false)
        // Match OS-drawn chrome (title bar, and the Windows menu bar) to the
        // in-app theme from the first frame — see native_theme.rs.
        .theme(Some(super::current_theme()))
        .focused(true);

    if let Some((x, y)) = position {
        builder = builder.position(x, y);
    }

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            // A runtime-built window does not inherit tauri.conf.json's window
            // entry, so the buttons have to be placed here too — see
            // super::TRAFFIC_LIGHT_POSITION.
            .traffic_light_position(super::TRAFFIC_LIGHT_POSITION)
            .accept_first_mouse(true);
    }

    builder.build()?;

    Ok(())
}

/// Claim the next document-window label, and the counter value it came from.
///
/// The `doc-{n}` spelling is the allocator's contract with
/// `create_document_window_with_label_and_url`, which parses the number back
/// out for the cascade — so it is defined once (audit 20260907 #487); it had
/// three copies.
fn next_window_label() -> (u32, String) {
    let count = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    (count, format!("doc-{}", count))
}

/// Create a new document window from a pre-built URL.
pub(crate) fn create_document_window_with_url<R: Runtime>(
    app: &AppHandle<R>,
    url: String,
) -> Result<String, tauri::Error> {
    let (count, label) = next_window_label();

    build_document_window(app, &label, url, Some(get_cascaded_position(count)))?;

    Ok(label)
}

/// Allocate a unique window label without creating a window.
///
/// Increments the global window counter and returns the label that would
/// be assigned to the next window. Used by hot-exit restore to pre-allocate
/// labels before storing restore state (crash safety).
pub(crate) fn allocate_window_label() -> String {
    next_window_label().1
}

/// Create a document window with a pre-allocated label and explicit URL.
///
/// Uses the given label instead of allocating a new one. The caller is
/// responsible for ensuring the label is unique (typically via
/// `allocate_window_label()`). Used by flows that must register routing /
/// restore state keyed on the label BEFORE the window can claim it.
pub(crate) fn create_document_window_with_label_and_url<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    url: String,
) -> Result<(), tauri::Error> {
    // Parse counter from label for cascade position (e.g., "doc-5" → 5).
    //
    // A label `next_window_label` could not have produced falls back to
    // position zero, and that fallback is now LOUD (audit 20260907 #489). It
    // stays a fallback rather than an error on purpose: the labels reaching
    // here come from hot-exit restore, so refusing would trade a window opening
    // at the wrong corner for the user's restored tabs not opening at all. But
    // it means the allocator is in a state nothing else would report, and
    // silence is what made that unfalsifiable.
    let count = match label
        .strip_prefix("doc-")
        .and_then(|n| n.parse::<u32>().ok())
    {
        Some(count) => count,
        None => {
            log::warn!(
                "[window] label {label:?} is not a `doc-<n>` the allocator produces; \
                 cascading from 0. A restored label may be corrupt."
            );
            0
        }
    };

    build_document_window(app, label, url, Some(get_cascaded_position(count)))
}

/// Create a document window with a pre-allocated label (no file/workspace).
///
/// Uses the given label instead of allocating a new one. The caller is
/// responsible for ensuring the label is unique (typically via
/// `allocate_window_label()`).
pub(crate) fn create_document_window_with_label<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
) -> Result<(), tauri::Error> {
    create_document_window_with_label_and_url(app, label, "/".to_string())
}

/// Create a new document window with optional file path and workspace root.
/// Returns the window label on success.
///
/// # Arguments
/// * `app` - Tauri AppHandle
/// * `file_path` - Optional file path to open
/// * `workspace_root` - Optional workspace root to set (for external file opens)
pub fn create_document_window<R: Runtime>(
    app: &AppHandle<R>,
    file_path: Option<&str>,
    workspace_root: Option<&str>,
) -> Result<String, tauri::Error> {
    // Delegates rather than repeating the allocate/label/position/build
    // sequence (audit 20260907 #487): the only thing this entry point adds is
    // turning its two optional arguments into a URL.
    create_document_window_with_url(app, build_window_url(file_path, workspace_root))
}

/// Create a new "main" window (used when the original main window was destroyed
/// and a file is opened from Finder). The main label owns the process-wide
/// cold-start queue; every document window can receive targeted hot opens.
///
/// `workspace_root` lets the dock-icon-reopen path restore the user's last
/// workspace — without it the new window's WindowContext would explicitly
/// clear any persisted workspace state.
pub fn create_main_window<R: Runtime>(
    app: &AppHandle<R>,
    workspace_root: Option<&str>,
) -> Result<String, tauri::Error> {
    let label = "main";

    let url = build_window_url(None, workspace_root);

    // No explicit position: the "main" window relies on saved window state /
    // OS placement rather than the cascade offset used by doc windows.
    build_document_window(app, label, url, None)?;

    Ok(label.to_string())
}

/// Pure decision function for `pick_reopen_workspace_root` — testable without
/// touching the filesystem or the recent-workspaces snapshot.
///
/// `resolve` returns what the recent entry RESOLVES to, or `None` when it is
/// no longer a directory — so the value that travels on is the one that was
/// judged, never the remembered name (#250, audit #490). The check used to be
/// a bare `is_dir()` predicate with the original string passed onward, which
/// is the shape every other path gate here was fixed out of: a name is not a
/// target, and a recent entry replaced by a symlink between the check and the
/// window's mount scoped the window somewhere the user never chose.
fn pick_reopen_workspace_root_with<F>(most_recent: Option<String>, resolve: F) -> Option<String>
where
    F: Fn(&str) -> Option<String>,
{
    most_recent.and_then(|p| resolve(&p))
}

/// On macOS dock-icon reactivation (no visible windows), pick the workspace
/// to restore in the new main window. Returns the most-recent workspace if
/// it still exists on disk; otherwise `None` so the window opens unscoped.
///
/// Falls back to `None` (rather than scanning further down the recent list)
/// to keep behavior predictable: the user expects "the workspace I was just
/// in," not an older one they may not remember.
pub(crate) fn pick_reopen_workspace_root() -> Option<String> {
    pick_reopen_workspace_root_with(crate::menu::get_recent_workspace_path(0), |p| {
        let canonical = std::path::Path::new(p).canonicalize().ok()?;
        if !canonical.is_dir() {
            return None;
        }
        crate::canonical_path::canonical_string(&canonical, "the recent workspace").ok()
    })
}

#[cfg(test)]
#[path = "document_windows.test.rs"]
mod tests;
