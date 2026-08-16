// WI-PDF1.2 — output-path validation returns TYPED errors.
//
// The point of the conversion is that the frontend branches on `code` instead
// of matching message text. A test asserting only "an error came back" would
// pass equally against the old `Result<T, String>`, so every case pins a CODE.

use super::commands::validate_output_path;
use crate::command_error::ErrorCode;

#[test]
fn a_non_pdf_extension_is_invalid_input() {
    let err = validate_output_path("/tmp/out.txt").expect_err("a .txt path must be refused");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(err.i18n_key(), Some("errors.pdf.invalidExtension"));
}

#[test]
fn a_missing_extension_is_refused_too() {
    let err = validate_output_path("/tmp/no-extension").expect_err("a bare name must be refused");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
}

#[test]
fn the_extension_check_is_case_insensitive() {
    // `.PDF` is a real thing users type; refusing it would be a defect, so
    // this asserts the extension rule does NOT fire — the failure that does
    // arrive is about the directory.
    let err = validate_output_path("/definitely/not/here/o.PDF")
        .expect_err("the parent directory does not exist");
    assert_eq!(
        err.code(),
        ErrorCode::NotFound,
        "must fail on the missing directory, not on the uppercase extension"
    );
}

#[test]
fn a_missing_output_directory_is_not_found() {
    let err = validate_output_path("/definitely/not/here/out.pdf")
        .expect_err("a missing parent must be refused");
    assert_eq!(err.code(), ErrorCode::NotFound);
    assert_eq!(err.i18n_key(), Some("errors.pdf.dirNotFound"));
}

#[test]
fn the_two_failures_do_not_share_a_code() {
    let ext = validate_output_path("/tmp/a.txt").expect_err("bad extension");
    let dir = validate_output_path("/definitely/not/here/a.pdf").expect_err("bad directory");
    assert_ne!(
        ext.code(),
        dir.code(),
        "distinct codes are the whole point — same code means the frontend is \
         back to reading messages"
    );
}

#[test]
fn a_writable_directory_with_a_pdf_extension_passes() {
    let dir = tempfile::tempdir().expect("tempdir");
    let out = dir.path().join("fine.pdf");
    assert!(validate_output_path(&out.to_string_lossy()).is_ok());
}
