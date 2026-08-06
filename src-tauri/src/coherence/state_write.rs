//! `WorkspaceKernel`'s write path: append, reconcile, poison, and the workspace
//! lock every mutation runs under.
//!
//! Split out of `state.rs`, which the coherence runtime branch grew to 590
//! lines. The seam is behavioural, not arbitrary: everything here concerns
//! MUTATING the workspace under the cross-process flock, while `state.rs`
//! keeps construction (`open`, `ensure_initialized`) and the read accessors.
//!
//! Rust allows one inherent `impl` to be spread across modules of the same
//! crate, so this is a pure relocation — no new indirection, no trait, and no
//! change to any call site.
//!
//! @coordinates-with state.rs — the struct, its constructor and accessors
//! @module coherence/state_write

use std::fs;

use super::state::WorkspaceKernel;
use super::types::Envelope;
use super::workspace_files::flock_exclusive;

impl WorkspaceKernel {
    /// The single write path: durable ledger append, then index apply
    /// (I1/I2 — appends only). Two ambiguous-failure classes are handled so the
    /// O(1) idem lookup can never miss a durable entry (re-review #3):
    /// - **append error** — `write_all` may have landed the line before a later
    ///   step (fsync) failed, so the ledger MAY hold the entry while the index
    ///   does not. Reconcile from the ledger and return an error asking the
    ///   caller to retry (a deterministic-idem accept then finds it, no double
    ///   append); poison the kernel if the reconcile itself fails.
    /// - **apply error** — the ledger is truth, so rebuild from it; poison on
    ///   rebuild failure (audit R7).
    pub fn append_and_apply(&mut self, env: &Envelope) -> Result<(), String> {
        // A lone append is itself a mutating operation: take the workspace lock
        // for its whole span (re-review #1). When already inside a held
        // `with_write_lock` scope (a group's per-member appends), reuse it.
        if self.in_write_txn {
            return self.append_and_apply_inner(env);
        }
        self.with_write_lock(|k| k.append_and_apply_inner(env))
    }
    fn append_and_apply_inner(&mut self, env: &Envelope) -> Result<(), String> {
        // Initialize lazily at the actual write, NOT on every lock acquire
        // (7th-review 6R-4): a rejected accept (tamper/stale) errors before it
        // reaches here, so it can no longer fully initialize a pristine `.vmark`.
        self.ensure_initialized()?;
        if let Err(append_err) = self.ledger.append(env) {
            return match self.reconcile_index_from_ledger() {
                // The skipped-count is not consulted on this recovery path: the
                // write already failed, and `with_write_lock` refused any short
                // read before we got here.
                Ok(_) => Err(format!(
                    "ledger append failed ({append_err}); index reconciled — retry the operation"
                )),
                Err(rec_err) => Err(self.poison(format!(
                    "ledger append failed ({append_err}) and reconcile failed ({rec_err})"
                ))),
            };
        }
        if let Err(apply_err) = self.index.apply_entry(env) {
            if let Err(rec_err) = self.reconcile_index_from_ledger() {
                return Err(self.poison(format!(
                    "index apply failed ({apply_err}) and rebuild failed ({rec_err})"
                )));
            }
        }
        Ok(())
    }
    /// Refuse writes/accepts once an ambiguous failure has poisoned the kernel
    /// (re-review #3) — the caller must reopen to re-reconcile from the ledger.
    pub fn ensure_available(&self) -> Result<(), String> {
        match &self.unavailable {
            None => Ok(()),
            Some(reason) => Err(format!("coherence unavailable until reopen: {reason}")),
        }
    }
    fn poison(&mut self, reason: String) -> String {
        self.unavailable = Some(reason.clone());
        format!("{reason} — coherence unavailable until reopen")
    }
    /// Rebuild the index from the ledger's current entries — the recovery the
    /// ambiguous-failure paths share (the ledger is always truth).
    ///
    /// Returns how many entries the read had to SKIP because they carry a
    /// format this build cannot parse. The count is returned rather than acted
    /// on here because the correct response differs by caller: a read or a
    /// heal-on-open proceeds (a short projection is still worth showing),
    /// whereas `with_write_lock` must refuse — see `refuse_if_short_read`.
    fn reconcile_index_from_ledger(&mut self) -> Result<usize, String> {
        let read = self.ledger.read_all()?;
        self.index.rebuild_from(&read.entries)?;
        Ok(read.future_format)
    }

    /// Refuse to mutate on top of a projection we know is incomplete.
    ///
    /// A `format > FORMAT_VERSION` entry is skipped by `parse_line`, so every
    /// head, edge and resolution derived from that read is missing whatever the
    /// newer build recorded. Appending anyway means deciding against history
    /// this binary cannot see — an older VMark would fork or overwrite a newer
    /// one's work while every local check looked green. Reads deliberately stay
    /// available; only mutation is refused, so the remedy (upgrade VMark) is
    /// reachable from an app that still opens the workspace.
    fn refuse_if_short_read(skipped: usize) -> Result<(), String> {
        if skipped == 0 {
            return Ok(());
        }
        Err(format!(
            "ledger contains {skipped} entr{} in a newer format this build cannot read; \
             refusing to write on top of an incomplete history — upgrade VMark to continue",
            if skipped == 1 { "y" } else { "ies" }
        ))
    }
    /// Open + exclusively `flock` the workspace lock file (re-review #1). The
    /// lock is held for the returned File's lifetime (released on fd close). The
    /// lock path is a permanently-ignored runtime file (never git-tracked, so a
    /// checkout can't swap its inode while held). Non-Unix skips the OS lock
    /// (best-effort; macOS/Linux are the gated platforms).
    fn acquire_lock_file(&self) -> Result<fs::File, String> {
        let vmark = self.root.join(".vmark");
        fs::create_dir_all(&vmark).map_err(|e| format!("group lock dir: {e}"))?;
        flock_exclusive(&vmark)
    }
    /// Run `f` holding the exclusive cross-process workspace lock across its WHOLE
    /// span (R1 — full pessimistic lock). EVERY mutating operation — a single
    /// accept, a group accept/recover, or any command that reads state and then
    /// appends (capture, adoption, scan, claim, resolution) — routes its whole
    /// read → build → append through here, so it is atomic against every other
    /// cooperating writer (7th-review 6R-1).
    ///
    /// Cost: the index is reconciled from the ledger on EVERY acquire — O(ledger)
    /// per mutating operation. The change-gated version this replaced (7th-review
    /// 6R-5) tried to skip the rebuild when a ledger fingerprint was unchanged;
    /// four consecutive audits each found a fresh way for the index to diverge
    /// while that fingerprint stayed put, because the fingerprint answers "did the
    /// ledger change?" while the invariant that matters is "does the index still
    /// reflect the ledger?". Those are not the same question, so the gate was
    /// removed rather than patched a fifth time.
    ///
    /// The reconcile guarantees the base-head a caller re-derives inside `f` is
    /// checked against a current index, so a concurrent commit that moved a head is
    /// caught as a stale-base rejection, not a silent fork.
    ///
    /// Durability + panic safety:
    /// - `.vmark` is initialized lazily at the actual write (`append_and_apply_inner`),
    ///   never here, so a rejected op cannot fully initialize a pristine workspace
    ///   (6R-4). `acquire_lock_file` creates only a bare `.vmark/group.lock`, which
    ///   is not the `.gitattributes` completion marker `open` trusts.
    /// - The `flock` lives in the `_flock` stack local, so it releases on EVERY
    ///   exit path — normal return, `?`, or panic-unwind (6R-5 flock leak, CLOSED).
    /// - An acquire-time reconcile failure POISONS the kernel (6R-6): a half-applied
    ///   rebuild must never be used; the kernel refuses until reopen, which re-heals.
    /// - On an unwind the std `Mutex<WorkspaceKernel>` poisons, so the stale
    ///   `in_write_txn` can never gate a future write (the kernel is unreachable).
    ///
    /// Re-entrant: a nested call (a group's per-member `append_and_apply`) sees
    /// the flag set and runs `f` directly on the already-held lock.
    pub fn with_write_lock<R>(
        &mut self,
        f: impl FnOnce(&mut Self) -> Result<R, String>,
    ) -> Result<R, String> {
        self.ensure_available()?;
        if self.in_write_txn {
            return f(self);
        }
        let _flock = self.acquire_lock_file()?;
        // Reconcile UNCONDITIONALLY. The previous change-gated version compared a
        // cheap `(name, len, mtime, inode)` ledger fingerprint and rebuilt only on
        // a difference — but four independent audits each found a fresh way for
        // that oracle to return a FALSE NEGATIVE and serve a stale index: a
        // same-length in-place rewrite under a coarse or restored mtime keeps the
        // inode; a delete/recreate can reuse one; non-Unix has no inode at all;
        // and, decisively, the fingerprint watches the LEDGER while another
        // process can rebuild the shared `index.db` underneath it — the invariant
        // that actually matters is "the index still reflects the ledger", which
        // no ledger-only metadata can witness.
        //
        // The optimisation is also no longer buying what it was introduced for:
        // `perform_status` now goes through `perform_breakdown_in`, which runs a
        // scan AND `read_all`, so the ledger is already read on that path.
        // Correctness that four audits could not falsify beats a saving that has
        // already been given away.
        let skipped = match self.reconcile_index_from_ledger() {
            Ok(skipped) => skipped,
            // A partially rebuilt index must never be served (6R-6).
            Err(e) => return Err(self.poison(format!("acquire-time reconcile failed: {e}"))),
        };
        // Refuse to build on a history we could not fully read. This is NOT a
        // poison: the workspace is fine and reads keep working — it is this
        // BINARY that is too old, and the condition clears by upgrading rather
        // than by reopening.
        Self::refuse_if_short_read(skipped)?;
        self.in_write_txn = true;
        // Run `f` inside catch_unwind so the flag is reset even on a panic
        // (8th-review 8R-10). Relying on the registry `Mutex` poisoning was not
        // enough: a DIRECTLY owned kernel whose panic is caught kept the flag set
        // and the next `with_write_lock` took the re-entrant branch, running
        // without any flock. The panic is re-raised unchanged afterwards.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(self)));
        self.in_write_txn = false;
        match result {
            Ok(r) => r,
            Err(payload) => {
                // A panic may have left the ledger ahead of the index (appended
                // but not applied). Poison so a kernel surviving an outer
                // `catch_unwind` refuses until reopen (9th-review 9R-2).
                self.unavailable =
                    Some("a panic escaped a locked operation; state may be torn".into());
                std::panic::resume_unwind(payload)
            }
        }
    }
}
