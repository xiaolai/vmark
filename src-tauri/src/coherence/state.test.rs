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
        "index.db*\ngroup.lock\n"
    );
    assert_eq!(
        std::fs::read_to_string(vmark.join(".gitattributes")).unwrap(),
        "ledger/*.jsonl merge=union\n"
    );
    // Idempotent.
    kernel.ensure_initialized().unwrap();
    assert!(kernel.is_initialized());
}

/// WI-2.1 — a ledger carrying a record this build cannot parse makes every
/// projection derived from it SHORT. Reading a short projection is fine (and
/// useful — you can still look at what you do understand). Appending onto one
/// is not: the writer would be deciding against history it cannot see, which is
/// how an older binary silently overwrites a newer one's work.
///
/// `parse_line` has always classified these (`LineOutcome::FutureFormat`) and
/// `read_all` has always counted them into `LedgerRead::future_format` — but
/// until this gate NOTHING read that count, so the refusal never happened. The
/// C2 group-commit review (c2-v2-review-01.md, finding H3) named this as the
/// reason a format bump alone does not prevent over-exposure; it is a defect in
/// the wired runtime independent of that subsystem, and it fires for ANY future
/// format bump, not just the group one.
#[test]
fn future_format_ledger_refuses_mutation_but_still_reads() {
    let dir = tmp();
    let mut kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
    kernel.ensure_initialized().unwrap();

    // One ordinary entry this build DOES understand, so the ledger is not
    // trivially empty and the read path has something real to return.
    let mine = Envelope::create(
        "diagnostic",
        writer(1),
        json!({"code":"t","message":"mine"}),
    );
    kernel.append_and_apply(&mine).unwrap();

    // A record from a newer build. This reader skips it — deliberately, and
    // without quarantining it, since it is not corruption.
    let mut newer = Envelope::create(
        "diagnostic",
        writer(1),
        json!({"code":"t","message":"future"}),
    );
    newer.format = crate::coherence::types::FORMAT_VERSION + 1;
    kernel.ledger().append(&newer).unwrap();

    // READ still works, and still reports the short read honestly.
    let read = kernel.ledger().read_all().unwrap();
    assert_eq!(read.future_format, 1, "the short read must be visible");
    assert_eq!(
        read.entries.len(),
        1,
        "only the entry this build understands"
    );
    assert!(
        read.quarantined.is_empty(),
        "a newer format is not corruption"
    );

    // MUTATION must refuse. `with_write_lock` is the single choke point every
    // mutating operation routes through, so gating it covers accept, capture,
    // scan, claim and resolution at once.
    let err = kernel
        .with_write_lock(|_| Ok(()))
        .expect_err("mutation onto a short projection must be refused");
    assert!(
        err.contains("newer format"),
        "the refusal must name the cause; got: {err}"
    );
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
// UNIX-ONLY FIXTURE, not a unix-only behaviour. The property under test —
// fail closed on an I/O error rather than destroying state — holds on every
// platform. What is unix-only is the way to PROVOKE it: these force the
// failure with `chmod 0o000` / a read-only dir, and `PermissionsExt::set_mode`
// has no std equivalent on Windows (the read-only attribute does not make a
// directory unreadable). Same guard `scan.test.rs` already uses for symlinks.
#[cfg(unix)]
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
fn a_bare_lock_file_is_not_mistaken_for_an_initialized_workspace() {
    // Re-review #4: a failed op can create `.vmark/group.lock` (via
    // `acquire_lock_file`) without the full structure. Init detection is
    // marker-based (`.gitattributes`, written LAST), so `open` treats that bare
    // `.vmark` as UNINITIALIZED and the next write completes it — `merge=union`
    // (the git-merge semantics the ledger relies on) is never silently lost.
    let dir = tmp();
    let vmark = dir.path().join(".vmark");
    std::fs::create_dir_all(&vmark).unwrap();
    std::fs::write(vmark.join("group.lock"), b"").unwrap();

    let mut kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
    assert!(
        !kernel.is_initialized(),
        "a bare .vmark/group.lock must not read as initialized",
    );
    assert!(
        !vmark.join(".gitattributes").is_file(),
        "precondition: no completion marker yet",
    );

    kernel
        .append_and_apply(&Envelope::create(
            "diagnostic",
            writer(1),
            json!({ "code": "x", "message": "first write", "path": null }),
        ))
        .unwrap();
    assert!(kernel.is_initialized());
    assert_eq!(
        std::fs::read_to_string(vmark.join(".gitattributes")).unwrap(),
        "ledger/*.jsonl merge=union\n",
        "the completion marker is written, so a git commit keeps merge=union",
    );
}

#[test]
// UNIX-ONLY FIXTURE, not a unix-only behaviour. The property under test —
// fail closed on an I/O error rather than destroying state — holds on every
// platform. What is unix-only is the way to PROVOKE it: these force the
// failure with `chmod 0o000` / a read-only dir, and `PermissionsExt::set_mode`
// has no std equivalent on Windows (the read-only attribute does not make a
// directory unreadable). Same guard `scan.test.rs` already uses for symlinks.
#[cfg(unix)]
fn a_reconcile_failure_during_lock_acquire_does_not_leak_the_workspace_lock() {
    // Re-review #5: the flock lives in a stack local and `in_write_txn` is set
    // only AFTER a successful reconcile, so a reconcile error during lock acquire
    // releases the lock and leaves the kernel usable — no stuck "lock already
    // held" / permanently-held flock (the old `begin_group_lock` leak, where the
    // handle was stored before the reconcile that then failed).
    use std::os::unix::fs::PermissionsExt;
    let dir = tmp();
    let mut kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
    kernel.ensure_initialized().unwrap();
    let ledger_dir = dir.path().join(".vmark").join("ledger");

    // Make the ledger dir unreadable so the reconcile (read_all) fails with a
    // permission error — NOT the empty-history NotFound.
    let mut p = std::fs::metadata(&ledger_dir).unwrap().permissions();
    p.set_mode(0o000);
    std::fs::set_permissions(&ledger_dir, p).unwrap();

    let err = kernel
        .append_and_apply(&Envelope::create(
            "diagnostic",
            writer(1),
            json!({ "code": "a", "message": "blocked", "path": null }),
        ))
        .unwrap_err();
    assert!(!err.is_empty(), "the acquire-time reconcile must fail");

    // The kernel is POISONED, by contract: a reconcile that failed part-way may
    // have left a half-rebuilt index, and serving one is the worst outcome
    // available. It must refuse until reopen rather than carry on.
    let mut p = std::fs::metadata(&ledger_dir).unwrap().permissions();
    p.set_mode(0o755);
    std::fs::set_permissions(&ledger_dir, p).unwrap();
    let still = kernel
        .append_and_apply(&Envelope::create(
            "diagnostic",
            writer(1),
            json!({ "code": "b", "message": "after", "path": null }),
        ))
        .unwrap_err();
    assert!(
        still.contains("unavailable until reopen"),
        "a poisoned kernel must keep refusing, got: {still}"
    );

    // But the FLOCK was not leaked — that is what this test exists to prove.
    // A fresh kernel on the same workspace acquires it and writes; a leaked
    // flock would block here forever instead.
    drop(kernel);
    let mut reopened = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
    reopened
        .append_and_apply(&Envelope::create(
            "diagnostic",
            writer(1),
            json!({ "code": "c", "message": "recovered", "path": null }),
        ))
        .expect("the lock was released, so reopening heals and writes succeed");
    assert_eq!(reopened.ledger().read_all().unwrap().entries.len(), 1);
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

#[test]
fn a_gitattributes_without_the_merge_rule_is_not_initialized() {
    // 7th-review 6R-4: existence is not a completion protocol. A marker truncated
    // by a crash mid-write — or left by a checkout without the rule — must NOT read
    // as initialized, or the git-transported ledger loses merge=union permanently.
    let dir = tmp();
    let vmark = dir.path().join(".vmark");
    std::fs::create_dir_all(&vmark).unwrap();
    std::fs::write(vmark.join(".gitattributes"), b"").unwrap(); // present but ruleless

    let mut kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
    assert!(
        !kernel.is_initialized(),
        "an empty .gitattributes is not initialization",
    );
    kernel
        .append_and_apply(&Envelope::create(
            "diagnostic",
            writer(1),
            json!({ "code": "x", "message": "first write", "path": null }),
        ))
        .unwrap();
    let content = std::fs::read_to_string(vmark.join(".gitattributes")).unwrap();
    assert!(
        content
            .lines()
            .any(|l| l.trim() == "ledger/*.jsonl merge=union"),
        "the write completed the marker, got: {content:?}",
    );
}

#[test]
// UNIX-ONLY FIXTURE, not a unix-only behaviour. The property under test —
// fail closed on an I/O error rather than destroying state — holds on every
// platform. What is unix-only is the way to PROVOKE it: these force the
// failure with `chmod 0o000` / a read-only dir, and `PermissionsExt::set_mode`
// has no std equivalent on Windows (the read-only attribute does not make a
// directory unreadable). Same guard `scan.test.rs` already uses for symlinks.
#[cfg(unix)]
fn ensure_line_refuses_to_overwrite_an_unreadable_gitignore() {
    // 9th-review 9R-5 (data loss): `unwrap_or_default` turned a temporarily
    // unreadable .gitignore into an EMPTY string, and the rename then replaced the
    // user's real file with one holding only VMark's rule — destroying every rule
    // they had written. The stricter init gate made that path reachable for an
    // otherwise healthy workspace. A read error must fail closed, untouched.
    use std::os::unix::fs::PermissionsExt;
    let dir = tmp();
    let vmark = dir.path().join(".vmark");
    std::fs::create_dir_all(&vmark).unwrap();
    let gitignore = vmark.join(".gitignore");
    let user_rules = "# my rules\nsecrets/\n*.local\nindex.db*\ngroup.lock\n";
    std::fs::write(&gitignore, user_rules).unwrap();

    let mut p = std::fs::metadata(&gitignore).unwrap().permissions();
    p.set_mode(0o000); // unreadable
    std::fs::set_permissions(&gitignore, p).unwrap();

    let mut kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
    let err = kernel.ensure_initialized().unwrap_err();
    assert!(err.contains("refusing to overwrite"), "got: {err}");

    // Restore and prove the user's rules are intact.
    let mut p = std::fs::metadata(&gitignore).unwrap().permissions();
    p.set_mode(0o644);
    std::fs::set_permissions(&gitignore, p).unwrap();
    assert_eq!(
        std::fs::read_to_string(&gitignore).unwrap(),
        user_rules,
        "the user's .gitignore must be untouched"
    );
}

#[test]
fn an_older_workspace_with_incomplete_ignore_rules_is_still_initialized() {
    // Found by DOGFOODING (2026-07-20), not by review: this repo's own 119-entry
    // workspace had a `.gitignore` written before the `group.lock` rule existed.
    // Folding that rule into the initialized test made the whole workspace report
    // `initialized: false`, so `perform_status` skipped the breakdown and showed
    // `open_items: 0` while `edges` correctly returned 5 stale edges — the status
    // surface lying about a healthy workspace. A missing ignore rule must mean
    // "augment on next write", never "this isn't a coherence workspace".
    let dir = tmp();
    let vmark = dir.path().join(".vmark");
    std::fs::create_dir_all(vmark.join("ledger")).unwrap();
    std::fs::create_dir_all(vmark.join("snapshots")).unwrap();
    std::fs::write(vmark.join(".gitattributes"), "ledger/*.jsonl merge=union\n").unwrap();
    std::fs::write(vmark.join(".gitignore"), "index.db*\n").unwrap(); // pre-group.lock

    let mut kernel = WorkspaceKernel::open(dir.path(), writer(1)).unwrap();
    assert!(
        kernel.is_initialized(),
        "an older-but-real coherence workspace must still read as initialized",
    );

    // The next write augments the missing rule rather than re-initializing.
    kernel
        .append_and_apply(&Envelope::create(
            "diagnostic",
            writer(1),
            json!({ "code": "x", "message": "write", "path": null }),
        ))
        .unwrap();
    let ignore = std::fs::read_to_string(vmark.join(".gitignore")).unwrap();
    assert!(
        ignore.lines().any(|l| l.trim() == "index.db*")
            && ignore.lines().any(|l| l.trim() == "group.lock"),
        "both runtime rules present after the write, got: {ignore:?}"
    );
}
