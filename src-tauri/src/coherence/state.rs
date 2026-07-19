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
        let initialized = vmark.is_dir();
        let ledger = Ledger::new(vmark.join("ledger"), writer);
        let snapshots = SnapshotStore::new(vmark.join("snapshots"));
        let (mut index, needs_rebuild) = if initialized {
            CoherenceIndex::open(&vmark.join("index.db"))?
        } else {
            CoherenceIndex::open_in_memory()?
        };
        let mut quarantined = 0;
        if needs_rebuild || !initialized {
            let read = ledger.read_all()?;
            quarantined = read.quarantined.len();
            index.rebuild_from(&read.entries)?;
        } else {
            // Heal-on-open (design-accept-consistency Fix A). A schema-valid
            // index is loaded, not rebuilt — so a crash between a ledger append
            // (durable) and its index apply would stay torn across opens. Cheap
            // probe: the ledger's raw line count equals the index's applied idem
            // count iff caught up. On mismatch, reconcile precisely and rebuild
            // only if the deduped entry count actually exceeds what's applied
            // (a raw>applied gap can be mere dupes/quarantine, not a torn tail).
            if ledger.raw_entry_count()? != index.applied_count()? {
                let read = ledger.read_all()?;
                quarantined = read.quarantined.len();
                if read.entries.len() != index.applied_count()? {
                    index.rebuild_from(&read.entries)?;
                }
            }
        }
        Ok(Self {
            root: root.to_path_buf(),
            writer,
            ledger,
            snapshots,
            index,
            initialized,
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
        ensure_line(&vmark.join(".gitattributes"), "ledger/*.jsonl merge=union")?;
        // Swap the in-memory index for the file-backed one.
        let (mut index, _) = CoherenceIndex::open(&vmark.join("index.db"))?;
        let read = self.ledger.read_all()?;
        self.quarantined = read.quarantined.len();
        index.rebuild_from(&read.entries)?;
        self.index = index;
        self.initialized = true;
        Ok(())
    }

    /// The single write path: durable ledger append, then index apply
    /// (I1/I2 — appends only). An index-apply failure never leaves a
    /// silently stale index: the ledger is truth, so we rebuild from it
    /// and only error if recovery itself fails (audit R7).
    pub fn append_and_apply(&mut self, env: &Envelope) -> Result<(), String> {
        self.ledger.append(env)?;
        if let Err(apply_err) = self.index.apply_entry(env) {
            let read = self.ledger.read_all()?;
            self.index
                .rebuild_from(&read.entries)
                .map_err(|rebuild_err| {
                    format!("index apply failed ({apply_err}) and rebuild failed ({rebuild_err}) — coherence unavailable until reopen")
                })?;
        }
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
