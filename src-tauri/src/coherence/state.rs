//! Per-workspace kernel lifecycle (WI-1.12, ADR-C4 services tier).
//!
//! One `WorkspaceKernel` per workspace root, shared across windows via
//! `KernelRegistry` (spec §5.1: all in-app writes serialize through one
//! instance). `.vmark/` is created lazily on the first capture — never on
//! mere open (spec §1). Opening a workspace with an existing ledger
//! rebuilds the index when needed (R16); failed init surfaces an error
//! without blocking the editor (callers treat coherence as unavailable).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use uuid::Uuid;

use super::cas::SnapshotStore;
use super::gitops::GitObservation;
use super::index::CoherenceIndex;
use super::ledger::Ledger;
use super::types::WriterId;

// Re-exported so `coherence::state::load_or_create_writer_id` stays a valid path
// for `app_setup.rs` and for `state.test.rs` (which reaches these through
// `use super::*`). The move is physical, not an API change.
pub use super::workspace_files::load_or_create_writer_id;
use super::workspace_files::{
    ensure_line, flock_exclusive, ignore_rules_complete, is_fully_initialized,
};

pub struct WorkspaceKernel {
    // `pub(super)` for the fields `state_write.rs` needs: this inherent impl is
    // split across modules, exactly as `CoherenceIndex` already is (index.rs,
    // index_query.rs, index_state.rs, read_view.rs, …), and `index.rs` marks
    // `conn` the same way for the same reason. Visibility stops at `coherence`.
    pub(super) root: PathBuf,
    writer: WriterId,
    pub(super) ledger: Ledger,
    pub(super) snapshots: SnapshotStore,
    pub(super) index: CoherenceIndex,
    initialized: bool,
    /// Set when an ambiguous append/apply failure may have left the ledger and
    /// index inconsistent (re-review #3): the durable ledger line may exist while
    /// the index lacks it, so the O(1) idem lookup can no longer be trusted. All
    /// writes and accepts refuse until reopen re-reconciles from the ledger.
    pub(super) unavailable: Option<String>,
    /// How many entries the last reconcile had to SKIP because they carry a
    /// format this build cannot parse (WI-2.2). Cached so the command layer can
    /// classify a refused write WITHOUT matching the message text — rule 50
    /// forbids recovering a code from a string, and everything below these
    /// commands still returns `String`. A refused write is `unsupported` (this
    /// binary is too old; upgrade) rather than `invalid-input` (your request was
    /// wrong), and those demand opposite things of the user.
    pub(super) short_read: usize,
    /// True iff the LAST `with_write_lock` was refused specifically because the
    /// ledger read was short.
    ///
    /// Deliberately distinct from `short_read > 0`. The count is a property of
    /// the last successful reconcile and can be stale — if lock acquisition
    /// fails before the reconcile runs, or the offending entry has since been
    /// removed by a git operation, an unrelated failure would be reported as
    /// "upgrade VMark". This flag is set at the refusal itself and cleared at
    /// the start of every non-reentrant acquire, so it answers exactly the
    /// question its consumers ask: *was this call refused for that reason?*
    pub(super) refused_for_short_read: bool,
    /// Set by `append_and_apply_inner` when a locked scope actually wrote to the
    /// ledger. Read once at the end of that scope to decide whether the
    /// post-append re-verification is needed at all — a read-only locked scope
    /// (most of them) skips it and pays nothing.
    pub(super) appended_in_txn: bool,
    /// True while a `with_write_lock` scope holds the exclusive workspace `flock`
    /// across its whole read-validate-append span (re-review #1, R1). The `flock`
    /// itself lives in a stack local in `with_write_lock` (so it releases on every
    /// exit incl. panic-unwind — #5); this flag only tells nested
    /// `append_and_apply` calls that the lock is already held, so they reuse it
    /// instead of re-locking (flock is not re-entrant across fds).
    pub(super) in_write_txn: bool,
    /// True until the `.gitignore` runtime rules have been verified/augmented once
    /// for this kernel (see `ignore_rules_complete`).
    ignore_rules_unchecked: bool,
    /// Last git observation for scan classification (WI-1.7).
    pub last_git: Option<GitObservation>,
    /// Quarantined-line count from the last ledger read (status surface).
    pub quarantined: usize,
}

impl WorkspaceKernel {
    /// Open a workspace. Creates nothing on disk when `.vmark/` is absent
    /// (in-memory index until first capture).
    pub fn open(root: &Path, writer: WriterId) -> Result<Self, String> {
        let vmark = root.join(".vmark");
        // Marker-based init detection, on CONTENT not existence (7th-review 6R-4):
        // a workspace is "initialized" only once `.gitattributes` actually carries
        // the merge=union rule — the rule the git-transported ledger depends on.
        // Testing content (not `is_file()`, and not `.vmark`'s mere existence)
        // means none of these read as complete: a bare `.vmark/group.lock` from a
        // failed op, a truncated marker from a crash mid-write, or a branch
        // checkout that left `.gitattributes` present but without the rule. Each
        // re-runs `ensure_initialized`, which rewrites the marker ATOMICALLY.
        let initialized = is_fully_initialized(&vmark);
        let ledger = Ledger::new(vmark.join("ledger"), writer);
        let snapshots = SnapshotStore::new(vmark.join("snapshots"));
        let (mut index, needs_rebuild) = if initialized {
            CoherenceIndex::open(&vmark.join("index.db"))?
        } else {
            CoherenceIndex::open_in_memory()?
        };
        // Heal-on-open MUTATES the shared `index.db`, so it must be serialized
        // against cooperating writers (9th-review). Two processes rebuilding the
        // same SQLite file concurrently is a raw file race, and an opener that read
        // the ledger before a writer's entry landed would rebuild the shared index
        // without it. Taking the lock makes the opener's read+rebuild atomic w.r.t.
        // appends, so it can only ever rebuild to the CURRENT ledger.
        //
        // The reconcile is now unconditional (see `with_write_lock`), so a stale
        // rebuild no longer SURVIVES — the next acquiring writer rebuilds again
        // regardless. The lock is still required: it prevents the concurrent
        // mutation itself, which no later reconcile can undo.
        //
        // Only lock an EXISTING `.vmark`: mere open must never create it (spec §1),
        // and with no `.vmark` there is no shared index or ledger to race over.
        let _open_lock = if vmark.is_dir() {
            Some(flock_exclusive(&vmark)?)
        } else {
            None
        };
        let quarantined;
        if needs_rebuild || !initialized {
            let read = ledger.read_all()?;
            quarantined = read.quarantined.len();
            index.rebuild_from(&read.entries)?;
        } else {
            // Heal-on-open (design-accept-consistency Fix A, hardened for
            // re-review #1/#2). A schema-valid index is loaded, not rebuilt, so
            // it must be reconciled against the ledger — but on EXACT identity,
            // never cardinality: the ledger is git-*tracked*, so a branch switch
            // can REPLACE it with a same-count-but-different history while the
            // gitignored index.db persists, and a cross-process double-append can
            // leave the index on a non-canonical winner. Both are invisible to a
            // count compare. Build the ledger's canonical idem→winner map
            // (read_all already dedupes to the smallest (time,id) winner) and
            // rebuild if the index's applied map differs in ANY entry.
            let read = ledger.read_all()?;
            quarantined = read.quarantined.len();
            let ledger_winners: HashMap<Uuid, Uuid> =
                read.entries.iter().map(|e| (e.idem, e.id)).collect();
            if index.applied_map()? != ledger_winners {
                index.rebuild_from(&read.entries)?;
            }
        }
        let ignore_rules_unchecked = !ignore_rules_complete(&vmark);
        Ok(Self {
            root: root.to_path_buf(),
            writer,
            ledger,
            snapshots,
            index,
            initialized,
            unavailable: None,
            short_read: 0,
            refused_for_short_read: false,
            appended_in_txn: false,
            in_write_txn: false,
            ignore_rules_unchecked,
            last_git: None,
            quarantined,
        })
    }

    /// Lazily create the on-disk structure (spec §1) before the first
    /// write: ledger + snapshot dirs, `.gitignore` (index.db) and
    /// `.gitattributes` (merge=union). Idempotent.
    pub fn ensure_initialized(&mut self) -> Result<(), String> {
        if self.initialized {
            // Already a real coherence workspace — but its ignore rules may predate
            // a newer runtime file (dogfood: this repo's `.vmark/.gitignore` had
            // only `index.db*`, written before `group.lock` existed). Augment them
            // ONCE per kernel so those files stop being committable, without paying
            // two file reads on every append.
            if self.ignore_rules_unchecked {
                let vmark = self.root.join(".vmark");
                ensure_line(&vmark.join(".gitignore"), "index.db*")?;
                ensure_line(&vmark.join(".gitignore"), "group.lock")?;
                self.ignore_rules_unchecked = false;
            }
            return Ok(());
        }
        let vmark = self.root.join(".vmark");
        fs::create_dir_all(vmark.join("ledger")).map_err(|e| format!("init ledger dir: {e}"))?;
        fs::create_dir_all(vmark.join("snapshots")).map_err(|e| format!("init snapshots: {e}"))?;
        ensure_line(&vmark.join(".gitignore"), "index.db*")?;
        ensure_line(&vmark.join(".gitignore"), "group.lock")?;
        // Swap the in-memory index for the file-backed one.
        let (mut index, _) = CoherenceIndex::open(&vmark.join("index.db"))?;
        let read = self.ledger.read_all()?;
        self.quarantined = read.quarantined.len();
        index.rebuild_from(&read.entries)?;
        self.index = index;
        // The merge=union rule is written LAST as the completion marker
        // (re-review #4): its presence is exactly what `open` trusts to mean
        // "fully initialized", so a crash before this leaves the workspace
        // re-initializable rather than falsely "done".
        ensure_line(&vmark.join(".gitattributes"), MERGE_UNION_RULE)?;
        self.initialized = true;
        Ok(())
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn writer(&self) -> WriterId {
        self.writer
    }
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
    pub fn index(&self) -> &CoherenceIndex {
        &self.index
    }
    pub fn index_mut(&mut self) -> &mut CoherenceIndex {
        &mut self.index
    }
    pub fn snapshots(&self) -> &SnapshotStore {
        &self.snapshots
    }
    pub fn ledger(&self) -> &Ledger {
        &self.ledger
    }

    /// Read + verify a snapshot (spec §4.3): Missing/Corrupt append a
    /// durable diagnostic and return an explicit error — never silently
    /// empty content.
    pub fn read_snapshot(&mut self, hash: &super::types::ContentHash) -> Result<Vec<u8>, String> {
        use super::cas::CasError;
        match self.snapshots.get(hash) {
            Ok(bytes) => Ok(bytes),
            Err(err) => {
                let code = match err {
                    CasError::Missing => "snapshot-missing",
                    CasError::Corrupt => "snapshot-corrupt",
                    CasError::Io(_) => "snapshot-io",
                };
                let env = super::types::Envelope::create(
                    "diagnostic",
                    self.writer,
                    serde_json::json!({
                        "code": code,
                        "message": format!("snapshot {}: {err}", hash.as_str()),
                        "path": null,
                    }),
                );
                let _ = self.append_and_apply(&env); // best-effort, never masks the read error
                Err(format!("snapshot read failed ({code}): {err}"))
            }
        }
    }
}

/// One kernel per workspace root, lazily created, shared across windows.
#[derive(Default)]
pub struct KernelRegistry {
    kernels: Mutex<HashMap<PathBuf, Arc<Mutex<WorkspaceKernel>>>>,
}

impl KernelRegistry {
    pub fn kernel_for(
        &self,
        root: &Path,
        writer: WriterId,
    ) -> Result<Arc<Mutex<WorkspaceKernel>>, String> {
        let canonical = root
            .canonicalize()
            .map_err(|e| format!("workspace root not accessible: {e}"))?;
        let mut map = self
            .kernels
            .lock()
            .map_err(|_| "kernel registry poisoned".to_string())?;
        if let Some(k) = map.get(&canonical) {
            return Ok(Arc::clone(k));
        }
        let kernel = Arc::new(Mutex::new(WorkspaceKernel::open(&canonical, writer)?));
        map.insert(canonical, Arc::clone(&kernel));
        Ok(kernel)
    }
}

/// The rule the git-transported ledger depends on, and the initialization
/// completion marker (7th-review 6R-4).
pub(super) const MERGE_UNION_RULE: &str = "ledger/*.jsonl merge=union";

#[cfg(test)]
#[path = "state.test.rs"]
mod tests;
