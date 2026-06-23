//! # VMark Main
//!
//! Purpose: Binary entry point — applies any pre-init environment workarounds,
//! then delegates to `lib.rs::run()`.
//! The `windows_subsystem` attribute hides the console window on Windows release builds.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    apply_linux_webkit_workarounds();
    vmark_lib::run()
}

/// Work around blank-window / `EGL_BAD_PARAMETER` aborts on some Linux GPU +
/// Mesa + WebKitGTK combinations (e.g. AMD Radeon on Arch / KDE Plasma 6 — see
/// issue #1058, tauri-apps/tauri#11994). WebKitGTK 2.42+'s DMABUF renderer
/// fails to create an EGL display there and the GPU process aborts, leaving a
/// blank content area. Disabling that renderer falls back to a working path.
///
/// Set only when the user hasn't chosen a value, so power users can opt back
/// in with `WEBKIT_DISABLE_DMABUF_RENDERER=0`. Must run before GTK/WebKit
/// initializes — hence here in `main`, ahead of `run()`. No-op off Linux.
#[cfg(target_os = "linux")]
fn apply_linux_webkit_workarounds() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

#[cfg(not(target_os = "linux"))]
fn apply_linux_webkit_workarounds() {}
