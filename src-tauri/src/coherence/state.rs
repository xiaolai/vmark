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
use super::types::{Envelope, WriterId};

pub struct WorkspaceKernel {
    root: PathBuf,
    writer: WriterId,
    ledger: Ledger,
    snapshots: SnapshotStore,
    index: CoherenceIndex,
    initialized: bool,
    /// Set when an ambiguous append/apply failure may have left the ledger and
    /// index inconsistent (re-review #3): the durable ledger line may exist while
    /// the index lacks it, so the O(1) idem lookup can no longer be trusted. All
    /// writes and accepts refuse until reopen re-reconciles from the ledger.
    unavailable: Option<String>,
    /// True while a `with_write_lock` scope holds the exclusive workspace `flock`
    /// across its whole read-validate-append span (re-review #1, R1). The `flock`
    /// itself lives in a stack local in `with_write_lock` (so it releases on every
    /// exit incl. panic-unwind — #5); this flag only tells nested
    /// `append_and_apply` calls that the lock is already held, so they reuse it
    /// instead of re-locking (flock is not re-entrant across fds).
    in_write_txn: bool,
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
        // Marker-based init detection (re-review #4): a workspace is "initialized"
        // only once `.gitattributes` (the merge=union rule) exists — it is written
        // LAST by `ensure_initialized`. Testing the marker, not `.vmark`'s mere
        // existence, means a bare `.vmark/group.lock` left by a failed op (or a
        // crash mid-init) is NOT mistaken for complete: the next write re-runs
        // `ensure_initialized` and finishes the structure.
        let initialized = vmark.join(".gitattributes").is_file();
        let ledger = Ledger::new(vmark.join("ledger"), writer);
        let snapshots = SnapshotStore::new(vmark.join("snapshots"));
        let (mut index, needs_rebuild) = if initialized {
            CoherenceIndex::open(&vmark.join("index.db"))?
        } else {
            CoherenceIndex::open_in_memory()?
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
        Ok(Self {
            root: root.to_path_buf(),
            writer,
            ledger,
            snapshots,
            index,
            initialized,
            unavailable: None,
            in_write_txn: false,
            last_git: None,
            quarantined,
        })
    }

    /// Lazily create the on-disk structure (spec §1) before the first
    /// write: ledger + snapshot dirs, `.gitignore` (index.db) and
    /// `.gitattributes` (merge=union). Idempotent.
    pub fn ensure_initialized(&mut self) -> Result<(), String> {
        if self.initialized {
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
        ensure_line(&vmark.join(".gitattributes"), "ledger/*.jsonl merge=union")?;
        self.initialized = true;
        Ok(())
    }

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
        if let Err(append_err) = self.ledger.append(env) {
            return match self.reconcile_index_from_ledger() {
                Ok(()) => Err(format!(
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
    fn reconcile_index_from_ledger(&mut self) -> Result<(), String> {
        let read = self.ledger.read_all()?;
        self.index.rebuild_from(&read.entries)
    }

    /// Open + exclusively `flock` the workspace lock file (re-review #1). The
    /// lock is held for the returned File's lifetime (released on fd close). The
    /// lock path is a permanently-ignored runtime file (never git-tracked, so a
    /// checkout can't swap its inode while held). Non-Unix skips the OS lock
    /// (best-effort; macOS/Linux are the gated platforms).
    fn acquire_lock_file(&self) -> Result<fs::File, String> {
        let vmark = self.root.join(".vmark");
        fs::create_dir_all(&vmark).map_err(|e| format!("group lock dir: {e}"))?;
        let file = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(vmark.join("group.lock"))
            .map_err(|e| format!("group lock open failed: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::io::AsRawFd;
            // SAFETY: `file` owns the fd for the flock's lifetime; the lock is
            // released when the fd closes.
            let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
            if rc != 0 {
                return Err(format!(
                    "group lock failed: {}",
                    std::io::Error::last_os_error()
                ));
            }
        }
        Ok(file)
    }

    /// Run `f` holding the exclusive cross-process workspace lock across its WHOLE
    /// span (re-review #1, R1 — full pessimistic lock). EVERY mutating operation —
    /// a single accept, a group accept/recover, or a lone `append_and_apply` —
    /// routes through here, so its read → validate → append is atomic against
    /// every other cooperating writer (and against a git checkout that would
    /// otherwise land between our validation and our append). On acquire we
    /// reconcile the index from the ledger, so `f` validates against current
    /// state: a base-head the caller checked pre-lock is re-derived here and a
    /// concurrent commit that moved it is caught as a stale-base rejection instead
    /// of a silent sibling fork.
    ///
    /// Durability + panic safety:
    /// - `ensure_initialized` runs first, so the ONLY creator of `.vmark` is the
    ///   full-structure initializer — a failed op can never leave a bare
    ///   `.vmark/group.lock` that later reads as "initialized" (re-review #4).
    /// - The `flock` lives in the `_flock` stack local, so it releases on EVERY
    ///   exit path — normal return, `?`, or panic-unwind (re-review #5).
    /// - `in_write_txn` is set only AFTER a successful acquire+reconcile (a
    ///   reconcile error leaks no held-lock state) and cleared on normal return.
    ///   On an unwind the std `Mutex<WorkspaceKernel>` poisons, so a stale `true`
    ///   can never gate a future write — the kernel is unreachable after a panic.
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
        self.ensure_initialized()?;
        let _flock = self.acquire_lock_file()?;
        self.reconcile_index_from_ledger()?;
        self.in_write_txn = true;
        let result = f(self);
        self.in_write_txn = false;
        result
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

/// Append `line` to `path` when absent, preserving existing content
/// (audit R22 — a pre-existing file must still gain the required rules).
fn ensure_line(path: &Path, line: &str) -> Result<(), String> {
    let existing = fs::read_to_string(path).unwrap_or_default();
    if existing.lines().any(|l| l.trim() == line) {
        return Ok(());
    }
    let mut content = existing;
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(line);
    content.push('\n');
    fs::write(path, content).map_err(|e| format!("init {}: {e}", path.display()))
}

/// Per-installation writer identity (spec §2.2) — stored in app data,
/// never inside a (git-shared) workspace.
pub fn load_or_create_writer_id(app_data_dir: &Path) -> Result<WriterId, String> {
    let path = app_data_dir.join("coherence-writer-id");
    if let Ok(existing) = fs::read_to_string(&path) {
        if let Ok(id) = Uuid::parse_str(existing.trim()) {
            return Ok(WriterId(id));
        }
    }
    let id = Uuid::now_v7();
    fs::create_dir_all(app_data_dir).map_err(|e| format!("writer-id dir: {e}"))?;
    // Write-then-link (audit A17): the file becomes visible ONLY with its
    // full content — no window where another process reads it empty. A
    // link collision means we lost the race: adopt THEIR id.
    let tmp = app_data_dir.join(format!(".writer-id-{id}"));
    fs::write(&tmp, id.to_string()).map_err(|e| format!("writer-id tmp write: {e}"))?;
    let link_result = fs::hard_link(&tmp, &path);
    let _ = fs::remove_file(&tmp);
    match link_result.map(|_| ()) {
        Ok(()) => Ok(WriterId(id)),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let existing = fs::read_to_string(&path).map_err(|e| format!("writer-id read: {e}"))?;
            match Uuid::parse_str(existing.trim()) {
                Ok(other) => Ok(WriterId(other)), // lost the race — adopt theirs
                Err(_) => {
                    // Corrupt file, not a race: replace it (no healthy
                    // writer can be relying on unparseable identity).
                    fs::write(&path, id.to_string())
                        .map_err(|e| format!("writer-id rewrite: {e}"))?;
                    Ok(WriterId(id))
                }
            }
        }
        Err(e) => Err(format!("writer-id create: {e}")),
    }
}

#[cfg(test)]
#[path = "state.test.rs"]
mod tests;
