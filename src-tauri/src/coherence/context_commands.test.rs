// WI-2b.7 — context commands: list/create/enforce over manifests, and
// context-aware breakdown projection (design-2a.md D1; spec §6 rev 1).

use super::*;
use crate::coherence::contexts::{ContextSet, DEFAULT_CONTEXT_ID};
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::WriterId;
use uuid::Uuid;

fn workspace() -> (tempfile::TempDir, WorkspaceKernel) {
    let td = tempfile::tempdir().expect("tempdir");
    let kernel = WorkspaceKernel::open(td.path(), WriterId(Uuid::now_v7())).expect("kernel");
    (td, kernel)
}

#[test]
fn list_always_includes_the_implicit_default() {
    let (_td, mut kernel) = workspace();
    let rows = perform_contexts_list(&mut kernel).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, DEFAULT_CONTEXT_ID);
    assert_eq!(rows[0].enforcement, "greenhouse");
}

#[test]
fn create_writes_a_greenhouse_manifest_and_lists_it() {
    let (_td, mut kernel) = workspace();
    let receipt = perform_context_create(&mut kernel, "night-arc", None).unwrap();
    let rows = perform_contexts_list(&mut kernel).unwrap();
    assert_eq!(rows.len(), 2);
    let row = rows.iter().find(|r| r.id == receipt.id).unwrap();
    assert_eq!(row.name, "night-arc");
    assert_eq!(row.enforcement, "greenhouse", "D1.4: greenhouse by default");
}

#[test]
fn create_rejects_blank_and_duplicate_names() {
    let (_td, mut kernel) = workspace();
    assert!(perform_context_create(&mut kernel, "  ", None).is_err());
    perform_context_create(&mut kernel, "arc", None).unwrap();
    let err = perform_context_create(&mut kernel, "arc", None).unwrap_err();
    assert!(err.contains("exists"), "{err}");
}

#[test]
fn enforce_toggle_rewrites_the_manifest() {
    let (td, mut kernel) = workspace();
    let receipt = perform_context_create(&mut kernel, "canon", None).unwrap();
    perform_context_enforce(&mut kernel, receipt.id, true).unwrap();
    let set = ContextSet::load(&td.path().join(".vmark/contexts"));
    assert_eq!(
        set.manifests.get(&receipt.id).unwrap().enforcement,
        crate::coherence::contexts::Enforcement::Enforcing
    );
    // The implicit default cannot be enforced (it has no manifest owner
    // semantics for constraints — create a named context instead).
    let err = perform_context_enforce(&mut kernel, DEFAULT_CONTEXT_ID, true).unwrap_err();
    assert!(err.contains("default"), "{err}");
}

#[test]
fn enforce_unknown_context_fails_loud() {
    let (_td, mut kernel) = workspace();
    let err = perform_context_enforce(&mut kernel, Uuid::now_v7(), true).unwrap_err();
    assert!(err.contains("unknown"), "{err}");
}

// ── WI-3.6: branch-mapped contexts (D3 — explicit acts, no magic) ───────

fn git(dir: &std::path::Path, args: &[&str]) {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@t")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@t")
        .output()
        .expect("git runs");
    assert!(out.status.success(), "{:?}", out);
}

fn git_workspace() -> (tempfile::TempDir, WorkspaceKernel) {
    let (td, kernel) = workspace();
    git(td.path(), &["init", "-q", "-b", "night-arc"]);
    std::fs::write(td.path().join("seed.md"), "x\n").unwrap();
    git(td.path(), &["add", "."]);
    git(td.path(), &["commit", "-q", "-m", "seed"]);
    (td, kernel)
}

#[test]
fn create_from_branch_maps_and_candidate_finds_it() {
    let (_td, mut kernel) = git_workspace();
    assert!(
        perform_branch_candidate(&mut kernel).unwrap().is_none(),
        "no mapping yet"
    );
    let receipt = perform_context_create_from_branch(&mut kernel).unwrap();
    let c = perform_branch_candidate(&mut kernel)
        .unwrap()
        .expect("candidate");
    assert_eq!(c.branch, "night-arc");
    assert_eq!(c.context, Some(receipt.id));
    assert!(!c.ambiguous);
}

#[test]
fn ambiguous_mappings_are_surfaced_never_guessed() {
    let (td, mut kernel) = git_workspace();
    perform_context_create_from_branch(&mut kernel).unwrap();
    // A second context mapping the same branch (hand-edited manifest).
    let r2 = perform_context_create(&mut kernel, "rival", None).unwrap();
    let dir = td.path().join(".vmark/contexts");
    let set = ContextSet::load(&dir);
    let mut m = set.manifests.get(&r2.id).unwrap().clone();
    m.git_branch = Some("night-arc".into());
    crate::coherence::contexts::write_manifest(&dir, &m).unwrap();
    let c = perform_branch_candidate(&mut kernel)
        .unwrap()
        .expect("candidate");
    assert!(c.ambiguous);
    assert!(c.context.is_none());
}

#[test]
fn detached_head_and_plain_dirs_yield_no_candidate() {
    let (td, mut kernel) = git_workspace();
    perform_context_create_from_branch(&mut kernel).unwrap();
    let head = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(td.path())
        .output()
        .unwrap();
    let head = String::from_utf8_lossy(&head.stdout).trim().to_string();
    git(td.path(), &["checkout", "-q", &head]);
    assert!(
        perform_branch_candidate(&mut kernel).unwrap().is_none(),
        "detached"
    );

    let (_td2, mut plain) = workspace();
    assert!(
        perform_branch_candidate(&mut plain).unwrap().is_none(),
        "no git"
    );
    assert!(perform_context_create_from_branch(&mut plain).is_err());
}

#[test]
fn branch_mapping_survives_manifest_rewrite() {
    let (td, mut kernel) = git_workspace();
    let receipt = perform_context_create_from_branch(&mut kernel).unwrap();
    // An unrelated rewrite (enforce toggle) must not drop the mapping.
    perform_context_enforce(&mut kernel, receipt.id, true).unwrap();
    let set = ContextSet::load(&td.path().join(".vmark/contexts"));
    assert_eq!(
        set.manifests
            .get(&receipt.id)
            .unwrap()
            .git_branch
            .as_deref(),
        Some("night-arc")
    );
}
