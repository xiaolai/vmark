//! Tests for workflow file snapshots (create/restore critical path).
//!
//! Security coverage (audit g3-rust-rest): hostile execution ids embedded in
//! filesystem paths, and snapshot inputs outside the workspace sandbox.

use super::*;
use std::path::PathBuf;
use tempfile::tempdir;

fn ws_file(ws: &std::path::Path, rel: &str, content: &str) -> PathBuf {
    let p = ws.join(rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(&p, content).unwrap();
    p
}

// -- #264: an execution id is used ONCE ------------------------------------

/// The DURABLE half of the reuse guard. `RecentExecutionIds` remembers the
/// last 256 ids in memory, which forgets across a restart and past the cap;
/// the snapshot directory is the guard that does neither, because it is on
/// disk. A repeated id must not write this run's files over — or among —
/// an earlier run's.
#[tokio::test]
async fn a_second_snapshot_for_the_same_execution_id_is_refused_and_leaves_the_first_intact() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let file = ws_file(ws.path(), "a.md", "first run");
    create_snapshot(
        app_data.path(),
        "run-1",
        std::slice::from_ref(&file),
        ws.path(),
    )
    .await
    .expect("the first run snapshots");

    std::fs::write(&file, "second run").unwrap();
    let err = create_snapshot(
        app_data.path(),
        "run-1",
        std::slice::from_ref(&file),
        ws.path(),
    )
    .await
    .expect_err("the id is spent");
    assert!(err.contains("already exists"), "got: {err}");

    let saved = app_data
        .path()
        .join("workflow-snapshots")
        .join("snap-run-1")
        .join("a.md");
    assert_eq!(
        std::fs::read_to_string(&saved).unwrap(),
        "first run",
        "the earlier run's snapshot must survive the repeat"
    );
}

/// The refusal survives a restart: it is a directory on disk, not a memory
/// of ids, so a fresh process with an empty `RecentExecutionIds` still
/// refuses an id whose snapshot is already there.
#[tokio::test]
async fn the_refusal_does_not_depend_on_any_in_memory_memory_of_ids() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let file = ws_file(ws.path(), "a.md", "x");
    // Nothing in this process ever saw `run-2`; the directory alone decides.
    std::fs::create_dir_all(
        app_data
            .path()
            .join("workflow-snapshots")
            .join("snap-run-2"),
    )
    .unwrap();
    let err = create_snapshot(app_data.path(), "run-2", &[file], ws.path())
        .await
        .expect_err("a snapshot directory already carries this id");
    assert!(err.contains("already exists"), "got: {err}");
}

// -- execution id validation (path traversal) -------------------------------

#[tokio::test]
async fn create_rejects_execution_id_with_path_separator() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let file = ws_file(ws.path(), "a.md", "x");
    let result = create_snapshot(app_data.path(), "a/../../evil", &[file], ws.path()).await;
    assert!(result.is_err(), "expected Err, got {:?}", result);
}

#[tokio::test]
async fn create_rejects_execution_id_with_dotdot() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let file = ws_file(ws.path(), "a.md", "x");
    let result = create_snapshot(app_data.path(), "..", &[file], ws.path()).await;
    assert!(result.is_err(), "expected Err, got {:?}", result);
}

#[tokio::test]
async fn create_rejects_empty_and_oversized_execution_id() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let file = ws_file(ws.path(), "a.md", "x");
    assert!(
        create_snapshot(app_data.path(), "", std::slice::from_ref(&file), ws.path())
            .await
            .is_err()
    );
    let long_id = "a".repeat(200);
    assert!(
        create_snapshot(app_data.path(), &long_id, &[file], ws.path())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn create_accepts_uuid_and_fallback_id_shapes() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let file = ws_file(ws.path(), "a.md", "x");
    // crypto.randomUUID() shape
    assert!(create_snapshot(
        app_data.path(),
        "123e4567-e89b-42d3-a456-426614174000",
        std::slice::from_ref(&file),
        ws.path()
    )
    .await
    .is_ok());
    // `${Date.now()}-${rand36}` fallback shape
    assert!(create_snapshot(
        app_data.path(),
        "1751414400000-k3j2h1g0f",
        &[file],
        ws.path()
    )
    .await
    .is_ok());
}

#[tokio::test]
async fn restore_rejects_hostile_snapshot_id() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let result = restore_snapshot(app_data.path(), "../../../etc", ws.path()).await;
    assert!(result.is_err(), "expected Err, got {:?}", result);
}

// -- sandbox validation of snapshot inputs -----------------------------------

#[tokio::test]
async fn create_skips_files_outside_workspace() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let secret = outside.path().join("secret.txt");
    std::fs::write(&secret, "top secret").unwrap();

    let id = create_snapshot(
        app_data.path(),
        "exec-1",
        std::slice::from_ref(&secret),
        ws.path(),
    )
    .await
    .unwrap();

    let meta_path = app_data
        .path()
        .join("workflow-snapshots")
        .join(&id)
        .join("metadata.json");
    let info: SnapshotInfo =
        serde_json::from_str(&std::fs::read_to_string(&meta_path).unwrap()).unwrap();
    assert!(
        info.files.is_empty(),
        "outside file must not be snapshotted"
    );
    assert!(
        info.created_files.is_empty(),
        "outside file must not be tracked for deletion"
    );
}

#[tokio::test]
async fn create_skips_traversal_paths() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let parent_file = ws.path().parent().unwrap().join("escape-target.txt");
    // A path that lexically traverses out of the workspace.
    let hostile = ws.path().join("../escape-target.txt");
    std::fs::write(&parent_file, "outside").unwrap();

    let id = create_snapshot(app_data.path(), "exec-2", &[hostile], ws.path())
        .await
        .unwrap();

    let meta_path = app_data
        .path()
        .join("workflow-snapshots")
        .join(&id)
        .join("metadata.json");
    let info: SnapshotInfo =
        serde_json::from_str(&std::fs::read_to_string(&meta_path).unwrap()).unwrap();
    assert!(info.files.is_empty());
    assert!(info.created_files.is_empty());
    let _ = std::fs::remove_file(&parent_file);
}

#[cfg(unix)]
#[tokio::test]
async fn create_skips_symlink_escape() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let secret = outside.path().join("secret.txt");
    std::fs::write(&secret, "top secret").unwrap();
    let link = ws.path().join("link.txt");
    std::os::unix::fs::symlink(&secret, &link).unwrap();

    let id = create_snapshot(app_data.path(), "exec-3", &[link], ws.path())
        .await
        .unwrap();

    let meta_path = app_data
        .path()
        .join("workflow-snapshots")
        .join(&id)
        .join("metadata.json");
    let info: SnapshotInfo =
        serde_json::from_str(&std::fs::read_to_string(&meta_path).unwrap()).unwrap();
    assert!(
        info.files.is_empty(),
        "symlink escape must not be snapshotted"
    );
}

// -- create/restore roundtrip -------------------------------------------------

#[tokio::test]
async fn roundtrip_restores_modified_file() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let file = ws_file(ws.path(), "notes/doc.md", "original");

    let id = create_snapshot(
        app_data.path(),
        "exec-4",
        std::slice::from_ref(&file),
        ws.path(),
    )
    .await
    .unwrap();
    assert_eq!(id, "snap-exec-4");

    std::fs::write(&file, "modified").unwrap();
    restore_snapshot(app_data.path(), &id, ws.path())
        .await
        .unwrap();
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "original");
}

#[tokio::test]
async fn restore_deletes_files_created_by_workflow() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let new_file = ws.path().join("generated.md");
    assert!(!new_file.exists());

    let id = create_snapshot(
        app_data.path(),
        "exec-5",
        std::slice::from_ref(&new_file),
        ws.path(),
    )
    .await
    .unwrap();

    // Workflow "creates" the file.
    std::fs::write(&new_file, "generated content").unwrap();
    restore_snapshot(app_data.path(), &id, ws.path())
        .await
        .unwrap();
    assert!(
        !new_file.exists(),
        "created file must be deleted on restore"
    );
}

#[tokio::test]
async fn restore_missing_snapshot_errors() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let result = restore_snapshot(app_data.path(), "snap-does-not-exist", ws.path()).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn nested_paths_preserved_in_snapshot() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let a = ws_file(ws.path(), "dir1/same.md", "one");
    let b = ws_file(ws.path(), "dir2/same.md", "two");

    let id = create_snapshot(
        app_data.path(),
        "exec-6",
        &[a.clone(), b.clone()],
        ws.path(),
    )
    .await
    .unwrap();

    std::fs::write(&a, "changed-one").unwrap();
    std::fs::write(&b, "changed-two").unwrap();
    restore_snapshot(app_data.path(), &id, ws.path())
        .await
        .unwrap();
    assert_eq!(std::fs::read_to_string(&a).unwrap(), "one");
    assert_eq!(std::fs::read_to_string(&b).unwrap(), "two");
}
