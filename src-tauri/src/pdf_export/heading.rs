//! The `Heading` wire type, alone and platform-neutral.
//!
//! Purpose: `Heading` is part of the `export_pdf` command signature, so it
//! must compile on every platform. Its consumer is `outline.rs`, the `lopdf`
//! outline injector that runs on every platform. It replaced the macOS-only
//! PDFKit `bookmarks.rs`, whose platform gate is why this type was split out
//! in the first place (ADR-PDF3, now closed).
//!
//! @coordinates-with outline.rs — the lopdf outline injector (every platform) consumes these
//! @coordinates-with commands.rs — carries them in the command signature
//! @module pdf_export/heading

/// A heading extracted from the document for PDF bookmark (outline) injection.
///
/// The fields are read by `outline::add_outline`, the `lopdf` injector that runs
/// on every platform (ADR-PDF3, closed); the type is part of the `export_pdf`
/// wire contract, and the frontend sends headings unconditionally.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct Heading {
    pub level: u32,
    pub text: String,
}
