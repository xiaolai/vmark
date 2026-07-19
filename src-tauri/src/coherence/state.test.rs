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
fn open_reconcile_is_a_noop_when_caught_up() {
    // A caught-up index reopens unchanged — the winner-map reconcile finds the
    // index already equals the ledger, so it does not rebuild-away the entry.
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
fn open_reconciles_when_the_ledger_is_replaced_at_equal_count() {
    // Re-review #1/#2: reconcile on IDENTITY, not cardinality. A git branch
    // switch REPLACES the tracked ledger with a same-count-but-different history
    // while the gitignored index.db persists. Heal-on-open must swap the index
    // to the ledger's actual entry, even though both have exactly one entry.
    let dir = tmp();
    let a_idem;
    let seg_path;
    {
        let mut kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
        kernel.ensure_initialized().unwrap();
        let a = Envelope::create(
            "diagnostic",
            writer(1),
            json!({ "code": "a", "message": "branch-A", "path": null }),
        );
        a_idem = a.idem;
        kernel.append_and_apply(&a).unwrap();
        seg_path = kernel.ledger().active_segment_path_for_test();
    }
    // Replace the single-entry ledger with a DIFFERENT single entry B.
    let b = Envelope::create(
        "diagnostic",
        writer(1),
        json!({ "code": "b", "message": "branch-B", "path": null }),
    );
    let b_idem = b.idem;
    let mut line = serde_json::to_string(&b).unwrap();
    line.push('\n');
    std::fs::write(&seg_path, line).unwrap();

    let kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
    assert!(
        kernel.index().entry_id_by_idem(&b_idem).unwrap().is_some(),
        "heal-on-open reconciled to the ledger's actual entry B",
    );
    assert!(
        kernel.index().entry_id_by_idem(&a_idem).unwrap().is_none(),
        "the stale index entry A (absent from the new ledger) is gone",
    );
}

#[test]
fn an_append_failure_reconciles_and_asks_for_retry_without_losing_state() {
    // Re-review #3: an ambiguous append failure must not leave the index behind
    // the ledger. Force `ledger.append` to fail (read-only ledger dir), and
    // assert the kernel reconciles + reports a retryable error, with the earlier
    // committed entry still intact (not lost, not double-counted).
    use std::os::unix::fs::PermissionsExt;
    let dir = tmp();
    let mut kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
    kernel.ensure_initialized().unwrap();
    let first = Envelope::create(
        "diagnostic",
        writer(1),
        json!({ "code": "a", "message": "kept", "path": null }),
    );
    let first_idem = first.idem;
    kernel.append_and_apply(&first).unwrap();

    // Make the active segment FILE read-only so the next append cannot write it
    // (a read-only dir would still allow appending an existing file).
    let seg = kernel.ledger().active_segment_path_for_test();
    let mut perms = std::fs::metadata(&seg).unwrap().permissions();
    perms.set_mode(0o444);
    std::fs::set_permissions(&seg, perms).unwrap();

    let second = Envelope::create(
        "diagnostic",
        writer(1),
        json!({ "code": "b", "message": "lost", "path": null }),
    );
    let err = kernel.append_and_apply(&second).unwrap_err();
    assert!(
        err.contains("retry") || err.contains("unavailable"),
        "got: {err}"
    );

    // Restore permissions so the tempdir can be cleaned up, and assert the first
    // entry survived and the failed second one did not land in the index.
    let mut perms = std::fs::metadata(&seg).unwrap().permissions();
    perms.set_mode(0o644);
    std::fs::set_permissions(&seg, perms).unwrap();
    assert!(kernel
        .index()
        .entry_id_by_idem(&first_idem)
        .unwrap()
        .is_some());
    assert!(kernel
        .index()
        .entry_id_by_idem(&second.idem)
        .unwrap()
        .is_none());
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
