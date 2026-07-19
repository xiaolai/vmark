// WI-3.7 — the merge banner surface reads the latest merge diagnostic.

use super::*;
use crate::coherence::types::{Envelope, WriterId};
use uuid::Uuid;

fn kernel_with(entries: &[Envelope]) -> (tempfile::TempDir, WorkspaceKernel) {
    let td = tempfile::tempdir().unwrap();
    let mut kernel = WorkspaceKernel::open(td.path(), WriterId(Uuid::now_v7())).unwrap();
    kernel.ensure_initialized().unwrap();
    for e in entries {
        kernel.append_and_apply(e).unwrap();
    }
    (td, kernel)
}

fn merge_diag(sha: &str, time: &str) -> Envelope {
    let mut e = Envelope::new_test(
        "diagnostic",
        serde_json::json!({ "code": "merge-completed", "message": "m", "path": sha }),
    );
    e.time = time.into();
    e
}

#[test]
fn returns_none_without_merges() {
    let (_td, mut kernel) = kernel_with(&[]);
    assert!(perform_recent_merge(&mut kernel).unwrap().is_none());
}

#[test]
fn returns_the_newest_merge_by_reader_order() {
    let (_td, mut kernel) = kernel_with(&[
        merge_diag("sha-old", "2026-07-19T10:00:00Z"),
        merge_diag("sha-new", "2026-07-19T12:00:00Z"),
    ]);
    let notice = perform_recent_merge(&mut kernel).unwrap().unwrap();
    assert_eq!(notice.sha, "sha-new");
}

#[test]
fn ignores_non_merge_diagnostics() {
    let other = {
        let mut e = Envelope::new_test(
            "diagnostic",
            serde_json::json!({ "code": "quarantined-entry", "message": "x", "path": "seg:1" }),
        );
        e.time = "2026-07-19T13:00:00Z".into();
        e
    };
    let (_td, mut kernel) = kernel_with(&[other]);
    assert!(perform_recent_merge(&mut kernel).unwrap().is_none());
}
