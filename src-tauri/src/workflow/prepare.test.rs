//! Tests for `prepare.rs` — snapshot targets and the fail-closed snapshot
//! (#262, #266). Loaded via `#[path]`.

use super::*;
use crate::command_error::ErrorCode;
use crate::workflow::types::RawWorkflow;

fn workflow(yaml: &str) -> RawWorkflow {
    serde_yaml_ng::from_str(yaml).expect("test workflow parses")
}

#[test]
fn only_save_file_steps_with_a_path_are_snapshot_targets() {
    let wf = workflow(
        "name: T\nsteps:\n\
         \x20 - id: read\n    uses: action/read-file\n    with:\n      path: in.md\n\
         \x20 - id: save\n    uses: action/save-file\n    with:\n      path: out/a.md\n      input: x\n\
         \x20 - id: abs\n    uses: action/save-file\n    with:\n      path: /elsewhere/b.md\n      input: x\n\
         \x20 - id: nopath\n    uses: action/save-file\n    with:\n      input: x\n\
         \x20 - id: say\n    uses: action/notify\n",
    );
    let ws = Path::new("/ws");
    assert_eq!(
        snapshot_targets(&wf, ws),
        vec![
            PathBuf::from("/ws/out/a.md"),
            PathBuf::from("/elsewhere/b.md")
        ]
    );
}

// ── #264: a caller-supplied execution id is validated once, at entry ────────

#[test]
fn a_missing_execution_id_is_minted_as_a_uuid() {
    let id = execution_id_for(None).expect("minted");
    assert_eq!(id.len(), 36, "{id}");
    assert!(
        execution_id_for(Some(id.clone())).is_ok(),
        "what we mint passes our own validation: {id}"
    );
}

#[test]
fn execution_ids_are_bounded_ascii_alphanumerics_dashes_and_underscores() {
    for ok in ["550e8400-e29b-41d4-a716-446655440000", "run_1", "A"] {
        assert_eq!(
            execution_id_for(Some(ok.to_string())).expect(ok),
            ok,
            "a valid id travels unchanged"
        );
    }
    execution_id_for(Some("x".repeat(64))).expect("64 is the last accepted length");
    let too_long = "x".repeat(65);
    for bad in [
        "",
        " ",
        "../escape",
        "a/b",
        "id with space",
        "ünïcode",
        too_long.as_str(),
    ] {
        let err = execution_id_for(Some(bad.to_string())).expect_err(bad);
        assert_eq!(err.code(), ErrorCode::InvalidInput, "{bad:?}");
        assert!(
            err.message().contains("invalid execution id"),
            "{bad:?}: {}",
            err.message()
        );
    }
}

// ── #265: app data is resolved only when there is something to snapshot ─────

#[test]
fn an_action_only_workflow_never_asks_for_the_app_data_dir() {
    let resolver = || -> Result<PathBuf, String> { panic!("must not be consulted") };
    assert_eq!(
        snapshot_root(&[], resolver).expect("nothing to snapshot"),
        None
    );
}

#[test]
fn a_file_modifying_workflow_refuses_with_io_when_app_data_is_unavailable() {
    let files = vec![PathBuf::from("out.md")];
    let err = snapshot_root(&files, || Err("no home".to_string())).expect_err("unavailable");
    assert_eq!(err.code(), ErrorCode::Io);
    assert_eq!(
        err.i18n_key(),
        Some("errors.workflow.appDataDirUnavailable")
    );
    let dir = snapshot_root(&files, || Ok(PathBuf::from("/data"))).expect("resolved");
    assert_eq!(dir, Some(PathBuf::from("/data")));
}

#[tokio::test]
async fn nothing_to_snapshot_passes_without_touching_the_filesystem() {
    let never = Path::new("/definitely/not/an/app/data/dir");
    snapshot_or_refuse(never, "exec-1", &[], Path::new("/ws"), &|| false)
        .await
        .expect("no files, no snapshot, no error");
    assert!(!never.exists());
}

#[tokio::test]
async fn a_snapshot_that_cannot_be_written_refuses_the_run() {
    // #266: the workflow used to run anyway, with its destructive steps
    // stripped of the recovery the design promises.
    let ws = tempfile::tempdir().expect("workspace");
    let target = ws.path().join("doc.md");
    std::fs::write(&target, "original").expect("write");
    let scratch = tempfile::tempdir().expect("scratch");
    // A FILE where the app data directory should be: no snapshot dir can be
    // created under it.
    let not_a_dir = scratch.path().join("app-data");
    std::fs::write(&not_a_dir, "squatter").expect("write");

    let err = snapshot_or_refuse(&not_a_dir, "exec-1", &[target], ws.path(), &|| false)
        .await
        .expect_err("the snapshot cannot be written");
    assert_eq!(err.code(), ErrorCode::Io);
    assert_eq!(err.i18n_key(), Some("errors.workflow.snapshotFailed"));
    assert!(
        err.message().contains("snapshot"),
        "names the snapshot: {}",
        err.message()
    );
}

#[tokio::test]
async fn a_snapshot_that_can_be_written_admits_the_run() {
    let ws = tempfile::tempdir().expect("workspace");
    let target = ws.path().join("doc.md");
    std::fs::write(&target, "original").expect("write");
    let app_data = tempfile::tempdir().expect("app data");
    snapshot_or_refuse(app_data.path(), "exec-2", &[target], ws.path(), &|| false)
        .await
        .expect("snapshot written");
    assert!(
        app_data
            .path()
            .join("workflow-snapshots")
            .join("snap-exec-2")
            .is_dir(),
        "the snapshot directory exists"
    );
}

// #550 — the refusal must not be a way past the limit it enforces. Echoing the
// whole id turned a megabyte-long id into a megabyte-long error message, sent
// over IPC and written to the log.
#[test]
fn a_hugely_oversized_id_is_refused_without_being_copied_into_the_message() {
    let huge = "x".repeat(100_000);
    let err = execution_id_for(Some(huge.clone())).expect_err("over the cap");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert!(
        err.message().len() < 400,
        "the message is bounded, got {} bytes",
        err.message().len()
    );
    assert!(
        err.message().contains("100000 characters"),
        "{}",
        err.message()
    );
    assert!(!err.message().contains(&huge), "the id is not echoed whole");
}

// A short bad id is still quoted in full — the preview only truncates what is
// long enough to need it.
#[test]
fn a_short_invalid_id_is_still_named_in_full() {
    let err = execution_id_for(Some("has spaces".into())).expect_err("bad alphabet");
    assert!(err.message().contains("has spaces"), "{}", err.message());
}

// #552 — the same file written twice is one snapshot. Copying it per STEP
// charged it twice against the snapshot's size and count limits, so a workflow
// could be refused for a budget it did not need.
#[test]
fn a_target_written_by_two_steps_is_snapshotted_once() {
    let ws = tempfile::tempdir().expect("workspace");
    let yaml = "name: twice\nsteps:\n  - uses: action/save-file\n    with:\n      path: out.md\n      input: a\n  - uses: action/save-file\n    with:\n      path: out.md\n      input: b\n  - uses: action/save-file\n    with:\n      path: other.md\n      input: c\n";
    let workflow: RawWorkflow = serde_yaml_ng::from_str(yaml).expect("parses");
    let targets = snapshot_targets(&workflow, ws.path());
    assert_eq!(targets.len(), 2, "{targets:?}");
    assert_eq!(targets[0], ws.path().join("out.md"), "order is preserved");
    assert_eq!(targets[1], ws.path().join("other.md"));
}

// ── #267: the snapshot observes the cancel flag while it copies ──────────────

// #555 — and it is reported as a CANCEL, not as an I/O failure. The stop
// arrives from `should_stop` as an `Err` like any other, so the user who
// pressed Cancel was told their snapshot had failed and the log recorded a
// filesystem failure that never happened. The FLAG decides, not the message.
#[tokio::test]
async fn a_cancel_raised_during_the_snapshot_is_reported_as_a_cancel() {
    let ws = tempfile::tempdir().expect("workspace");
    let target = ws.path().join("doc.md");
    std::fs::write(&target, vec![b'z'; 3 * 1024 * 1024]).expect("write");
    let app_data = tempfile::tempdir().expect("app data");
    // Already cancelled when the copy starts: observed before the first chunk.
    let err = snapshot_or_refuse(app_data.path(), "exec-3", &[target], ws.path(), &|| true)
        .await
        .expect_err("cancelled");
    assert_eq!(err.code(), ErrorCode::Cancelled);
    assert!(err.message().contains("cancelled"), "{}", err.message());
}

// A snapshot that fails while NOTHING was cancelled is still an I/O refusal:
// the flag is what tells the two apart, so both directions are pinned.
#[tokio::test]
async fn a_snapshot_that_fails_with_no_cancel_is_still_an_io_refusal() {
    let ws = tempfile::tempdir().expect("workspace");
    let target = ws.path().join("doc.md");
    std::fs::write(&target, "original").expect("write");
    // A file where the snapshot root has to be a directory.
    let app_data = tempfile::tempdir().expect("app data");
    std::fs::write(app_data.path().join("workflow-snapshots"), "not a dir").expect("write");
    let err = snapshot_or_refuse(app_data.path(), "exec-3b", &[target], ws.path(), &|| false)
        .await
        .expect_err("cannot create the snapshot root");
    assert_eq!(err.code(), ErrorCode::Io);
    assert_eq!(err.i18n_key(), Some("errors.workflow.snapshotFailed"));
}

// ── #264: a snapshot directory is created once ───────────────────────────────

#[tokio::test]
async fn a_second_snapshot_under_the_same_execution_id_is_refused() {
    let ws = tempfile::tempdir().expect("workspace");
    let target = ws.path().join("doc.md");
    std::fs::write(&target, "original").expect("write");
    let app_data = tempfile::tempdir().expect("app data");
    snapshot_or_refuse(
        app_data.path(),
        "exec-4",
        std::slice::from_ref(&target),
        ws.path(),
        &|| false,
    )
    .await
    .expect("first snapshot");
    let err = snapshot_or_refuse(app_data.path(), "exec-4", &[target], ws.path(), &|| false)
        .await
        .expect_err("the id's directory already exists");
    assert_eq!(err.code(), ErrorCode::Io);
    assert!(
        err.message().contains("already exists") || err.message().contains("snapshot"),
        "{}",
        err.message()
    );
}

/// #549 — the entry point and the snapshot layer enforce ONE id rule.
///
/// The two used to carry their own copies of the length cap and the alphabet.
/// Both are path-safety rules about the same string — the id names a snapshot
/// DIRECTORY — so a drift in either direction is a real hazard: an id this
/// gate accepts and `create_snapshot` refuses fails a run after admission,
/// and an id this gate refuses that the snapshot layer would have accepted is
/// a needless refusal. Nothing here can drift now, and this is what says so.
#[test]
fn the_execution_id_gate_accepts_exactly_what_the_snapshot_layer_accepts() {
    let cases = [
        "",
        "a",
        &"x".repeat(super::super::snapshots::MAX_ID_LEN),
        &"x".repeat(super::super::snapshots::MAX_ID_LEN + 1),
        "has spaces",
        "../escape",
        "a/b",
        "a.b",
        "under_score-and-dash-09",
        "\u{4f60}\u{597d}",
    ];
    for case in cases {
        assert_eq!(
            execution_id_for(Some(case.to_string())).is_ok(),
            super::super::snapshots::validate_id(case).is_ok(),
            "the two id rules disagree about {case:?}"
        );
    }
}
