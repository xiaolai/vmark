//! On-disk bootstrap for a workspace's `.vmark/` directory.
//!
//! The filesystem half of `state.rs`: the exclusive lock that serialises
//! creation, the "is this workspace fully set up" probes, the idempotent
//! line-append used to maintain ignore rules, and the persistent writer id.
//!
//! Split out because none of it touches `WorkspaceKernel` state — these are
//! free functions over paths, and keeping them beside the kernel pushed
//! `state.rs` past the 300-line limit.
//!
//! @coordinates-with state.rs — `open` / `ensure_initialized` call these
//! @module coherence/workspace_files

use std::fs;
use std::path::Path;

use uuid::Uuid;

use super::state::MERGE_UNION_RULE;
use super::types::WriterId;

/// Take the exclusive workspace `flock` on an EXISTING `.vmark` (the caller
/// decides whether creating it is allowed — `open` must not, per spec §1). The
/// lock is held for the returned File's lifetime, released on fd close. The lock
/// path is a permanently-ignored runtime file, so a checkout can't swap its inode
/// while held. Non-Unix skips the OS lock (macOS/Linux are the gated platforms).
pub(super) fn flock_exclusive(vmark: &Path) -> Result<fs::File, String> {
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

/// Give `.vmark/.gitignore` its runtime-file rules if the file is absent.
///
/// Called by `acquire_lock_file`, which creates `.vmark/` purely to hold
/// `group.lock` BEFORE the operation is adjudicated (#1285). An op that is then
/// rejected leaves that directory behind, and without these rules it holds one
/// binary runtime file and nothing else — which `git add .` duly stages, in
/// every repository a failed coherence action touched.
///
/// This is NOT initialization. The completion marker is `.gitattributes`,
/// written last by `ensure_initialized`, so `is_fully_initialized` still
/// reports false for a bare lock and 6R-4 holds unchanged.
///
/// Gated on the file being ABSENT rather than on having just created the
/// directory, so a bare `.vmark` left by an older build is repaired on its next
/// write too — one `is_file` per acquire, against the O(ledger) reconcile the
/// caller performs on the same path.
pub(super) fn ensure_lock_ignore_rules(vmark: &Path) -> Result<(), String> {
    let ignore = vmark.join(".gitignore");
    if ignore.is_file() {
        return Ok(());
    }
    ensure_line(&ignore, "index.db*")?;
    ensure_line(&ignore, "group.lock")
}

/// Is `.vmark` fully initialized? The marker rule alone is NOT a completion
/// protocol (8th-review 8R-6): a checkout or hand-made workspace can carry
/// `.gitattributes` while `.gitignore` and the ledger/snapshot dirs are missing,
/// and `ensure_initialized` would then be skipped forever — leaving `index.db`
/// and `group.lock` committable. Require EVERY structural piece, so any partial
/// state re-initializes.
pub(super) fn is_fully_initialized(vmark: &Path) -> bool {
    fs::read_to_string(vmark.join(".gitattributes"))
        .map(|s| s.lines().any(|l| l.trim() == MERGE_UNION_RULE))
        .unwrap_or(false)
        && vmark.join("ledger").is_dir()
        && vmark.join("snapshots").is_dir()
}

/// Are `.vmark/.gitignore`'s runtime-file rules complete? Separate from
/// `is_fully_initialized` ON PURPOSE (found by dogfooding, 2026-07-20): folding
/// this into the initialized test made a real 119-entry workspace — whose
/// `.gitignore` predated the `group.lock` rule — report `initialized: false`, so
/// `perform_status` skipped the breakdown and showed `open_items: 0` while
/// `edges` correctly returned 5 stale edges. A missing ignore rule means
/// "augment on next write" (`ensure_initialized`), NOT "this isn't a coherence
/// workspace".
pub(super) fn ignore_rules_complete(vmark: &Path) -> bool {
    fs::read_to_string(vmark.join(".gitignore"))
        .map(|s| {
            let has = |rule: &str| s.lines().any(|l| l.trim() == rule);
            has("index.db*") && has("group.lock")
        })
        .unwrap_or(false)
}

/// Append `line` to `path` when absent, preserving existing content
/// (audit R22 — a pre-existing file must still gain the required rules).
/// The write is ATOMIC (7th-review 6R-4): a crash mid-write must never leave a
/// truncated `.gitattributes` that a later `open` would trust as initialized, so
/// the new content is staged in a temp file, fsync'd, then renamed into place.
pub(super) fn ensure_line(path: &Path, line: &str) -> Result<(), String> {
    // Read errors must NEVER become "empty" (9th-review 9R-5). `unwrap_or_default`
    // turned a temporarily-unreadable or non-UTF-8 `.gitignore` into an empty
    // string, and the rename below then replaced the user's real file with one
    // containing only VMark's rule — destroying every rule they had written. The
    // stricter init gate made that previously-dormant path reachable for an
    // otherwise healthy workspace. Only a genuinely ABSENT file is empty; anything
    // else fails closed and leaves the file untouched.
    let existing = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => {
            return Err(format!(
                "init {}: unreadable ({e}) — refusing to overwrite it",
                path.display()
            ))
        }
    };
    if existing.lines().any(|l| l.trim() == line) {
        // The rule is present, but a PREVIOUS call may have returned after a
        // successful rename whose directory fsync failed (9R-5 retry hole). Re-sync
        // the directory so a retry actually completes the durability it skipped.
        if let Some(dir) = path.parent() {
            if let Ok(d) = fs::File::open(dir) {
                d.sync_all()
                    .map_err(|e| format!("init {}: dir fsync: {e}", path.display()))?;
            }
        }
        return Ok(());
    }
    let mut content = existing;
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(line);
    content.push('\n');
    let dir = path
        .parent()
        .ok_or_else(|| format!("init {}: no parent dir", path.display()))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "marker".to_string());
    // UNIQUE temp name + `create_new` (8th-review 8R-7), matching the
    // context-manifest writer. A fixed `.<name>.tmp` is predictable: a planted
    // symlink at that path would be FOLLOWED by `File::create`, truncating an
    // attacker-chosen file outside the workspace. `create_new` refuses to open an
    // existing path (symlink included), and the UUID removes collisions between
    // concurrent initializers.
    let tmp = dir.join(format!(".{name}.{}.tmp", Uuid::now_v7()));
    let write = (|| -> std::io::Result<()> {
        use std::io::Write as _;
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()
    })();
    if let Err(e) = write {
        let _ = fs::remove_file(&tmp); // never leave a stray temp behind
        return Err(format!("init {}: staging: {e}", path.display()));
    }
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("init {}: rename: {e}", path.display()));
    }
    // fsync the DIRECTORY so the rename itself is durable (8R-6): without this the
    // marker can be lost after power loss while the structure it certifies survives.
    //
    // UNIX ONLY. Windows cannot open a directory as a `File` — it returns
    // ERROR_ACCESS_DENIED (os error 5) — so this hard-failed every workspace
    // init there, taking 108 tests down with it. The parent-dir fsync is a
    // POSIX idiom with no std equivalent on Windows, where NTFS journals the
    // rename's metadata itself; skipping it is the correct platform behaviour,
    // not a durability guarantee quietly dropped. Same guard
    // `mcp_config::backup_io::sync_parent_dir` already uses.
    #[cfg(unix)]
    {
        let d =
            fs::File::open(dir).map_err(|e| format!("init {}: dir open: {e}", path.display()))?;
        d.sync_all()
            .map_err(|e| format!("init {}: dir fsync: {e}", path.display()))?;
    }
    Ok(())
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
