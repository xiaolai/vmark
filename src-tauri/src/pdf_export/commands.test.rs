// WI-PDF1.2 — output-path validation returns TYPED errors.
//
// The point of the conversion is that the frontend branches on `code` instead
// of matching message text. A test asserting only "an error came back" would
// pass equally against the old `Result<T, String>`, so every case pins a CODE.

use super::commands::validate_output_path;
use crate::command_error::ErrorCode;

/// An absolute path, on this platform, whose parent does not exist.
///
/// A literal POSIX root is NOT absolute on Windows — `Path::new("/x/y.pdf")
/// .is_absolute()` is false there, because a leading separator with no drive
/// letter is root-RELATIVE. Hardcoding one made three tests fail on Windows
/// only, the moment validation started requiring an absolute path. Deriving
/// from `temp_dir()` gives a genuinely absolute root everywhere.
fn missing_dir_path(name: &str) -> String {
    std::env::temp_dir()
        .join("vmark-definitely-not-here")
        .join(name)
        .to_string_lossy()
        .into_owned()
}

/// An absolute path in a directory that DOES exist, for extension tests.
fn existing_dir_path(name: &str) -> String {
    std::env::temp_dir()
        .join(name)
        .to_string_lossy()
        .into_owned()
}

#[test]
fn a_non_pdf_extension_is_invalid_input() {
    let err = validate_output_path(&existing_dir_path("out.txt"))
        .expect_err("a .txt path must be refused");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(err.i18n_key(), Some("errors.pdf.invalidExtension"));
}

#[test]
fn a_missing_extension_is_refused_too() {
    let err = validate_output_path(&existing_dir_path("no-extension"))
        .expect_err("a bare name must be refused");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
}

#[test]
fn the_extension_check_is_case_insensitive() {
    // `.PDF` is a real thing users type; refusing it would be a defect, so
    // this asserts the extension rule does NOT fire — the failure that does
    // arrive is about the directory.
    let err = validate_output_path(&missing_dir_path("o.PDF"))
        .expect_err("the parent directory does not exist");
    assert_eq!(
        err.code(),
        ErrorCode::NotFound,
        "must fail on the missing directory, not on the uppercase extension"
    );
}

#[test]
fn a_missing_output_directory_is_not_found() {
    let err = validate_output_path(&missing_dir_path("out.pdf"))
        .expect_err("a missing parent must be refused");
    assert_eq!(err.code(), ErrorCode::NotFound);
    assert_eq!(err.i18n_key(), Some("errors.pdf.dirNotFound"));
}

#[test]
fn the_two_failures_do_not_share_a_code() {
    let ext = validate_output_path(&existing_dir_path("a.txt")).expect_err("bad extension");
    let dir = validate_output_path(&missing_dir_path("a.pdf")).expect_err("bad directory");
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

// --- Destination shapes that used to pass validation and fail natively ---

#[test]
fn a_relative_path_is_refused() {
    // WebView2's PrintToPdf requires an absolute result path and returns
    // E_INVALIDARG otherwise; on macOS a relative path resolves against the
    // process CWD rather than the directory the user chose in the save panel.
    let err = validate_output_path("out.pdf").expect_err("a relative path must be refused");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(err.i18n_key(), Some("errors.pdf.pathNotAbsolute"));
}

#[test]
fn a_directory_named_like_a_pdf_is_refused() {
    // Passes an extension check and a parent-exists check, then fails deep
    // inside a native print API with an error the user cannot act on.
    let dir = std::env::temp_dir().join("vmark-validate-dir-test.pdf");
    std::fs::create_dir_all(&dir).expect("create test dir");
    let err = validate_output_path(&dir.to_string_lossy())
        .expect_err("an existing directory must be refused");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(err.i18n_key(), Some("errors.pdf.outputIsDirectory"));
    let _ = std::fs::remove_dir(&dir);
}

#[test]
fn a_parent_that_is_a_regular_file_is_refused() {
    // `parent.exists()` is true for a FILE, so the render used to start against
    // a destination that could never be written.
    let file = std::env::temp_dir().join("vmark-validate-parent-test");
    std::fs::write(&file, b"x").expect("create test file");
    let target = file.join("out.pdf");
    let err = validate_output_path(&target.to_string_lossy())
        .expect_err("a file as parent must be refused");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    let _ = std::fs::remove_file(&file);
}

#[test]
fn a_sane_absolute_path_is_accepted() {
    let ok = std::env::temp_dir().join("vmark-validate-ok.pdf");
    validate_output_path(&ok.to_string_lossy()).expect("a normal destination must pass");
}
