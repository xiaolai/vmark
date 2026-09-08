//! An open directory, and every operation named relative to it — Unix only.
//!
//! A path is a NAME, and a name can mean something else a syscall later. A
//! descriptor cannot: it holds the directory itself, so `..`, `mkdirat`,
//! `openat`, `fstatat` and `renameat` all act on the directory this process
//! opened, whatever its path resolves to by then. That is the whole technique
//! behind `commit_dir.rs` (the write) and `ensure_dir.rs` (the missing
//! parents) — #257.
//!
//! Containment is proved the same way: `assert_within` climbs `..` from the
//! descriptor to the workspace root's, comparing (device, inode). `..` is a
//! real entry in a directory, not a path lookup, so nothing a symlink can do
//! changes the walk's answer — and it is the same relation the older
//! `canonical.starts_with(root)` string compare was approximating.
//!
//! @coordinates-with commit_dir.rs — the descriptor-anchored save
//! @coordinates-with ensure_dir.rs — the descriptor-anchored mkdir walk
//! @module workflow::dir_fd

use std::ffi::{CString, OsStr};
use std::fs::File;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::os::unix::io::{AsRawFd, FromRawFd, RawFd};
use std::path::Path;

/// How far the containment walk climbs before giving up. A workspace
/// nested deeper than this is not a workspace.
const MAX_WALK: usize = 256;

/// An open directory. Every operation below is relative to it, so the
/// directory an operation reaches is the one this descriptor names — not
/// whatever its path resolves to at the time.
pub(super) struct Dir {
    file: File,
}

impl Dir {
    pub(super) fn open(path: &Path) -> Result<Self, String> {
        let file =
            File::open(path).map_err(|e| format!("cannot open {}: {}", path.display(), e))?;
        if !file
            .metadata()
            .map_err(|e| format!("cannot stat {}: {}", path.display(), e))?
            .is_dir()
        {
            return Err(format!("{} is not a directory", path.display()));
        }
        Ok(Self { file })
    }

    pub(super) fn fd(&self) -> RawFd {
        self.file.as_raw_fd()
    }

    /// The (device, inode) pair that identifies this directory. Read from
    /// the open descriptor, so it names the directory we hold rather than
    /// whatever a path lookup would find now.
    pub(super) fn id(&self) -> Result<(u64, u64), String> {
        let meta = self
            .file
            .metadata()
            .map_err(|e| format!("cannot stat an open directory: {e}"))?;
        Ok((meta.dev(), meta.ino()))
    }

    pub(super) fn try_clone(&self) -> Result<Self, String> {
        let file = self
            .file
            .try_clone()
            .map_err(|e| format!("cannot duplicate a directory descriptor: {e}"))?;
        Ok(Self { file })
    }

    /// `openat(self, "..")`. On a directory descriptor `..` is an entry,
    /// not a path lookup, so this climbs the REAL tree.
    pub(super) fn parent(&self) -> Result<Self, String> {
        let dotdot = CString::new("..").expect("`..` has no interior NUL");
        self.open_at(&dotdot, 0)
            .map_err(|e| format!("cannot open a parent directory: {e}"))
    }

    /// `openat(self, name, O_DIRECTORY | O_NOFOLLOW)` — the child directory
    /// this directory holds under that name, and only that: a symlink at the
    /// name fails with `ELOOP` rather than being followed.
    pub(super) fn open_child(&self, name: &CString) -> Result<Self, String> {
        self.open_at(name, libc::O_NOFOLLOW).map_err(|e| {
            format!(
                "cannot open {:?} as a directory inside the workspace: {e}",
                name
            )
        })
    }

    fn open_at(&self, name: &CString, extra: libc::c_int) -> Result<Self, std::io::Error> {
        // SAFETY: `self.fd()` is an open directory descriptor owned by
        // `self.file`, `name` is a NUL-terminated C string that outlives the
        // call, and the returned descriptor is handed straight to `File`,
        // which owns and closes it.
        let fd = unsafe {
            libc::openat(
                self.fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | extra,
            )
        };
        let fd = checked_fd(fd)?;
        // SAFETY: `fd` is a fresh, valid descriptor this call just took
        // ownership of, and nothing else holds it.
        Ok(Self {
            file: unsafe { File::from_raw_fd(fd) },
        })
    }

    /// `mkdirat(self, name)`. An existing entry is not an error — the caller
    /// then proves what it is by opening it with `open_child`, which refuses
    /// a symlink.
    pub(super) fn mkdir(&self, name: &CString) -> Result<(), String> {
        // SAFETY: `self.fd()` is an open directory descriptor and `name` is a
        // NUL-terminated C string that outlives the call.
        let rc = unsafe { libc::mkdirat(self.fd(), name.as_ptr(), 0o777) };
        match checked(rc) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
            Err(e) => Err(format!("cannot create {:?}: {e}", name)),
        }
    }

    /// Is `name`, looked up in THIS directory without following a link,
    /// the file `file` refers to?
    ///
    /// `Ok(false)` means the lookup SUCCEEDED and named something else — or
    /// nothing at all. A stat that failed for any other reason is an error
    /// (#534): every one of them used to collapse into `Ok(false)`, and the
    /// caller renders that as "<parent> resolves outside the workspace" — a
    /// containment refusal, which is the one thing an `EIO` or an `EACCES` is
    /// not, and the one message that sends a reader looking for an attack.
    pub(super) fn holds(&self, name: &CString, file: &File) -> Result<bool, String> {
        let want = file
            .metadata()
            .map_err(|e| format!("cannot stat the temp file: {e}"))?;
        let mut found: libc::stat = unsafe { std::mem::zeroed() };
        // SAFETY: `self.fd()` is an open directory descriptor, `name` is a
        // NUL-terminated C string that outlives the call, and `found` is a
        // live, correctly-sized `libc::stat` this call fills in.
        let rc = unsafe {
            libc::fstatat(
                self.fd(),
                name.as_ptr(),
                &mut found,
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        match checked(rc) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(format!("cannot stat {name:?} in the target directory: {e}")),
        }
        Ok(found.st_dev as u64 == want.dev() && found.st_ino as u64 == want.ino())
    }

    /// `renameat(self, from, self, to)` — both operands relative to this
    /// descriptor, so the result lands here and nowhere else.
    pub(super) fn rename(&self, from: &CString, to: &CString) -> Result<(), String> {
        // SAFETY: `self.fd()` is an open directory descriptor and both
        // names are NUL-terminated C strings that outlive the call.
        let rc = unsafe { libc::renameat(self.fd(), from.as_ptr(), self.fd(), to.as_ptr()) };
        checked(rc).map_err(|e| format!("rename failed: {e}"))
    }

    /// `unlinkat(self, name)`. Reports its own failure (#535): this is how a
    /// temp file holding the user's document is removed after a rename that
    /// did not happen, and discarding the result left that content on disk
    /// with nothing anywhere saying so. An entry that is already gone is the
    /// intended end state, not a failure.
    pub(super) fn unlink(&self, name: &CString) -> Result<(), String> {
        // SAFETY: as `rename` — an open directory descriptor and a
        // NUL-terminated name that outlives the call.
        let rc = unsafe { libc::unlinkat(self.fd(), name.as_ptr(), 0) };
        match checked(rc) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("cannot remove {name:?}: {e}")),
        }
    }

    /// Make the rename durable. Best-effort: the bytes are already synced
    /// and the rename already happened, so a failure here is a note in the
    /// log, not a failed save.
    pub(super) fn sync(&self) {
        if let Err(e) = self.file.sync_all() {
            log::warn!("[workflow] could not fsync a directory after a save: {e}");
        }
    }

    /// `self` must be the workspace root, or a descendant of it. Proved by
    /// climbing `..` and comparing identities — no path is resolved, so a
    /// symlink swapped anywhere cannot change the answer.
    pub(super) fn assert_within(&self, root: &Dir, shown: &Path) -> Result<(), String> {
        let root_id = root.id()?;
        let mut current = self.try_clone()?;
        for _ in 0..MAX_WALK {
            let here = current.id()?;
            if here == root_id {
                return Ok(());
            }
            let up = current.parent()?;
            if up.id()? == here {
                // `/` is its own parent: the walk left the tree without
                // meeting the workspace.
                break;
            }
            current = up;
        }
        Err(format!(
            "{} resolves outside the workspace",
            shown.display()
        ))
    }
}

/// A syscall's return code as a `Result` — the ONE place `-1` becomes an
/// `io::Error` (audit 20260907 #533).
///
/// Five call sites hand-wrote `if rc != 0 { last_os_error() }` and then applied
/// their own policy to the result, and the two halves drifted into five
/// slightly different shapes for one idiom. Splitting them apart leaves each
/// function's policy — `mkdirat` forgiving `EEXIST` (its caller proves what is
/// there with `open_child`), `fstatat` and `unlinkat` forgiving `ENOENT`
/// (#534, #535), `renameat` forgiving nothing — visible as the only thing that
/// differs between them.
///
/// `errno` MUST be read immediately: any intervening call can overwrite it.
fn checked(rc: libc::c_int) -> Result<(), std::io::Error> {
    if rc == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

/// `checked`, for the calls that return a DESCRIPTOR rather than a status —
/// where the failure sentinel is negative, not non-zero.
fn checked_fd(fd: libc::c_int) -> Result<libc::c_int, std::io::Error> {
    if fd < 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(fd)
    }
}

pub(super) fn c_name(name: &OsStr) -> Result<CString, String> {
    CString::new(name.as_bytes()).map_err(|_| format!("{:?} is not a usable file name", name))
}
