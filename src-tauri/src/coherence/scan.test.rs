// WI-1.6 (WI-1.6b observed-external adapter) — scan reconciliation,
// table-driven over the spec §9.4 state
// machine: unchanged / external modify / rename / delete+restore /
// unknown-id adoption / duplicate IDs / invalid UTF-8 / symlinks /
// no-identity files, plus real-git navigation (no minting) and revert
// (git-attributed mutation) integration.

use super::*;
use crate::coherence::capture::{capture, CaptureRequest};
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::{Agent, AgentType, Confidence, Intent, TypedBody, WriterId};
use std::path::Path;

fn workspace() -> (tempfile::TempDir, WorkspaceKernel) {
    let dir = tempfile::tempdir().unwrap();
    let kernel = WorkspaceKernel::open(dir.path(), WriterId(uuid::Uuid::from_u128(1))).unwrap();
    (dir, kernel)
}

fn write_file(root: &Path, rel: &str, content: &str) {
    let abs = root.join(rel);
    std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
    std::fs::write(abs, content).unwrap();
}

fn captured_doc(kernel: &mut WorkspaceKernel, root: &Path, rel: &str, body: &str) -> String {
    write_file(root, rel, body);
    let receipt = capture(
        kernel,
        CaptureRequest {
            path: rel.into(),
            content: body.into(),
            inputs: vec![],
            agent: Agent {
                kind: AgentType::Human,
                id: None,
            },
            intent: Intent {
                kind: "editor-save".into(),
                summary: "save".into(),
                prompt_hash: None,
            },
            confidence: Confidence::Exact,
            rewrite_identity: true,
            idem: None,
        },
    )
    .unwrap();
    receipt
        .content_with_identity
        .unwrap_or_else(|| body.to_string())
}

#[test]
fn unchanged_files_produce_nothing() {
    let (dir, mut kernel) = workspace();
    captured_doc(&mut kernel, dir.path(), "a.md", "alpha\n");
    let before = kernel.ledger().read_all().unwrap().entries.len();
    let report = scan_workspace(&mut kernel).unwrap();
    assert_eq!(report.external_edits, 0);
    assert_eq!(report.adopted, 0);
    assert_eq!(kernel.ledger().read_all().unwrap().entries.len(), before);
}

#[test]
fn external_modify_synthesizes_observed_external() {
    let (dir, mut kernel) = workspace();
    let with_id = captured_doc(&mut kernel, dir.path(), "a.md", "alpha\n");
    // vim-style edit outside VMark:
    write_file(dir.path(), "a.md", &with_id.replace("alpha", "ALPHA"));
    let report = scan_workspace(&mut kernel).unwrap();
    assert_eq!(report.external_edits, 1);
    // The synthesized transformation is honest: external, unknown, no inputs.
    let entries = kernel.ledger().read_all().unwrap().entries;
    let last = entries.last().unwrap().typed().unwrap();
    match last {
        TypedBody::Transformation(t) => {
            assert_eq!(t.agent.kind, AgentType::External);
            assert_eq!(t.confidence, Confidence::Unknown);
            assert!(t.inputs.is_empty());
        }
        other => panic!("expected transformation, got {other:?}"),
    }
    // Idempotent: a second scan finds known content.
    let again = scan_workspace(&mut kernel).unwrap();
    assert_eq!(again.external_edits, 0);
}

#[test]
fn rename_updates_registry_without_minting() {
    let (dir, mut kernel) = workspace();
    let with_id = captured_doc(&mut kernel, dir.path(), "old.md", "content\n");
    std::fs::rename(dir.path().join("old.md"), dir.path().join("moved.md")).unwrap();
    let _ = with_id;
    let report = scan_workspace(&mut kernel).unwrap();
    assert_eq!(report.external_edits, 0, "same content: no revision");
    let registry = kernel.index().registry_state().unwrap();
    assert!(registry.object_at.contains_key("moved.md"));
}

#[test]
fn delete_marks_absent_and_restore_revives() {
    let (dir, mut kernel) = workspace();
    // scene depends on elena; delete elena; breakdown hides the edge.
    let elena = captured_doc(&mut kernel, dir.path(), "elena.md", "elena-v1\n");
    write_file(dir.path(), "scene.md", "scene\n");
    capture(
        &mut kernel,
        CaptureRequest {
            path: "scene.md".into(),
            content: "scene\n".into(),
            inputs: vec![crate::coherence::capture::CaptureInputSpec {
                path: Some("elena.md".into()),
                object_id: None,
                revision: None,
                role: crate::coherence::types::InputRole::Direct,
                kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
            }],
            agent: Agent {
                kind: AgentType::Model,
                id: Some("m".into()),
            },
            intent: Intent {
                kind: "genie".into(),
                summary: "s".into(),
                prompt_hash: None,
            },
            confidence: Confidence::Exact,
            rewrite_identity: true,
            idem: None,
        },
    )
    .unwrap();
    // Advance elena so the edge is stale, then delete her file.
    let elena_v2 = elena.replace("elena-v1", "elena-v2");
    write_file(dir.path(), "elena.md", &elena_v2);
    scan_workspace(&mut kernel).unwrap();
    assert_eq!(
        kernel
            .index()
            .breakdown("2026-07-18T12:00:00Z")
            .unwrap()
            .len(),
        1
    );

    std::fs::remove_file(dir.path().join("elena.md")).unwrap();
    let report = scan_workspace(&mut kernel).unwrap();
    assert_eq!(report.absent_marked, 1);
    assert!(
        kernel
            .index()
            .breakdown("2026-07-18T12:00:00Z")
            .unwrap()
            .is_empty(),
        "absent objects hidden"
    );

    // Restore: object revives, edge visible again.
    write_file(dir.path(), "elena.md", &elena_v2);
    scan_workspace(&mut kernel).unwrap();
    assert_eq!(
        kernel
            .index()
            .breakdown("2026-07-18T12:00:00Z")
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn unknown_id_file_is_adopted() {
    let (dir, mut kernel) = workspace();
    captured_doc(&mut kernel, dir.path(), "seed.md", "init\n"); // initializes .vmark
    write_file(
        dir.path(),
        "imported.md",
        "---\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7\n---\nimported\n",
    );
    let report = scan_workspace(&mut kernel).unwrap();
    assert_eq!(report.adopted, 1);
    let registry = kernel.index().registry_state().unwrap();
    assert!(registry.object_at.contains_key("imported.md"));
}

#[test]
fn files_without_identity_are_ignored() {
    let (dir, mut kernel) = workspace();
    captured_doc(&mut kernel, dir.path(), "seed.md", "init\n");
    write_file(dir.path(), "notes.md", "no identity here\n");
    let report = scan_workspace(&mut kernel).unwrap();
    assert_eq!(report.adopted, 0);
    assert_eq!(report.external_edits, 0);
}

#[test]
fn duplicate_ids_are_diagnosed_once_and_held() {
    let (dir, mut kernel) = workspace();
    let with_id = captured_doc(&mut kernel, dir.path(), "a.md", "original\n");
    // Copy the file wholesale — classic duplicate-ID case.
    write_file(dir.path(), "z-copy.md", &with_id);
    let report = scan_workspace(&mut kernel).unwrap();
    assert_eq!(report.diagnostics, 1);
    // Once across scans: the ledger gains no second diagnostic.
    let entries_before = kernel.ledger().read_all().unwrap().entries.len();
    let again = scan_workspace(&mut kernel).unwrap();
    assert_eq!(again.diagnostics, 1, "still reported");
    assert_eq!(
        kernel.ledger().read_all().unwrap().entries.len(),
        entries_before,
        "not re-appended"
    );
}

#[test]
fn invalid_utf8_and_symlinks_are_diagnosed_and_skipped() {
    let (dir, mut kernel) = workspace();
    captured_doc(&mut kernel, dir.path(), "seed.md", "init\n");
    std::fs::write(dir.path().join("bad.md"), [0xff, 0xfe, 0x00]).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(dir.path().join("seed.md"), dir.path().join("link.md")).unwrap();
    let report = scan_workspace(&mut kernel).unwrap();
    #[cfg(unix)]
    assert_eq!(report.diagnostics, 2);
    #[cfg(not(unix))]
    assert_eq!(report.diagnostics, 1);
    assert_eq!(report.external_edits, 0);
}

#[test]
fn ignored_directories_are_never_scanned() {
    let (dir, mut kernel) = workspace();
    captured_doc(&mut kernel, dir.path(), "seed.md", "init\n");
    write_file(
        dir.path(),
        ".git/objects/fake.md",
        "---\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c8\n---\nx\n",
    );
    write_file(
        dir.path(),
        "node_modules/pkg/readme.md",
        "---\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c9\n---\ny\n",
    );
    let report = scan_workspace(&mut kernel).unwrap();
    assert_eq!(report.adopted, 0);
}

#[test]
fn cachedir_tagged_directories_are_never_scanned() {
    // F2 (dogfood session 2): build trees like cargo's `target/` carry a
    // standard CACHEDIR.TAG; walking them dominated a 12.4 s M5 on a real
    // repo. The tag is semantically exact — no name-based guessing.
    let (dir, mut kernel) = workspace();
    captured_doc(&mut kernel, dir.path(), "seed.md", "init\n");
    write_file(
        dir.path(),
        "target/CACHEDIR.TAG",
        "Signature: 8a477f597d28d172789f06886806bc55\n",
    );
    write_file(
        dir.path(),
        "target/notes/fake.md",
        "---\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c8\n---\nx\n",
    );
    // An untagged dir with the same name is still scanned (no name-based
    // skipping — a creator may legitimately have a content dir "target").
    write_file(
        dir.path(),
        "sub/target/real.md",
        "---\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c9\n---\ny\n",
    );
    let report = scan_workspace(&mut kernel).unwrap();
    assert_eq!(report.adopted, 1, "only the untagged target/ dir is walked");
}
