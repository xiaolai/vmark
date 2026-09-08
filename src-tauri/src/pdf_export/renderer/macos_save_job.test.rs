//! Tests for the pure halves of `macos_save_job.rs` (#212, #214): the stale
//! output check and the PDF verification. The native wait is measured by the
//! pdf-smoke harness, which renders on the real print pipeline.

use super::*;
use crate::command_error::ErrorCode;

#[test]
fn a_missing_output_is_fine_and_a_present_one_is_removed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("out.pdf");
    clear_stale_output(path.to_str().unwrap()).expect("nothing there");
    std::fs::write(&path, "stale").expect("write");
    clear_stale_output(path.to_str().unwrap()).expect("removed");
    assert!(!path.exists());
}

#[test]
fn a_stale_output_that_cannot_be_removed_is_an_io_error_not_a_pass() {
    // A directory at the output path refuses `remove_file`; validation rejects
    // one before the render, so this is the shape of "could not remove",
    // which used to be swallowed and then read back as the export.
    let dir = tempfile::tempdir().expect("tempdir");
    let err = clear_stale_output(dir.path().to_str().unwrap()).expect_err("cannot remove");
    assert_eq!(err.code(), ErrorCode::Io);
    assert_eq!(err.i18n_key(), Some("errors.pdf.staleOutputNotRemoved"));
}

#[test]
fn a_pdf_passes_and_is_left_in_place() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("out.pdf");
    std::fs::write(
        &path,
        b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\ntrailer\nstartxref\n9\n%%EOF\n",
    )
    .expect("write");
    verify_pdf(&path).expect("a PDF");
    assert!(path.exists());
}

// #434 — the five header bytes are written before anything else, so a print
// that died partway through passed a check named `verify_pdf`. `%%EOF` is what
// says the writer finished, and it is the marker every reader looks for.
#[test]
fn a_truncated_pdf_is_refused_and_removed_rather_than_reported_as_the_export() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("out.pdf");
    std::fs::write(&path, b"%PDF-").expect("write");
    let err = verify_pdf(&path).expect_err("five bytes are not a document");
    assert_eq!(err.i18n_key(), Some("errors.pdf.outputNotPdf"));
    assert!(!path.exists(), "a half-written export is not left behind");

    // Nor is a plausible-looking body that simply stops.
    let mut body = b"%PDF-1.4\n".to_vec();
    body.extend(std::iter::repeat_n(b'x', 4096));
    std::fs::write(&path, &body).expect("write");
    assert!(verify_pdf(&path).is_err(), "no trailer, no export");
}

// The trailer is looked for in a WINDOW at the end, not in the whole file: a
// large document must not be read into memory to be checked.
#[test]
fn a_large_pdf_is_verified_from_its_ends_alone() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("big.pdf");
    let mut body = b"%PDF-1.7\n".to_vec();
    body.extend(std::iter::repeat_n(b'x', 512 * 1024));
    body.extend_from_slice(b"\nstartxref\n17\n%%EOF\n");
    std::fs::write(&path, &body).expect("write");
    verify_pdf(&path).expect("a complete PDF");
}

#[test]
fn an_empty_or_missing_output_is_reported_as_empty_and_removed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("out.pdf");
    let err = verify_pdf(&path).expect_err("missing");
    assert_eq!(err.i18n_key(), Some("errors.pdf.emptyOutput"));
    std::fs::write(&path, b"").expect("write");
    let err = verify_pdf(&path).expect_err("empty");
    assert_eq!(err.i18n_key(), Some("errors.pdf.emptyOutput"));
    assert!(!path.exists(), "an empty output is removed");
}

#[test]
fn a_non_pdf_output_is_refused_and_removed() {
    // #214: after the old deadline any non-empty file was accepted — this is
    // the file that check would have called an export.
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("out.pdf");
    std::fs::write(&path, b"<html>error page</html>").expect("write");
    let err = verify_pdf(&path).expect_err("not a PDF");
    assert_eq!(err.code(), ErrorCode::Io);
    assert_eq!(err.i18n_key(), Some("errors.pdf.outputNotPdf"));
    assert!(!path.exists());
    // Shorter than the magic, too.
    std::fs::write(&path, b"%PD").expect("write");
    assert_eq!(
        verify_pdf(&path).expect_err("truncated").i18n_key(),
        Some("errors.pdf.outputNotPdf")
    );
}

/// #433 — a file that cannot be EXAMINED is not an empty one.
///
/// Every open/read failure used to collapse into `PdfShape::Empty`, so a
/// permission failure was reported as "print operation produced empty PDF" —
/// a cause the code never observed — and `verify_pdf` then tried to delete a
/// file it had not been able to open. The file must survive: nothing here
/// knows whether it holds the user's document.
#[cfg(unix)]
#[test]
fn an_unreadable_output_is_reported_as_unreadable_and_left_on_disk() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("out.pdf");
    std::fs::write(
        &path,
        b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\ntrailer\nstartxref\n9\n%%EOF\n",
    )
    .expect("write");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).expect("chmod");

    // Running as root defeats the mode; skip rather than assert a falsehood.
    if std::fs::File::open(&path).is_ok() {
        return;
    }

    let err = verify_pdf(&path).expect_err("an unopenable file is not a verified PDF");
    assert_eq!(err.code(), ErrorCode::Io);
    assert_eq!(
        err.i18n_key(),
        Some("errors.pdf.outputUnreadable"),
        "reporting `emptyOutput` here names a cause that was never observed"
    );
    assert!(
        path.exists(),
        "a file that could not even be opened must not be deleted"
    );

    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).expect("restore");
}

/// A genuinely ABSENT output is still `emptyOutput` — the split above must not
/// reclassify the case the message was written for.
#[test]
fn a_missing_output_is_still_reported_as_empty() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("never-written.pdf");
    let err = verify_pdf(&path).expect_err("nothing was produced");
    assert_eq!(err.i18n_key(), Some("errors.pdf.emptyOutput"));
}
