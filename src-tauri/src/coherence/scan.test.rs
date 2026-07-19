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

// ── git integration (real repos) ────────────────────────────────────────

fn run_git(dir: &Path, args: &[&str]) {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@t")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@t")
        .output()
        .expect("git runs");
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn git_navigation_never_mints_revisions() {
    let (dir, mut kernel) = workspace();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]);
    let v1 = captured_doc(&mut kernel, root, "a.md", "version-one\n");
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "c1"]);
    let v2 = v1.replace("version-one", "version-two");
    write_file(root, "a.md", &v2);
    capture(
        &mut kernel,
        CaptureRequest {
            path: "a.md".into(),
            content: v2,
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
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "c2"]);

    // Baseline observation, then navigate back in history.
    scan_workspace(&mut kernel).unwrap();
    run_git(root, &["checkout", "-q", "HEAD~1"]);
    let report = scan_workspace(&mut kernel).unwrap();
    assert_eq!(report.navigations, 1, "navigation recorded");
    assert_eq!(
        report.external_edits, 0,
        "NO revision minted from navigation (R18)"
    );
    assert_eq!(report.git_mutations, 0);
    // Note: the checkout also rewound the git-TRACKED ledger segment to
    // its older committed state — absolute entry counts shrink by design
    // (union merge heals across branches). Assert the shape instead:
    // exactly one navigation entry, zero transformations minted by scan.
    let entries = kernel.ledger().read_all().unwrap().entries;
    let navs = entries.iter().filter(|e| e.kind == "navigation").count();
    assert_eq!(navs, 1, "exactly one navigation entry in the ledger");
}

#[test]
fn git_revert_is_captured_as_git_mutation() {
    let (dir, mut kernel) = workspace();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]);
    let v1 = captured_doc(&mut kernel, root, "a.md", "one\n");
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "c1"]);
    let v2 = v1.replace("one", "two");
    write_file(root, "a.md", &v2);
    capture(
        &mut kernel,
        CaptureRequest {
            path: "a.md".into(),
            content: v2,
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
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "c2"]);
    scan_workspace(&mut kernel).unwrap(); // baseline

    run_git(root, &["revert", "--no-edit", "HEAD"]);
    let report = scan_workspace(&mut kernel).unwrap();
    // Spec §9.4 (audit R5/A22): a revert is a MUTATION — even when it
    // restores historical content, a NEW git-attributed revision is
    // minted with the current head as parent (A → B → A ≠ A).
    assert_eq!(report.external_edits, 0);
    assert_eq!(report.git_mutations, 1);
}

#[test]
fn external_a_b_a_edit_mints_a_new_revision() {
    // Spec §2.3 / audit R5: recreating old content by hand is NEW history
    // (same content hash, different parents) — never silently absorbed.
    let (dir, mut kernel) = workspace();
    let v1 = captured_doc(&mut kernel, dir.path(), "a.md", "alpha\n");
    let v2 = v1.replace("alpha", "beta");
    write_file(dir.path(), "a.md", &v2);
    scan_workspace(&mut kernel).unwrap();
    // vim-style revert back to the exact v1 content:
    write_file(dir.path(), "a.md", &v1);
    let report = scan_workspace(&mut kernel).unwrap();
    assert_eq!(report.external_edits, 1, "A->B->A mints, not absorbs");
    // The object now has a LINEAR 3-revision history (v1, v2, v1-again).
    let registry = kernel.index().registry_state().unwrap();
    let object = *registry.object_at.get("a.md").unwrap();
    assert_eq!(kernel.index().heads(&object).unwrap().len(), 1, "no fork");
}

#[test]
fn duplicate_ids_capture_hold_and_release() {
    // Spec §2.1: duplicates hold capture; resolving the set releases it.
    let (dir, mut kernel) = workspace();
    let with_id = captured_doc(&mut kernel, dir.path(), "a.md", "original\n");
    write_file(dir.path(), "z-copy.md", &with_id);
    scan_workspace(&mut kernel).unwrap();
    let registry = kernel.index().registry_state().unwrap();
    let object = *registry.object_at.get("a.md").unwrap();
    assert!(
        kernel.index().is_held(&object).unwrap(),
        "held while duplicated"
    );
    let err = capture(
        &mut kernel,
        CaptureRequest {
            path: "a.md".into(),
            content: with_id.replace("original", "edited"),
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
    .unwrap_err();
    assert!(err.contains("capture-held"), "{err}");
    // Resolve the duplicate: delete the copy; the next scan releases.
    std::fs::remove_file(dir.path().join("z-copy.md")).unwrap();
    scan_workspace(&mut kernel).unwrap();
    assert!(
        !kernel.index().is_held(&object).unwrap(),
        "released after resolution"
    );
}

#[test]
fn capture_rejects_traversal_paths() {
    // Audit R1: the IPC boundary guard.
    let (_dir, mut kernel) = workspace();
    for bad in ["../outside.md", "/etc/passwd", "a\\b.md"] {
        let err = capture(
            &mut kernel,
            CaptureRequest {
                path: (*bad).into(),
                content: "x\n".into(),
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
        );
        assert!(err.is_err(), "{bad:?} must be rejected");
    }
}

#[test]
fn crlf_content_parses_and_hashes_like_lf() {
    // Audit R14c: CRLF from external clients must not duplicate identity
    // blocks or fork hashes.
    let (dir, mut kernel) = workspace();
    let lf = captured_doc(&mut kernel, dir.path(), "a.md", "line one\nline two\n");
    // Re-save the identity-bearing content with CRLF endings:
    let crlf = lf.replace('\n', "\r\n");
    write_file(dir.path(), "a.md", &crlf);
    let receipt = capture(
        &mut kernel,
        CaptureRequest {
            path: "a.md".into(),
            content: crlf,
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
    assert!(
        receipt.entry_id.is_none(),
        "same canonical content = no-op, no fork"
    );
}

// WI-3.7 — completed-merge diagnostic: appended once per merge SHA,
// idempotent across repeated scans; mid-conflict merges defer (D3.3).
#[test]
fn completed_merge_emits_one_deduped_diagnostic() {
    let (dir, mut kernel) = workspace();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]);
    captured_doc(&mut kernel, root, "a.md", "base\n");
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "base"]);
    // A feature branch with its own commit.
    run_git(root, &["checkout", "-q", "-b", "feature"]);
    write_file(root, "b.md", "feature work\n");
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "feature"]);
    // Back to main, make it diverge, then a real (non-fast-forward) merge.
    run_git(root, &["checkout", "-q", "main"]);
    write_file(root, "c.md", "main work\n");
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "main-work"]);
    run_git(
        root,
        &["merge", "-q", "--no-ff", "-m", "merge feature", "feature"],
    );

    // Baseline scan already ran inside captured_doc? Run explicitly.
    let r1 = scan_workspace(&mut kernel).unwrap();
    assert_eq!(r1.merges, 1, "the completed merge is recorded once");
    // A second scan of the same merge is a no-op (idempotent).
    let r2 = scan_workspace(&mut kernel).unwrap();
    assert_eq!(r2.merges, 0, "repeated scan does not re-record");

    // The diagnostic is in the ledger, surfaced pull-only.
    let entries = kernel.ledger().read_all().unwrap().entries;
    let merge_diags = entries
        .iter()
        .filter(|e| e.kind == "diagnostic" && e.body["code"] == "merge-completed")
        .count();
    assert_eq!(merge_diags, 1);
}

#[test]
fn linear_head_emits_no_merge_diagnostic() {
    let (dir, mut kernel) = workspace();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]);
    captured_doc(&mut kernel, root, "a.md", "base\n");
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "base"]);
    let r = scan_workspace(&mut kernel).unwrap();
    assert_eq!(r.merges, 0);
}

#[test]
fn path_under_ignored_dir_edge_cases() {
    // Under an ignored dir (both separators) — true.
    assert!(path_under_ignored_dir("node_modules/lib.md"));
    assert!(path_under_ignored_dir("node_modules\\lib.md")); // audit #3: Windows
    assert!(path_under_ignored_dir("a/.git/config.md"));
    // Not under an ignored dir.
    assert!(!path_under_ignored_dir("notes/lib.md"));
    assert!(!path_under_ignored_dir("node_modules")); // audit #3: leaf, a real file
    assert!(!path_under_ignored_dir("notes/node_modules.md")); // not the segment
    assert!(!path_under_ignored_dir("lib.md"));
}

#[test]
fn registered_path_under_ignored_dir_is_never_marked_absent() {
    // Audit C8: an object registered at a path the walk never descends
    // into (node_modules, .Trash, …) must not be reconciled as deleted —
    // its absence from the walk is not evidence the file is gone.
    let (dir, mut kernel) = workspace();
    captured_doc(&mut kernel, dir.path(), "node_modules/lib.md", "keep\n");
    // The file still exists on disk; the walk simply never visits it.
    let report = scan_workspace(&mut kernel).unwrap();
    assert!(report.complete, "tiny tree walks completely");
    assert_eq!(
        report.absent_marked, 0,
        "an ignored-dir path must never be marked absent"
    );
}
