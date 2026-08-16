//! Linux PDF renderer — not yet implemented (WI-PDF3.1).
//!
//! Purpose: keep `pdf_export` compiling and its two commands REACHABLE on
//! Linux, so the module can stop being `#[cfg(target_os = "macos")]` before
//! the native backend lands. Both entry points refuse with a typed
//! `unsupported`, which the frontend can render as a real message.
//!
//! This is deliberately a refusal rather than a missing command. A command
//! absent from `generate_handler!` fails at the IPC boundary with a string
//! Tauri invents; a present command returning `unsupported` fails with a
//! reason we wrote, in the user's language.
//!
//! The spike established the mechanism this file will use:
//! `webkit_print_operation_print()` with print settings carrying BOTH
//! `output-uri` and the `"Print to File"` printer — omitting the printer
//! refuses outright, and omitting `output-uri` reports success while writing
//! `output.pdf` into the working directory (ADR-PDF2). Page size comes from
//! `GtkPageSetup`; margins are left to CSS (ADR-PDF1a).
//!
//! @coordinates-with mod.rs — dispatches here on Linux and other unix
//! @module pdf_export/renderer/linux

use tauri::AppHandle;

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use crate::pdf_export::page_spec::PageSpec;

/// Refuse a PDF render on Linux until WI-PDF2.1 lands.
pub(super) fn render_on_main_thread(
    _app: &AppHandle,
    _html_path: &str,
    _read_access_dir: &str,
    _output_path: &str,
    _page: PageSpec,
) -> Result<(), CommandError> {
    Err(localized_error!(
        ErrorCode::Unsupported,
        "errors.pdf.unsupportedPlatform"
    ))
}

/// Refuse a native print on Linux until WI-PDF4.1 lands.
pub(super) fn print_on_main_thread(
    _html_path: &str,
    _read_access_dir: &str,
) -> Result<(), CommandError> {
    Err(localized_error!(
        ErrorCode::Unsupported,
        "errors.pdf.unsupportedPlatform"
    ))
}
