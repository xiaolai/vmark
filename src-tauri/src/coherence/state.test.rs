// WI-1.12 — workspace kernel lifecycle: lazy .vmark creation (never on
// open), init file contents, open-with-rebuild from an existing ledger,
// single shared instance per workspace, and writer-id persistence.

use super::*;
use crate::coherence::types::Envelope;
use serde_json::json;

fn tmp() -> tempfile::TempDir {
    tempfile::tempdir().expect("tempdir")
}

fn writer(n: u128) -> WriterId {
    WriterId(uuid::Uuid::from_u128(n))
}

#[test]
fn open_never_creates_vmark() {
    let dir = tmp();
    let kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
    assert!(!kernel.is_initialized());
    assert!(
        !dir.path().join(".vmark").exists(),
        "mere open must not initialize (spec §1)"
    );
}

#[test]
fn ensure_initialized_creates_structure_and_git_files() {
    let dir = tmp();
    let mut kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
    kernel.ensure_initialized().unwrap();
    let vmark = dir.path().join(".vmark");
    assert!(vmark.join("ledger").is_dir());
    assert!(vmark.join("snapshots").is_dir());
    assert_eq!(
        std::fs::read_to_string(vmark.join(".gitignore")).unwrap(),
        "index.db*\n"
    );
    assert_eq!(
        std::fs::read_to_string(vmark.join(".gitattributes")).unwrap(),
        "ledger/*.jsonl merge=union\n"
    );
    // Idempotent.
    kernel.ensure_initialized().unwrap();
    assert!(kernel.is_initialized());
}

#[test]
fn append_and_apply_then_reopen_rebuilds_from_ledger() {
    let dir = tmp();
    {
        let mut kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
        kernel.ensure_initialized().unwrap();
        let e = Envelope::create(
            "diagnostic",
            writer(1),
            json!({ "code": "t", "message": "persisted" }),
        );
        kernel.append_and_apply(&e).unwrap();
    }
    // Delete the index: reopen must rebuild silently from the ledger (R16).
    std::fs::remove_file(dir.path().join(".vmark").join("index.db")).unwrap();
    let kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
    assert!(kernel.is_initialized());
    assert_eq!(kernel.ledger().read_all().unwrap().entries.len(), 1);
}

#[test]
fn registry_shares_one_kernel_per_root() {
    let dir = tmp();
    let registry = KernelRegistry::default();
    let a = registry.kernel_for(dir.path(), writer(1)).unwrap();
    let b = registry.kernel_for(dir.path(), writer(1)).unwrap();
    assert!(
        Arc::ptr_eq(&a, &b),
        "one instance per workspace (spec §5.1)"
    );
}

#[test]
fn registry_rejects_missing_root() {
    let registry = KernelRegistry::default();
    assert!(registry
        .kernel_for(Path::new("/nonexistent/nowhere"), writer(1))
        .is_err());
}

#[test]
fn writer_id_persists_across_loads() {
    let dir = tmp();
    let first = load_or_create_writer_id(dir.path()).unwrap();
    let second = load_or_create_writer_id(dir.path()).unwrap();
    assert_eq!(first, second);
}

#[test]
fn corrupt_writer_id_file_is_replaced() {
    let dir = tmp();
    std::fs::write(dir.path().join("coherence-writer-id"), "not-a-uuid").unwrap();
    let id = load_or_create_writer_id(dir.path()).unwrap();
    let reloaded = load_or_create_writer_id(dir.path()).unwrap();
    assert_eq!(id, reloaded);
}
