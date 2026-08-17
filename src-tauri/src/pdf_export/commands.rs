//! Tauri commands for PDF export and native printing.

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

use super::heading::Heading;
use super::page_spec::PageSpec;
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

    // A relative path is not merely untidy: WebView2's PrintToPdf requires an
    // absolute result path and returns E_INVALIDARG otherwise, and on macOS the
    // save destination would resolve against the process CWD rather than the
    // directory the user picked.
    if !path.is_absolute() {
        return Err(localized_error!(
            ErrorCode::InvalidInput,
            "errors.pdf.pathNotAbsolute"
        ));
    }

    // An existing DIRECTORY named `x.pdf` passes an extension check and a
    // parent-exists check, then fails deep inside a native print API.
    if path.is_dir() {
        return Err(localized_error!(
            ErrorCode::InvalidInput,
            "errors.pdf.outputIsDirectory"
        ));
    }

    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => {
            if !parent.exists() {
                return Err(localized_error!(
                    ErrorCode::NotFound,
                    "errors.pdf.dirNotFound"
                ));
            }
            // `parent.exists()` is true for a regular FILE too, and the render
            // then starts against a destination that can never be written.
            if !parent.is_dir() {
                return Err(localized_error!(
                    ErrorCode::InvalidInput,
                    "errors.pdf.dirNotFound"
                ));
            }
        }
        _ => {}
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
    page: PageSpec,
) -> Result<(), CommandError> {
    validate_output_path(&output_path)?;
    page.validate()?;

    renderer::render_pdf(app, html, output_path.clone(), page).await?;

    // Add the outline if headings were provided. Cross-platform since the
    // injector became lopdf rather than PDFKit — Windows and Linux used to ship
    // outline-less PDFs (ADR-PDF3).
    //
    // Still not an error path: a PDF without a sidebar is a worse PDF, not a
    // failed export, and refusing the whole job over it would lose the document
    // the user just waited for.
    if let Some(ref headings) = headings {
        if !headings.is_empty() {
            if let Err(e) = super::outline::add_outline(&output_path, headings) {
                log::warn!("[PDF] outline injection failed (PDF still valid): {}", e);
            }
        }
    }

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
