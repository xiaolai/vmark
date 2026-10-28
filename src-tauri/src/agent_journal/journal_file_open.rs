//! Opening the journal's files: the owner-only read-write open, the
//! exclusive `<file>.lock` sidecar, the compaction temp name, and the
//! directory fsync that makes a created file's (or directory's) name
//! durable.

use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

use crate::agent_journal::errors::TxnError;

pub(in crate::agent_journal) fn tmp_path(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(".tmp");
    PathBuf::from(s)
}

pub(in crate::agent_journal) fn open_rw(path: &Path) -> io::Result<File> {
    rw_options().create(true).open(path)
}

/// The owner-only read-write options, with no creation flag set (an open
/// with them reaches only an existing file).
pub(in crate::agent_journal) fn rw_options() -> OpenOptions {
    let mut o = OpenOptions::new();
    o.read(true).write(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    o
}

#[cfg(test)]
thread_local! {
    /// The parent directories this thread fsynced (tests only).
    pub(crate) static DIR_SYNCS: std::cell::RefCell<Vec<PathBuf>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

pub(in crate::agent_journal) fn sync_dir(path: &Path) -> io::Result<()> {
    #[cfg(test)]
    DIR_SYNCS.with(|d| {
        d.borrow_mut()
            .push(path.parent().unwrap_or(path).to_path_buf())
    });
    #[cfg(unix)]
    if let Some(dir) = path.parent() {
        File::open(dir)?.sync_all()?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// `create_dir_all(dir)`, then (when `sync`) fsync the parent of every
/// directory it created, outermost first: a new directory's name, like a
/// new file's, survives a power loss only once its parent is synced.
pub(in crate::agent_journal) fn create_dir_durable(dir: &Path, sync: bool) -> io::Result<()> {
    let mut missing = Vec::new();
    let mut at = Some(dir);
    while let Some(d) = at.filter(|d| !d.as_os_str().is_empty()) {
        if d.try_exists()? {
            break;
        }
        missing.push(d);
        at = d.parent();
    }
    std::fs::create_dir_all(dir)?;
    if sync {
        for created in missing.iter().rev() {
            sync_dir(created)?;
        }
    }
    Ok(())
}

/// Rounds of create-then-open `open_created` tries while another process
/// keeps creating and removing the file under it.
const CREATE_ROUNDS: usize = 8;

/// Open `path` with `options` (which set no creation flag), creating it
/// when missing. A creation also fsyncs the parent directory (when `sync`):
/// appends sync the file's data, but a new name survives a power loss only
/// once its directory is synced. Whether this open created the file is
/// decided by the open itself (`create_new`, then an open of the existing
/// file), never by an earlier existence check a removal could outdate.
pub(in crate::agent_journal) fn open_created(
    path: &Path,
    options: impl Fn() -> OpenOptions,
    sync: bool,
) -> io::Result<File> {
    for _ in 0..CREATE_ROUNDS {
        match options().create_new(true).open(path) {
            Ok(file) => {
                if sync {
                    sync_dir(path)?;
                }
                return Ok(file);
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e),
        }
        match options().open(path) {
            Ok(file) => return Ok(file),
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::other(format!(
        "{} kept appearing and disappearing while it was opened",
        path.display()
    )))
}

/// How long a held sidecar lock is retried before the open is refused. A
/// child this process forks shares the lock's open file description until
/// it execs, so a reopen racing a spawn sees the lock held for a moment; a
/// second VMark process holds it for good.
const LOCK_WAIT: std::time::Duration = std::time::Duration::from_secs(1);

/// Take the exclusive sidecar lock for `path`, refusing once another holder
/// has kept it for [`LOCK_WAIT`].
pub(super) fn lock_exclusive(path: &Path) -> Result<File, TxnError> {
    let mut s = path.as_os_str().to_owned();
    s.push(".lock");
    let lock = open_rw(Path::new(&s))?;
    let deadline = std::time::Instant::now() + LOCK_WAIT;
    loop {
        match lock.try_lock() {
            Ok(()) => return Ok(lock),
            Err(std::fs::TryLockError::WouldBlock) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            Err(std::fs::TryLockError::WouldBlock) => {
                return Err(TxnError::Io(format!(
                    "{} is in use by another VMark process",
                    path.display()
                )))
            }
            Err(std::fs::TryLockError::Error(e)) => return Err(e.into()),
        }
    }
}
