//! The `Heading` wire type, alone and platform-neutral.
//!
//! Purpose: `Heading` is part of the `export_pdf` command signature, so it
//! must compile on every platform. Its only consumer today — `bookmarks.rs` —
//! is PDFKit and therefore macOS-only, so leaving the type there made the
//! whole command macOS-only by transitivity (ADR-PDF3).
//!
//! @coordinates-with bookmarks.rs — macOS outline injection consumes these
//! @coordinates-with commands.rs — carries them in the command signature
//! @module pdf_export/heading

/// A heading extracted from the document for PDF bookmark (outline) injection.
///
/// The fields are read only by the macOS PDFKit injector today (ADR-PDF3), but
/// the type is part of the `export_pdf` wire contract on every platform — the
/// frontend sends headings regardless of who can use them.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Clone, Debug, serde::Deserialize)]
pub struct Heading {
    pub level: u32,
    pub text: String,
}
