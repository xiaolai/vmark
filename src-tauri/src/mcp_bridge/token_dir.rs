//! The directory holding the MCP bridge token, and what its mode means.
//!
//! `token_file.rs` guarantees the token file itself is 0600. That covers one
//! half of the threat: another local user cannot READ our file. It says
//! nothing about the other half — if they can WRITE the directory, they can
//! unlink our file and put their own there, and the sidecar then presents
//! their token to whatever endpoint they chose (audit round 2, item 1).
//!
//! So the two loosenesses get different answers:
//!
//! | Directory | Threat | Answer |
//! |---|---|---|
//! | Readable by others | The file's NAME leaks | Warn, keep going |
//! | Writable by others | The file can be REPLACED | Refuse to publish |

use std::path::Path;

/// Required mode: owner traverse/write only, so another user cannot even
/// enumerate the directory, let alone replace what is in it.
#[cfg(unix)]
const TOKEN_DIR_MODE: u32 = 0o700;

/// Group- and other-write bits — the fatal case.
#[cfg(unix)]
const OTHER_WRITE_BITS: u32 = 0o022;

/// What the directory's observed mode means for the token about to be written
/// into it.
#[cfg(unix)]
#[derive(Debug, Clone, PartialEq, Eq)]
enum DirGuard {
    /// Owner-only. Nothing to report.
    Secured,
    /// Other users can read or traverse the directory but cannot write it.
    /// Carries the warning the caller logs.
    NameVisible(String),
}

/// Apply the policy before a token is written: refuse the fatal case, log the
/// tolerable one.
#[cfg(unix)]
pub(super) fn guard_parent_dir(parent: &Path) -> Result<(), String> {
    match harden_parent_dir(parent)? {
        DirGuard::Secured => {}
        DirGuard::NameVisible(warning) => log::warn!("{warning}"),
    }
    Ok(())
}

/// Windows has no Unix mode; the per-user app data directory's inherited ACLs
/// are what protects the token, and there is nothing here to chmod or judge.
#[cfg(not(unix))]
pub(super) fn guard_parent_dir(_parent: &Path) -> Result<(), String> {
    Ok(())
}

/// Tighten the directory to 0700, then judge what it actually became.
///
/// The chmod is best-effort — a directory this app does not own cannot be
/// changed — so the verdict comes from the **re-stat'ed** mode and never from
/// the chmod's return value. A directory whose mode cannot be read at all is
/// an error: unknown is not the same as safe.
#[cfg(unix)]
fn harden_parent_dir(parent: &Path) -> Result<DirGuard, String> {
    use std::os::unix::fs::PermissionsExt;

    if let Err(e) =
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(TOKEN_DIR_MODE))
    {
        log::debug!("[MCP Bridge] Could not chmod the token directory {parent:?} to 0700: {e}");
    }
    classify_dir_mode(parent, observed_dir_mode(parent)?)
}

/// Decide what an observed mode means. Two very different threats hide under
/// "the directory is loose":
///
/// * **Readable by others** discloses the token file's NAME. The file's own
///   verified 0600 still guards the secret, so this warns and continues —
///   refusing here would trade a working bridge for nothing.
/// * **Writable by others** lets another local user unlink our 0600 file and
///   put their own in its place, so the sidecar authenticates to an endpoint
///   they chose, or reads a token we later write. A file's mode is no defence
///   against replacement of the file, which is why this one is fatal.
///
/// Kept pure over an observed mode because the case that matters — a
/// directory this process cannot chmod — is not reproducible in a unit test
/// without root. The sticky bit would block unlinking a file we own, but this
/// directory is never sticky and a mode-dependent exemption is more subtlety
/// than the case is worth.
#[cfg(unix)]
fn classify_dir_mode(parent: &Path, mode: u32) -> Result<DirGuard, String> {
    if mode & OTHER_WRITE_BITS != 0 {
        return Err(format!(
            "Refusing to publish the MCP bridge token: its directory {} is mode {mode:04o}, \
             writable by other local users, so the token file could be replaced underneath \
             the sidecar. Set it to {TOKEN_DIR_MODE:04o} (chmod 700) and start the bridge again.",
            parent.display()
        ));
    }
    if mode == TOKEN_DIR_MODE {
        return Ok(DirGuard::Secured);
    }
    Ok(DirGuard::NameVisible(format!(
        "[MCP Bridge] The token directory {} is mode {mode:04o}, not {TOKEN_DIR_MODE:04o}: \
         another local user can see that the token file exists. They cannot read or replace \
         it — the file is enforced 0600 and the directory is not writable by them.",
        parent.display()
    )))
}

/// The directory's current mode, masked to the permission bits.
#[cfg(unix)]
fn observed_dir_mode(parent: &Path) -> Result<u32, String> {
    // Test seam: the fatal case is a directory this process cannot chmod, and
    // creating one needs root. Compiled out of every non-test build.
    #[cfg(test)]
    {
        if let Some(forced) = FORCED_DIR_MODE.with(|cell| cell.get()) {
            return Ok(forced);
        }
    }
    use std::os::unix::fs::PermissionsExt;

    Ok(std::fs::metadata(parent)
        .map_err(|e| format!("failed to stat {parent:?}: {e}"))?
        .permissions()
        .mode()
        & 0o777)
}

#[cfg(all(unix, test))]
thread_local! {
    static FORCED_DIR_MODE: std::cell::Cell<Option<u32>> = const { std::cell::Cell::new(None) };
}

/// Make [`observed_dir_mode`] report `mode` for the current thread, so the
/// unchmod-able directory can be simulated. Cargo runs each test on its own
/// thread, so this cannot leak between them.
#[cfg(all(unix, test))]
pub(super) fn force_observed_dir_mode(mode: Option<u32>) {
    FORCED_DIR_MODE.with(|cell| cell.set(mode));
}

#[cfg(test)]
#[path = "token_dir.test.rs"]
mod tests;
