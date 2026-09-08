// #224 — the render writes a sibling and only a delivered success moves it
// onto the output path.

use super::*;
use crate::command_error::ErrorCode;

#[test]
fn the_staging_file_is_a_pdf_sibling_of_the_output() {
    let output = Path::new("/exports/Report.pdf");
    let staging = staging_path_for(output);
    assert_eq!(
        staging.parent(),
        output.parent(),
        "rename must not cross a filesystem"
    );
    assert_eq!(staging.extension().and_then(|e| e.to_str()), Some("pdf"));
    assert_ne!(staging, output);
    let name = staging
        .file_name()
        .and_then(|n| n.to_str())
        .expect("utf-8 name");
    assert!(name.starts_with("Report.vmark-staging-"), "got {name}");
}

#[test]
fn two_renders_of_one_output_never_share_a_staging_file() {
    // Two exports to the same path — the race #198 names — each render into
    // their own sibling; only the renames touch the shared name.
    let output = Path::new("/exports/Report.pdf");
    assert_ne!(staging_path_for(output), staging_path_for(output));
}

#[test]
fn publishing_moves_the_render_onto_the_output_and_replaces_a_stale_one() {
    let dir = tempfile::tempdir().expect("tempdir");
    let output = dir.path().join("out.pdf");
    std::fs::write(&output, b"stale").expect("write stale output");
    let staging = staging_path_for(&output);
    std::fs::write(&staging, b"%PDF-fresh").expect("write staging");

    publish(&staging, &output).expect("publish");

    assert_eq!(std::fs::read(&output).expect("read output"), b"%PDF-fresh");
    assert!(!staging.exists(), "moved, not copied");
}

#[test]
fn a_failed_publish_removes_the_staging_file_and_keeps_the_old_output() {
    let dir = tempfile::tempdir().expect("tempdir");
    let staging = dir.path().join("Report.vmark-staging-x.pdf");
    std::fs::write(&staging, b"%PDF-fresh").expect("write staging");
    // A destination whose directory does not exist cannot be renamed into.
    let output = dir.path().join("gone").join("Report.pdf");

    let err = publish(&staging, &output).expect_err("rename into a missing dir fails");

    assert_eq!(err.code(), ErrorCode::Io);
    // `publishFailed`, not `staleOutputNotRemoved` (audit 20260907 #446). This
    // fixture is the argument: the rename fails because the destination's
    // DIRECTORY does not exist, and there is no existing output here at all —
    // so the old key named a stale file that was never there, and sent the
    // reader to delete something to fix a missing directory. The assertion is
    // two-sided because the wrong key was what the previous version pinned.
    assert_eq!(err.i18n_key(), Some("errors.pdf.publishFailed"));
    assert_ne!(err.i18n_key(), Some("errors.pdf.staleOutputNotRemoved"));
    // The OS's reason must SURVIVE into the message rather than be swallowed —
    // asserted against the OS's own words for this exact failure, obtained by
    // reproducing the identical rename, instead of against one platform's
    // wording. `"No such file"` is what macOS and Linux say; Windows says
    // "The system cannot find the path specified. (os error 3)".
    let probe = dir.path().join("Report.vmark-staging-probe.pdf");
    std::fs::write(&probe, b"%PDF-probe").expect("write probe");
    let os_reason = std::fs::rename(&probe, &output)
        .expect_err("the same rename must fail the same way")
        .to_string();
    // Without this, a reason that came back empty would make the check below
    // `contains("")` — trivially true, and green forever.
    assert!(
        !os_reason.is_empty(),
        "the probe produced no reason to match"
    );
    assert!(
        err.message().contains(&os_reason),
        "the OS reason must survive: {} (expected to contain {os_reason:?})",
        err.message()
    );
    assert!(!staging.exists(), "no stray sibling after a failed publish");
    assert!(!output.exists());
}
