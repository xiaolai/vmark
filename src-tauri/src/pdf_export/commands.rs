//! Tauri commands for PDF export and native printing.

use super::{bookmarks, renderer};
use std::path::Path;

/// Export HTML content to a PDF file using WKWebView.
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
    headings: Option<Vec<bookmarks::Heading>>,
) -> Result<(), String> {
    // Validate output path
    let path = Path::new(&output_path);

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    if !ext.eq_ignore_ascii_case("pdf") {
        return Err(rust_i18n::t!("errors.pdf.invalidExtension").to_string());
    }

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(rust_i18n::t!("errors.pdf.dirNotFound").to_string());
        }
    }

    renderer::render_pdf(app, html, output_path.clone()).await?;

    // Add bookmarks if headings were provided
    if let Some(ref headings) = headings {
        if !headings.is_empty() {
            if let Err(e) = bookmarks::add_bookmarks(&output_path, headings) {
                log::warn!("[PDF] bookmark injection failed (PDF still valid): {}", e);
                // Don't fail the export — PDF is still valid without bookmarks
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
pub async fn print_document(app: tauri::AppHandle, html: String) -> Result<(), String> {
    renderer::print_document(app, html).await
}
