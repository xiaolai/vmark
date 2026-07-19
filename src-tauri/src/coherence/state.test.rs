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
fn open_heals_a_torn_ledger_entry_into_a_loaded_index() {
    // Simulate a hard crash between the ledger append (durable, fsync'd) and the
    // index apply (SQLite): the entry lives in the ledger but never reached the
    // persisted index. On the next open a schema-valid index.db is LOADED, not
    // rebuilt — heal-on-open must reconcile it so the torn entry is not lost.
    let dir = tmp();
    let torn_idem;
    {
        let mut kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
        kernel.ensure_initialized().unwrap();
        // One normally-applied entry, so index.db is persisted + non-empty.
        let e1 = Envelope::create(
            "diagnostic",
            writer(1),
            json!({ "code": "a", "message": "applied", "path": null }),
        );
        kernel.append_and_apply(&e1).unwrap();
        // A second entry that reaches the LEDGER ONLY (the torn-crash window).
        let e2 = Envelope::create(
            "diagnostic",
            writer(1),
            json!({ "code": "b", "message": "torn", "path": null }),
        );
        torn_idem = e2.idem;
        kernel.ledger().append(&e2).unwrap();
        assert!(
            kernel
                .index()
                .entry_id_by_idem(&torn_idem)
                .unwrap()
                .is_none(),
            "precondition: the live index has not applied the torn entry",
        );
    }
    // Reopen: index.db is schema-valid → loaded, not rebuilt. Heal-on-open must
    // catch it up against the ledger.
    let kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
    assert!(
        kernel
            .index()
            .entry_id_by_idem(&torn_idem)
            .unwrap()
            .is_some(),
        "heal-on-open must reconcile the torn ledger entry into the loaded index",
    );
}

#[test]
fn open_skips_reconcile_when_the_index_is_caught_up() {
    // The cheap probe: a caught-up single-writer index (raw line count ==
    // applied count) needs no reconcile. We can't observe timing here, but we
    // assert the outcome is stable — reopening a caught-up workspace is a no-op.
    let dir = tmp();
    let idem;
    {
        let mut kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
        kernel.ensure_initialized().unwrap();
        let e = Envelope::create(
            "diagnostic",
            writer(1),
            json!({ "code": "a", "message": "applied", "path": null }),
        );
        idem = e.idem;
        kernel.append_and_apply(&e).unwrap();
    }
    let kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
    assert!(kernel.index().entry_id_by_idem(&idem).unwrap().is_some());
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

#[test]
fn snapshot_read_surfaces_missing_and_corrupt_as_diagnostics() {
    // Spec §4.3: a missing or hash-mismatched snapshot surfaces a
    // diagnostic and an explicit error — never silently empty content.
    use crate::coherence::canonical::text_content_hash;
    let dir = tmp();
    let mut kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
    kernel.ensure_initialized().unwrap();
    let hash = text_content_hash("never stored\n");
    let err = kernel.read_snapshot(&hash).unwrap_err();
    assert!(err.contains("missing"), "{err}");
    // Corrupt: store then tamper.
    let stored = kernel.snapshots().put_text("real content\n").unwrap();
    std::fs::write(kernel.snapshots().path_for(&stored), b"tampered").unwrap();
    let err = kernel.read_snapshot(&stored).unwrap_err();
    assert!(err.contains("corrupt"), "{err}");
    let diag_count = kernel
        .ledger()
        .read_all()
        .unwrap()
        .entries
        .iter()
        .filter(|e| e.kind == "diagnostic")
        .count();
    assert_eq!(diag_count, 2, "both failures recorded durably");
}
