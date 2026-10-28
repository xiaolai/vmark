//! Saving through a HELD folder (Unix).
//!
//! Purpose: the webview names a path; `files::write` resolves it once, and the
//! workspace-grant list guard judges the result. A path is only a NAME,
//! though: a folder on it swapped for a link after the check would take the
//! write somewhere else — onto the list included. So on Unix the folder is
//! OPENED once, the guard judges that open folder by identity (device, inode),
//! and the temp file, the rename over the target, and the exclusive create all
//! name their entries relative to it (`openat`, `renameat`, `fsync`). Whatever
//! the path means by then, the write lands in the folder that was judged.
//! Prior art: `workflow/dir_fd.rs`, which anchors workflow saves the same way.
//!
//! Residual, stated rather than claimed closed:
//!   - Opening the folder follows its path ONCE. If a component was swapped
//!     before that open, the held folder is the swapped-in one. The guard
//!     judges exactly that folder, so the list stays out of reach, but the
//!     save lands where the swap pointed rather than where the user meant.
//!   - Windows has no `openat`/`renameat` in std, so the save stays path-based
//!     there (`atomic_replace`), guarded by name and by identity
//!     (`workspace/grants/protect.rs`); a folder swapped between that check
//!     and the rename is not caught.
//!
//! Metadata is carried as `atomic_replace` carries it — permission bits and
//! (macOS) extended attributes such as Finder tags, BEFORE the temp file is
//! synced — but read from the existing entry opened through the held
//! folder, never by path.
//!
//! @coordinates-with files/write.rs — write_ordered, create_checked
//! @coordinates-with workspace/grants/protect.rs — held_write_reaches_list
//! @module files/write/anchored

use std::ffi::{CString, OsStr};
use std::fs::File;
use std::io::{self, Write};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::os::unix::io::{AsRawFd, FromRawFd};
use std::path::Path;

use super::{rename_excl, Publish};

/// A folder held open. Every operation names its entries relative to it.
pub(crate) struct HeldDir {
    dir: File,
}

/// Why an anchored write failed, by the stage `atomic_replace` would name,
/// or why a no-replace publication refused.
pub(crate) enum Stage {
    CreateTemp(io::Error),
    WriteTemp(io::Error),
    SyncTemp(io::Error),
    Persist(io::Error),
    /// No-replace: a file was already at the name; it is untouched.
    TargetExists,
    /// No-replace: the volume cannot rename without replacing; refused.
    NoReplaceUnsupported,
}

fn c_name(name: &OsStr) -> io::Result<CString> {
    CString::new(name.as_bytes()).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))
}

fn cvt(result: libc::c_int) -> io::Result<libc::c_int> {
    if result < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(result)
    }
}

impl HeldDir {
    /// Open the folder at `path` (following it, once).
    pub(crate) fn open(path: &Path) -> io::Result<Self> {
        let path = CString::new(path.as_os_str().as_bytes())
            .map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
        let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC;
        // SAFETY: `path` is a valid NUL-terminated string; the returned fd is
        // owned by the `File` built from it and closed on drop.
        let fd = cvt(unsafe { libc::open(path.as_ptr(), flags) })?;
        Ok(Self {
            // SAFETY: `fd` is the descriptor `open` just returned (`cvt` turned
            // the error value into `Err`), and nothing else owns it; the `File`
            // takes sole ownership and closes it on drop.
            dir: unsafe { File::from_raw_fd(fd) },
        })
    }

    /// (device, inode) of the held folder — what the guard judges.
    pub(crate) fn identity(&self) -> io::Result<(u64, u64)> {
        let meta = self.dir.metadata()?;
        Ok((meta.dev(), meta.ino()))
    }

    /// (device, inode) of the entry `name`, not following a link; `None` when
    /// nothing is there.
    pub(crate) fn entry_identity(&self, name: &OsStr) -> io::Result<Option<(u64, u64)>> {
        let name = c_name(name)?;
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        // SAFETY: `stat` is written by `fstatat` before it is read, and only
        // read when the call succeeded.
        let result = unsafe {
            libc::fstatat(
                self.dir.as_raw_fd(),
                name.as_ptr(),
                stat.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        match cvt(result) {
            Ok(_) => {
                // SAFETY: `fstatat` returned success, so it wrote the whole struct.
                let stat = unsafe { stat.assume_init() };
                // `dev_t`/`ino_t` differ in width and sign across Unixes
                // (`dev_t` is `i32` on macOS, `u64` on Linux); the casts give
                // every platform the same (u64, u64) that `MetadataExt` does.
                #[allow(clippy::unnecessary_cast)]
                Ok(Some((stat.st_dev as u64, stat.st_ino as u64)))
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn open_at(&self, name: &OsStr, flags: libc::c_int, mode: libc::c_uint) -> io::Result<File> {
        let name = c_name(name)?;
        let flags = flags | libc::O_CLOEXEC | libc::O_NOFOLLOW;
        // SAFETY: valid dir fd and NUL-terminated name; the fd is owned by the
        // returned `File`.
        let fd = cvt(unsafe { libc::openat(self.dir.as_raw_fd(), name.as_ptr(), flags, mode) })?;
        // SAFETY: `fd` is the descriptor `openat` just returned (`cvt` turned the
        // error value into `Err`), and nothing else owns it.
        Ok(unsafe { File::from_raw_fd(fd) })
    }

    /// `O_CREAT | O_EXCL` in the held folder; never follows a link at `name`.
    pub(crate) fn create_new(&self, name: &OsStr) -> io::Result<File> {
        self.open_at(name, libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL, 0o644)
    }

    /// Rename `from` to `to` in the held folder: replacing whatever is at
    /// `to`, or (no-replace) refusing when anything is there.
    fn rename(&self, from: &OsStr, to: &OsStr, mode: Publish) -> Result<(), Stage> {
        let (from, to) = (
            c_name(from).map_err(Stage::Persist)?,
            c_name(to).map_err(Stage::Persist)?,
        );
        let fd = self.dir.as_raw_fd();
        match mode {
            // SAFETY: valid dir fd and NUL-terminated names.
            Publish::Replace => cvt(unsafe { libc::renameat(fd, from.as_ptr(), fd, to.as_ptr()) })
                .map(|_| ())
                .map_err(Stage::Persist),
            Publish::NoReplace => {
                rename_excl::rename_no_replace(fd, &from, &to).map_err(|e| match e.kind() {
                    io::ErrorKind::AlreadyExists => Stage::TargetExists,
                    io::ErrorKind::Unsupported => Stage::NoReplaceUnsupported,
                    _ => Stage::Persist(e),
                })
            }
        }
    }

    fn unlink(&self, name: &OsStr) {
        if let Ok(name) = c_name(name) {
            // SAFETY: valid dir fd and NUL-terminated name. Best-effort cleanup.
            unsafe { libc::unlinkat(self.dir.as_raw_fd(), name.as_ptr(), 0) };
        }
    }

    /// [`HeldDir::publish`] replacing whatever is at `name`.
    #[cfg(test)]
    pub(crate) fn replace(&self, name: &OsStr, contents: &[u8]) -> Result<(), Stage> {
        self.publish(name, contents, Publish::Replace)
    }

    /// Atomically publish `contents` at `name` in the held folder: a temp
    /// file created beside it, metadata carried, synced, renamed into place.
    /// `Publish::NoReplace` renames only if nothing is at `name` at that
    /// instant — one kernel operation, so a file created after any earlier
    /// check is still never replaced. On any failure the temp file is removed
    /// and the existing entry untouched.
    pub(crate) fn publish(
        &self,
        name: &OsStr,
        contents: &[u8],
        mode: Publish,
    ) -> Result<(), Stage> {
        let temp_name = format!(".vmark-save-{}.tmp", uuid::Uuid::new_v4());
        let temp_name = OsStr::new(&temp_name);
        let mut temp = self
            .open_at(
                temp_name,
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
                0o600,
            )
            .map_err(Stage::CreateTemp)?;
        let result = (|| {
            temp.write_all(contents).map_err(Stage::WriteTemp)?;
            // A no-replace publication creates a new file: nothing to inherit.
            if mode == Publish::Replace {
                self.carry_metadata(name, &temp);
            }
            temp.sync_all().map_err(Stage::SyncTemp)?;
            #[cfg(test)]
            super::publish_hook::run(name);
            self.rename(temp_name, name, mode)
        })();
        if result.is_err() {
            self.unlink(temp_name);
            return result;
        }
        if let Err(e) = self.dir.sync_all() {
            log::warn!("Failed to sync the folder after an atomic write: {e}");
        }
        Ok(())
    }

    /// Copy the existing entry's permission bits (and, on macOS, extended
    /// attributes) onto `temp`, reading the entry through the held folder.
    /// Best-effort, like `atomic_replace`: metadata never costs the content.
    fn carry_metadata(&self, name: &OsStr, temp: &File) {
        let existing = match self.open_at(name, libc::O_RDONLY, 0) {
            Ok(file) => file,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return,
            Err(e) => {
                log::warn!("Failed to read the saved file's metadata: {e}");
                return;
            }
        };
        match existing.metadata() {
            Ok(meta) => {
                if let Err(e) = temp.set_permissions(meta.permissions()) {
                    log::warn!("Failed to preserve permissions across a save: {e}");
                }
            }
            Err(e) => log::warn!("Failed to read permissions across a save: {e}"),
        }
        #[cfg(target_os = "macos")]
        carry_xattrs(&existing, temp);
    }
}

#[cfg(target_os = "macos")]
fn carry_xattrs(existing: &File, temp: &File) {
    use xattr::FileExt;
    let names = match existing.list_xattr() {
        Ok(names) => names,
        Err(e) => {
            log::warn!("Failed to list extended attributes across a save: {e}");
            return;
        }
    };
    for name in names {
        match existing.get_xattr(&name) {
            Ok(Some(value)) => {
                if let Err(e) = temp.set_xattr(&name, &value) {
                    log::warn!("Failed to preserve xattr {name:?} across a save: {e}");
                }
            }
            Ok(None) => {}
            Err(e) => log::warn!("Failed to read xattr {name:?} across a save: {e}"),
        }
    }
}

#[cfg(test)]
#[path = "anchored.test.rs"]
mod tests;
