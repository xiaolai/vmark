//! The staging file a render writes, published onto the output only on a
//! delivered success.
//!
//! Purpose: the platforms used to print straight to the caller's output
//! path. A render that outlived its caller's timeout — WebView2's
//! `PrintToPdf` and WebKitGTK's `print` complete on their own schedule, and
//! nothing cancels them — then wrote that path AFTER the command had reported
//! failure, on top of whatever a retry had just produced. Rendering to a
//! sibling file nobody else names, and renaming it into place only once the
//! outcome has been DELIVERED, means the output path changes on a confirmed
//! success and at no other moment; a late writer only ever fills a file the
//! sink deletes on arrival (`sink.rs`).
//!
//! A sibling, not a `temp_dir()` file: `rename` must not cross a filesystem,
//! and the output directory is the one place already validated to exist —
//! which on macOS is also what keeps AppKit from spooling the document to a
//! printer (`mod.rs`).
//!
//! `remove_temp` lives here too: it is how every private file of a render —
//! the temp document and this staging file — is deleted, by the sink, the
//! wait and the publish alike.
//!
//! @coordinates-with sink.rs — removes the file on every path but a delivered Ok
//! @coordinates-with wait.rs — publishes it on that path
//! @coordinates-with atomic_persist.rs — the directory sync that makes the rename durable
//! @module pdf_export/renderer/staging

use std::path::{Path, PathBuf};

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

/// A fresh sibling of `output` for the platform to write: same directory,
/// `.pdf` extension (the macOS re-validation in `mod.rs` requires one on what
/// AppKit is handed), and a name no other render can produce.
pub(super) fn staging_path_for(output: &Path) -> PathBuf {
    let stem = output
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("export");
    output.with_file_name(format!(
        "{stem}.vmark-staging-{}.pdf",
        uuid::Uuid::new_v4().simple()
    ))
}

/// Move the finished render onto the output path, replacing whatever was
/// there — one rename, so the output is never observable half-written.
///
/// The move is made durable, because the output is the user's file: the
/// render's bytes are synced before the rename and the output's directory
/// after it. Without the first a crash can leave an empty PDF under the new
/// name; without the second it can bring the previous one back. Both are
/// best-effort and logged — a filesystem that refuses a sync has still been
/// given a complete file.
///
/// On failure the staging file is removed and the previous output, if any,
/// is left exactly as it was; the error names the OS's reason.
pub(super) fn publish(staging: &Path, output: &Path) -> Result<(), CommandError> {
    sync_contents(staging);
    match std::fs::rename(staging, output) {
        Ok(()) => {
            crate::atomic_persist::sync_parent_directory(output);
            Ok(())
        }
        Err(e) => {
            remove_temp(staging);
            // `publishFailed`, not `staleOutputNotRemoved`. This rename is the PUBLICATION, and it fails for reasons
            // that have nothing to do with a previous file: a full disk, a
            // read-only directory, a staging file the sink already deleted.
            // Naming the old output was a diagnosis the code never made, and it
            // sent the reader to delete a file that was often not the problem.
            Err(localized_error!(
                ErrorCode::Io,
                "errors.pdf.publishFailed",
                detail = e.to_string()
            ))
        }
    }
}

/// Flush the render to disk. Opened for writing: Windows flushes only through
/// a handle that may write. A file that cannot be opened is left for the
/// rename to report.
fn sync_contents(staging: &Path) {
    let synced = std::fs::OpenOptions::new()
        .write(true)
        .open(staging)
        .and_then(|file| file.sync_all());
    match synced {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            log::warn!("[PDF] could not sync the render {staging:?} before publishing it: {e}")
        }
    }
}

/// Delete a render's private file, logging a failure rather than swallowing it.
///
/// The temp HTML holds the user's entire document and the staging PDF its
/// rendered form. A silent `let _ =` meant a failure to remove either left
/// that content on disk with no diagnostic anywhere — the deletion looked
/// done because nothing said otherwise.
pub(super) fn remove_temp(path: &Path) {
    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => log::warn!("[PDF] could not remove temp file {:?}: {e}", path),
    }
}

#[cfg(test)]
#[path = "staging.test.rs"]
mod tests;
