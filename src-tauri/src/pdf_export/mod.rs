//! PDF Export
//!
//! Paginated PDF generation from fully rendered HTML supplied by the frontend.
//! The platform-neutral shell lives in `renderer/`; each platform implements
//! only the part that must touch a native webview.
//!
//! A heading outline is injected on EVERY platform, via lopdf. It was PDFKit
//! and therefore macOS-only until now, so Windows and Linux shipped PDFs with
//! no sidebar table of contents (ADR-PDF3, now closed).
//!
//! Page numbers are stamped the same way and for the same reason: CSS puts them
//! in `@page` margin boxes, which WebKit does not implement, so post-processing
//! the finished file is the only route that behaves identically on all three.

pub mod commands;
pub mod heading;
pub mod outline;
mod outline_match;
mod outline_tree;
pub mod page_numbers;
mod page_numbers_label;
pub mod page_spec;
mod pdf_io;
pub mod renderer;

#[cfg(test)]
#[path = "commands.test.rs"]
mod commands_tests;
