//! A rename that never replaces: the publication step of a no-replace save.
//!
//! Purpose: Save As to a destination that is not the tab's own file must not
//! overwrite a file someone created after the frontend's existence probe. The
//! kernel makes "publish only if absent" one atomic step, relative to the held
//! folder descriptor so a swapped ancestor cannot redirect it:
//!
//! - macOS: `renameatx_np(.., RENAME_EXCL)`;
//! - Linux: `renameat2(.., RENAME_NOREPLACE)` through the raw syscall, so it
//!   links against every libc (the glibc wrapper is newer than the syscall);
//! - any other Unix: refused as unsupported.
//!
//! Key decisions: a filesystem that cannot do an exclusive rename yields
//! `ErrorKind::Unsupported`, never a fallback to a replacing rename — a
//! check-then-rename would reopen the very race this closes. A file already
//! at the name yields `ErrorKind::AlreadyExists`.
//!
//! @coordinates-with files/write/anchored.rs — `HeldDir::publish` calls this
//! @module files/write/rename_excl

use std::ffi::CStr;
use std::io;

/// Rename `from` to `to` inside the folder `dir`, failing with
/// `AlreadyExists` when `to` exists and `Unsupported` when the volume cannot
/// refuse atomically.
pub(crate) fn rename_no_replace(dir: libc::c_int, from: &CStr, to: &CStr) -> io::Result<()> {
    raw_rename_no_replace(dir, from, to).map_err(classify)
}

/// The OS result of a C call: `-1` reads `errno`.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn os_result(r: libc::c_long) -> io::Result<()> {
    if r < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn raw_rename_no_replace(dir: libc::c_int, from: &CStr, to: &CStr) -> io::Result<()> {
    // SAFETY: `dir` is an open folder descriptor owned by the caller; both
    // names are NUL-terminated and outlive the call.
    let r = unsafe { libc::renameatx_np(dir, from.as_ptr(), dir, to.as_ptr(), libc::RENAME_EXCL) };
    os_result(libc::c_long::from(r))
}

#[cfg(target_os = "linux")]
fn raw_rename_no_replace(dir: libc::c_int, from: &CStr, to: &CStr) -> io::Result<()> {
    // SAFETY: as above; the syscall takes (olddirfd, old, newdirfd, new, flags).
    let r = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            dir,
            from.as_ptr(),
            dir,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    os_result(r)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn raw_rename_no_replace(_dir: libc::c_int, _from: &CStr, _to: &CStr) -> io::Result<()> {
    Err(io::Error::from(io::ErrorKind::Unsupported))
}

/// Name the two outcomes the caller branches on; keep every other error.
fn classify(error: io::Error) -> io::Error {
    match error.raw_os_error() {
        Some(libc::EEXIST) => io::Error::from(io::ErrorKind::AlreadyExists),
        Some(code) if is_unsupported(code) => io::Error::new(io::ErrorKind::Unsupported, error),
        _ => error,
    }
}

/// `ENOTSUP`/`EOPNOTSUPP`: the volume has no exclusive rename. On Linux
/// `ENOSYS` (kernel without renameat2) and `EINVAL` (filesystem rejects the
/// flag) mean the same; the two names are siblings in one folder, so no other
/// `EINVAL` cause applies.
fn is_unsupported(code: libc::c_int) -> bool {
    if code == libc::ENOTSUP || code == libc::EOPNOTSUPP {
        return true;
    }
    cfg!(target_os = "linux") && (code == libc::ENOSYS || code == libc::EINVAL)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;
    use std::os::fd::AsRawFd;

    #[test]
    fn already_exists_and_unsupported_are_named() {
        let exists = classify(io::Error::from_raw_os_error(libc::EEXIST));
        assert_eq!(exists.kind(), io::ErrorKind::AlreadyExists);
        let unsupported = classify(io::Error::from_raw_os_error(libc::ENOTSUP));
        assert_eq!(unsupported.kind(), io::ErrorKind::Unsupported);
        let other = classify(io::Error::from_raw_os_error(libc::EACCES));
        assert_eq!(other.raw_os_error(), Some(libc::EACCES));
    }

    #[test]
    fn refuses_an_existing_name_and_moves_onto_an_absent_one() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a"), "a").unwrap();
        std::fs::write(tmp.path().join("b"), "b").unwrap();
        let dir = std::fs::File::open(tmp.path()).unwrap();
        let name = |s: &str| CString::new(s).unwrap();

        let err = rename_no_replace(dir.as_raw_fd(), &name("a"), &name("b")).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read_to_string(tmp.path().join("b")).unwrap(), "b");

        rename_no_replace(dir.as_raw_fd(), &name("a"), &name("c")).unwrap();
        assert_eq!(std::fs::read_to_string(tmp.path().join("c")).unwrap(), "a");
        assert!(!tmp.path().join("a").exists());
    }
}
