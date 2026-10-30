//! Export targets — the save-panel choices `export_pdf`, `export_via_pandoc`
//! and `content_server_slidev_export` may write to.
//!
//! Purpose: these commands write a file at a path that arrives over IPC. A path
//! is not consent: any app webview could name `~/.zshrc.pdf` or an existing
//! `.docx` and have it overwritten. So the path must be one the USER chose, in
//! a native save panel Rust itself showed (`commands::pick_export_target`), for
//! the webview that now asks to write it. The panel's answer is recorded here;
//! the export command spends it.
//!
//! Key decisions:
//!   - Keyed by webview label: a choice made in the Export PDF window cannot be
//!     spent by a document window, and vice versa.
//!   - One choice per webview, one-shot. A later pick replaces an earlier one;
//!     spending it removes it — whether or not the request matched. A request
//!     naming any other path is a script, not the dialog's own export, so the
//!     choice it tried to bend is withdrawn (fail closed).
//!   - The PDF `.pdf` suffix is added HERE, before recording: the panel shows
//!     no file-type filter (macOS 26 rejects typed input under one), so a bare
//!     name comes back bare, and the path returned must be the path permitted.
//!   - Memory only, managed state (rule 50 §10). A choice never survives the
//!     process.
//!
//! @coordinates-with export_target/commands.rs — shows the panel and records its answer
//! @coordinates-with pdf_export/commands.rs — `export_pdf` spends a choice
//! @coordinates-with pandoc/commands.rs — `export_via_pandoc` spends a choice
//! @coordinates-with content_server/slidev_commands.rs — `content_server_slidev_export` spends a choice
//! @module export_target

pub mod commands;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{Manager, Runtime};
use tauri_plugin_dialog::FilePath;
use tokio::sync::oneshot;

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

/// Which export the panel is choosing a destination for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExportTargetKind {
    /// `export_pdf`: the chosen path is given a `.pdf` suffix when it lacks one.
    Pdf,
    /// `export_via_pandoc`: recorded as picked; the extension selects the format.
    Pandoc,
    /// `content_server_slidev_export`: recorded as picked; the extension
    /// selects the format (`.pdf`, `.png`, `.pptx`).
    Slidev,
}

/// The outstanding save-panel choice of each webview.
#[derive(Debug, Default)]
pub struct ExportTargets {
    chosen: Mutex<HashMap<String, PathBuf>>,
}

impl ExportTargets {
    /// Record `path` as `owner`'s choice, replacing any earlier one.
    pub fn record(&self, owner: &str, path: PathBuf) -> Result<(), CommandError> {
        self.lock()?.insert(owner.to_owned(), path);
        Ok(())
    }

    /// Spend `owner`'s choice: `Ok` only when it is exactly `requested`.
    /// The choice is removed either way.
    pub fn take(&self, owner: &str, requested: &str) -> Result<(), CommandError> {
        let chosen = self.lock()?.remove(owner);
        match chosen {
            Some(chosen) if chosen == Path::new(requested) => Ok(()),
            _ => Err(localized_error!(
                ErrorCode::PermissionDenied,
                "errors.exportTarget.notChosen"
            )),
        }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, PathBuf>>, CommandError> {
        self.chosen
            .lock()
            .map_err(|_| CommandError::internal("export target registry poisoned"))
    }
}

/// Spend the calling webview's choice through the app's managed registry.
/// The one call every export command makes before writing anything.
pub fn claim<R: Runtime>(
    app: &tauri::AppHandle<R>,
    owner: &str,
    requested: &str,
) -> Result<(), CommandError> {
    app.try_state::<ExportTargets>()
        .ok_or_else(|| {
            CommandError::internal("ExportTargets is not managed — register it in lib.rs")
        })?
        .take(owner, requested)
}

/// Everything after the panel answers: `None` is a cancel; a path is
/// normalized for `kind`, recorded for `owner`, and returned.
pub(crate) fn settle(
    targets: &ExportTargets,
    owner: &str,
    kind: ExportTargetKind,
    answer: Result<Option<FilePath>, oneshot::error::RecvError>,
) -> Result<Option<String>, CommandError> {
    let Some(picked) =
        answer.map_err(|_| CommandError::internal("the save dialog closed without an answer"))?
    else {
        return Ok(None);
    };
    let picked = picked
        .into_path()
        .map_err(|e| CommandError::invalid_input(format!("unusable save location: {e}")))?;
    if !picked.is_absolute() {
        return Err(CommandError::invalid_input(
            "the save location is not absolute",
        ));
    }
    let path = match kind {
        ExportTargetKind::Pdf => with_pdf_extension(picked),
        ExportTargetKind::Pandoc | ExportTargetKind::Slidev => picked,
    };
    // Returned as a string the frontend sends back verbatim, so a lossy
    // conversion would make the returned path differ from the recorded one.
    let text = path
        .to_str()
        .ok_or_else(|| CommandError::invalid_input("the save location is not valid UTF-8"))?
        .to_owned();
    targets.record(owner, path)?;
    Ok(Some(text))
}

/// `report` → `report.pdf`; `Report.PDF` stays. Appended to the whole name, as
/// the dialog always did, so `notes.txt` becomes `notes.txt.pdf`.
fn with_pdf_extension(path: PathBuf) -> PathBuf {
    let has_pdf = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("pdf"));
    if has_pdf {
        return path;
    }
    let mut name = path.into_os_string();
    name.push(".pdf");
    PathBuf::from(name)
}

#[cfg(test)]
#[path = "mod.test.rs"]
mod tests;
