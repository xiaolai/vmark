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
