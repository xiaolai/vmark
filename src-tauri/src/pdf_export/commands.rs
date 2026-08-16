//! Tauri commands for PDF export and native printing.

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

use super::heading::Heading;
use super::renderer;
use std::path::Path;

/// Reject an output path before any rendering starts.
///
/// Extracted from the command so it is testable without a Tauri runtime:
/// `export_pdf` takes a concrete `AppHandle`, so a test that went through the
/// command would need a real webview to check a string.
///
/// The two failures carry DIFFERENT codes on purpose — a frontend that cannot
/// tell "wrong extension" from "directory gone" is back to matching message
/// text, which is what `CommandError` exists to end (rule 50).
pub(super) fn validate_output_path(output_path: &str) -> Result<(), CommandError> {
    let path = Path::new(output_path);

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !ext.eq_ignore_ascii_case("pdf") {
        return Err(localized_error!(
            ErrorCode::InvalidInput,
            "errors.pdf.invalidExtension"
        ));
    }

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(localized_error!(
                ErrorCode::NotFound,
                "errors.pdf.dirNotFound"
            ));
        }
    }
    Ok(())
}

/// Export HTML content to a PDF file using the platform's native webview.
///
/// Emits `pdf-export-progress` events to the `pdf-export` window
/// with status updates: "loading", "rendering", "done".
///
/// After PDF generation, injects heading-based bookmarks using PDFKit.
#[tauri::command]
pub async fn export_pdf(
    app: tauri::AppHandle,
    html: String,
    output_path: String,
    headings: Option<Vec<Heading>>,
) -> Result<(), CommandError> {
    validate_output_path(&output_path)?;

    renderer::render_pdf(app, html, output_path.clone()).await?;

    // Add bookmarks if headings were provided. macOS only: the injector is
    // PDFKit (ADR-PDF3). Elsewhere the PDF ships without an outline, which is
    // a documented gap rather than a failure — so this is not an error path.
    #[cfg(target_os = "macos")]
    if let Some(ref headings) = headings {
        if !headings.is_empty() {
            if let Err(e) = super::bookmarks::add_bookmarks(&output_path, headings) {
                log::warn!("[PDF] bookmark injection failed (PDF still valid): {}", e);
                // Don't fail the export — PDF is still valid without bookmarks
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = &headings;

    Ok(())
}

/// Print HTML content via native macOS print dialog.
///
/// Creates an off-screen WKWebView, loads the HTML, and shows the
/// system print dialog. The user selects a printer and prints directly.
#[tauri::command]
pub async fn print_document(app: tauri::AppHandle, html: String) -> Result<(), CommandError> {
    renderer::print_document(app, html).await
}
