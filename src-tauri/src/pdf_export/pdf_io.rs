//! Saving a modified PDF without risking the one already on disk.
//!
//! Purpose: both post-processing steps — the outline and the page numbers —
//! rewrite a PDF the renderer has already produced correctly, and both callers
//! downgrade their failure to a warning so the export still succeeds. That
//! downgrade is only honest while a failure leaves the original intact.
//!
//! `Document::save` truncates its path before serializing, so saving in place
//! would destroy the rendered PDF if anything failed mid-write. This writes
//! beside the target and renames over it.
//!
//! Shared rather than copied: the two callers had identical needs, and a second
//! copy of a security-relevant file dance is how one of them ends up fixed and
//! the other does not.
//!
//! @coordinates-with outline.rs, page_numbers.rs — the two post-processors
//! @module pdf_export/pdf_io

use lopdf::Document;

/// Serialize `doc` over `pdf_path`, atomically.
///
/// `prefix` only distinguishes the scratch file in a directory listing while it
/// briefly exists; the name itself is random.
pub(super) fn save_atomically(
    doc: &mut Document,
    pdf_path: &str,
    prefix: &str,
) -> Result<(), String> {
    let target = std::path::Path::new(pdf_path);
    // Same directory, so `persist` is a same-filesystem rename rather than a
    // copy across devices that can itself fail halfway.
    let dir = target.parent().filter(|d| !d.as_os_str().is_empty());

    // `tempfile`, not a derived name like `x.tmp`. A deterministic name can be
    // pre-created as a symlink, which `File::create` follows straight back onto
    // the target, and two concurrent exports of one document would share it.
    // O_EXCL + 0600, and `TempPath` deletes on drop so no error path leaks it.
    let mut builder = tempfile::Builder::new();
    builder.prefix(prefix).suffix(".pdf");
    let tmp = match dir {
        Some(d) => builder.tempfile_in(d),
        None => builder.tempfile(),
    }
    .map_err(|e| format!("create temp PDF: {e}"))?;

    // Close our handle before lopdf opens the path itself; Windows refuses a
    // rename over a file that still has an open handle.
    let tmp_path = tmp.into_temp_path();
    doc.save(&tmp_path).map_err(|e| format!("save PDF: {e}"))?;
    tmp_path
        .persist(target)
        .map_err(|e| format!("replace PDF: {e}"))?;
    Ok(())
}
