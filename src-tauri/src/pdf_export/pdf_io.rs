//! Saving a modified PDF without risking the one already on disk.
//!
//! Purpose: both post-processing steps — the outline and the page numbers —
//! rewrite a PDF the renderer has already produced correctly, and both callers
//! downgrade their failure to a warning so the export still succeeds. That
//! downgrade is only honest while a failure leaves the original intact.
//!
//! `Document::save` truncates its path before serializing, so saving in place
//! would destroy the rendered PDF if anything failed mid-write.
//!
//! **This delegates to `crate::atomic_replace` rather than doing its own
//! temp-file dance**, and that is the whole point of the module. The hand-rolled
//! version was missing three things the shared core already had, each fixed
//! once before elsewhere: it did not preserve the target's permission bits (so
//! replacing a PDF reset it to the temp file's 0600 on Unix), it did not
//! `sync_all` before the rename (so a crash could expose an unsynced file), and
//! it called `into_temp_path()` — closing the securely created handle and
//! letting `Document::save` REOPEN that path by name, a window in which the
//! path can be swapped for a symlink. Writing through the still-open handle
//! closes that window. `atomic_replace` also carries the Windows
//! remove-then-retry fallback, which is deliberately NOT applied on Unix.
//!
//! It uses the STREAMING form (`atomic_replace_with`), so the PDF is written
//! straight into the temp file rather than serialized to a buffer first — a
//! document embedding every image in the export should not need a second full
//! copy in memory just to be handed to the writer.
//!
//! @coordinates-with atomic_replace.rs — the shared temp-file/fsync/rename core
//! @coordinates-with outline.rs, page_numbers.rs — the two post-processors
//! @module pdf_export/pdf_io

use lopdf::Document;

use crate::atomic_replace::{atomic_replace_with, AtomicReplaceError};

/// Serialize `doc` over `pdf_path`, atomically.
pub(super) fn save_atomically(doc: &mut Document, pdf_path: &str) -> Result<(), String> {
    let target = std::path::Path::new(pdf_path);
    // The target was just written by the renderer, so its parent exists. A path
    // with no parent component means the current directory, not an error.
    let parent = target
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."));

    // STREAMED into the temp file, not serialized to a `Vec` first. `save_to`
    // takes a `Write`, so buffering the whole PDF only to hand it over would
    // hold a second full copy of a document that can carry every image in the
    // export as an embedded object.
    atomic_replace_with(target, parent, |temp| {
        doc.save_to(temp)
            .map_err(|e| std::io::Error::other(format!("serialize PDF: {e}")))
    })
    .map_err(describe)
}

/// Name the stage that failed, so the caller's warning says which one.
fn describe(e: AtomicReplaceError) -> String {
    match e {
        AtomicReplaceError::CreateTemp { parent, source } => {
            format!("create temp PDF in {}: {source}", parent.display())
        }
        AtomicReplaceError::WriteTemp(e) => format!("write temp PDF: {e}"),
        AtomicReplaceError::FlushTemp(e) => format!("flush temp PDF: {e}"),
        AtomicReplaceError::SyncTemp(e) => format!("sync temp PDF: {e}"),
        AtomicReplaceError::Persist(e) => format!("replace PDF: {e}"),
    }
}
