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

/// What the export produced, beyond "it did not fail".
///
/// Post-processing is best-effort — a PDF missing its sidebar or its footer is
/// a worse PDF, not a failed export, and refusing the whole job over one would
/// throw away the document the user just waited for. But returning a bare `Ok`
/// made the UI claim unqualified success while a setting the user explicitly
/// turned on had silently not happened. So the steps that failed are NAMED and
/// the dialog says so.
///
/// Stable slugs, not prose: the frontend maps them to its own translations.
#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOutcome {
    pub warnings: Vec<&'static str>,
}

/// Export HTML content to a PDF file using the platform's native webview.
///
/// Emits `pdf-export-progress` events to the `pdf-export` window
/// with status updates: "loading", "rendering", "done".
///
/// After the render, post-processes the file: heading bookmarks, then page
/// numbers. Both are cross-platform (lopdf) and both are best-effort — see
/// `ExportOutcome`.
#[tauri::command]
pub async fn export_pdf(
    app: tauri::AppHandle,
    html: String,
    output_path: String,
    headings: Option<Vec<Heading>>,
    page: PageSpec,
    page_numbers: Option<super::page_numbers::PageNumberSpec>,
) -> Result<ExportOutcome, CommandError> {
    validate_output_path(&output_path)?;
    page.validate()?;
    // Validated for the same reason `page` is: this arrives as JSON over IPC,
    // so a NaN font size would reach the `Tf` operator as the literal "NaN" and
    // produce a corrupt content stream.
    if let Some(ref spec) = page_numbers {
        spec.validate()?;
    }

    let app_for_progress = app.clone();
    renderer::render_pdf(app, html, output_path.clone(), page).await?;

    // Post-processing is synchronous, CPU-bound and reads/serializes the whole
    // file, so it does not belong on a Tokio worker: a large export would
    // occupy one for the duration and starve unrelated async work in the same
    // runtime. `spawn_blocking` is the thread pool meant for exactly this.
    let outcome = tokio::task::spawn_blocking(move || {
        post_process(&output_path, headings.as_deref(), page_numbers.as_ref())
    })
    .await
    .map_err(|e| {
        localized_error!(
            ErrorCode::Internal,
            "errors.pdf.postProcessPanicked",
            detail = e.to_string()
        )
    })?;

    // Completion is emitted HERE, after the outline and the page numbers, so
    // the stage the user sees matches what the file has.
    renderer::emit_progress(&app_for_progress, "done");

    Ok(outcome)
}

/// Inject the outline, then stamp page numbers. Never fails the export.
///
/// The order is fixed so the two composers each see a complete file, and so a
/// change to one cannot silently reorder the other.
fn post_process(
    output_path: &str,
    headings: Option<&[Heading]>,
    page_numbers: Option<&super::page_numbers::PageNumberSpec>,
) -> ExportOutcome {
    let mut outcome = ExportOutcome::default();

    // Cross-platform since the injector became lopdf rather than PDFKit —
    // Windows and Linux used to ship outline-less PDFs (ADR-PDF3).
    if let Some(headings) = headings.filter(|h| !h.is_empty()) {
        if let Err(e) = super::outline::add_outline(output_path, headings) {
            log::warn!("[PDF] outline injection failed (PDF still valid): {}", e);
            outcome.warnings.push("outline-failed");
        }
    }

    // The write is atomic, so a failure here leaves the rendered PDF exactly as
    // it was — which is what makes "warn and continue" honest rather than lossy.
    if let Some(spec) = page_numbers {
        if let Err(e) = super::page_numbers::stamp_page_numbers(output_path, spec) {
            log::warn!("[PDF] page numbering failed (PDF still valid): {}", e);
            outcome.warnings.push("page-numbers-failed");
        }
    }

    outcome
}

/// Print HTML content via the system print dialog (WI-PDF4.1, all three
/// platforms).
///
/// Renders the HTML in a helper webview and shows the platform's dialog:
/// the NSPrintOperation panel on macOS, WebView2 `ShowPrintUI` on Windows,
/// `webkit_print_operation_run_dialog` on Linux. The helper is hidden on
/// macOS and Linux; on Windows it must stay visible because `ShowPrintUI`
/// draws the print UI inside it.
#[tauri::command]
pub async fn print_document(app: tauri::AppHandle, html: String) -> Result<(), CommandError> {
    renderer::print_document(app, html).await
}
