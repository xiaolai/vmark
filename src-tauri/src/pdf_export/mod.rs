//! PDF Export
//!
//! Paginated PDF generation from fully rendered HTML supplied by the frontend.
//! The platform-neutral shell lives in `renderer/`; each platform implements
//! only the part that must touch a native webview.
//!
//! macOS additionally injects a heading outline via PDFKit. Windows and Linux
//! ship without one — a stated gap, not a silent one (ADR-PDF3).

#[cfg(target_os = "macos")]
mod bookmarks;
pub mod commands;
pub(crate) mod heading;
mod renderer;
