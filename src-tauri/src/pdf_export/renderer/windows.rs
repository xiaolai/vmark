//! Windows PDF renderer — not yet implemented (WI-PDF2.1).
//!
//! Purpose: keep `pdf_export` compiling and its two commands REACHABLE on
//! Windows, so the module can stop being `#[cfg(target_os = "macos")]` before
//! the native backend lands. Both entry points refuse with a typed
//! `unsupported`, which the frontend can render as a real message.
//!
//! This is deliberately a refusal rather than a missing command. A command
//! absent from `generate_handler!` fails at the IPC boundary with a string
//! Tauri invents; a present command returning `unsupported` fails with a
//! reason we wrote, in the user's language.
//!
//! The spike (ADR-PDF1a) established the mechanism this file will use:
//! `ICoreWebView2_7::PrintToPdf` with page size via `SetPageWidth/Height`,
//! orientation expressed as a width/height SWAP (the orientation enum was
//! measurably ignored), and margins left to CSS.
//!
//! @coordinates-with mod.rs — dispatches here on Windows
//! @module pdf_export/renderer/windows

use tauri::AppHandle;

/// Refuse a PDF render on Windows until WI-PDF2.1 lands.
pub(super) fn render_on_main_thread(
    _app: &AppHandle,
    _html_path: &str,
    _read_access_dir: &str,
    _output_path: &str,
) -> Result<(), String> {
    Err(rust_i18n::t!("errors.pdf.unsupportedPlatform").to_string())
}

/// Refuse a native print on Windows until WI-PDF4.1 lands.
pub(super) fn print_on_main_thread(_html_path: &str, _read_access_dir: &str) -> Result<(), String> {
    Err(rust_i18n::t!("errors.pdf.unsupportedPlatform").to_string())
}
