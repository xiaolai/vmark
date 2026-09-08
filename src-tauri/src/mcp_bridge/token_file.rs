//! The MCP bridge port-discovery file — and the secret inside it.
//!
//! The file holds `{port}:{token}`, and that token is the *only* thing
//! standing between a different-UID process and full authority over the
//! editor. Its mode is therefore a security control, not a detail (WI-9,
//! audit 20260728 §2.2).
//!
//! Before this module the 0600 mode was an ACCIDENT: `tempfile::NamedTempFile`
//! happens to create 0600 files, `atomic_replace::preserve_target_permissions`
//! then carries whatever mode the target already had forward on every
//! rewrite, and the parent directory came from a bare `create_dir_all` whose
//! result depends on the process umask. So a file that ever became 0644 —
//! restored from a backup, copied by a migration, created before this code —
//! stayed 0644 forever, silently.
//!
//! The shape adopted here is Jupyter's `secure_write`, with the ordering
//! fixed (audit round 1, finding 1): the token goes to a temp file that is set
//! to 0600 **before a byte of it is written** and **re-stat'ed immediately
//! before the rename**, so it is never reachable under a name at the wrong
//! mode and the staging window rests on this file's own enforcement rather
//! than on `NamedTempFile`'s default (audit 20260907 #388). A bridge that
//! cannot protect its token does not start, and it does not leave the token
//! behind when it refuses.
//!
//! The publication itself is `atomic_replace::persist_with_retry` — the one
//! copy of the Windows replacement rule (audit 20260907 #389).
//!
//! The half of the threat a file mode cannot cover — another user REPLACING
//! the file rather than reading it — belongs to the directory, and lives in
//! `token_dir.rs`.

use crate::app_paths;
use std::io::Write;
use std::path::Path;
use tauri::AppHandle;
use tempfile::NamedTempFile;

/// Required mode of the token file: owner read/write only.
#[cfg(unix)]
const TOKEN_FILE_MODE: u32 = 0o600;

// Windows has no Unix mode to set; ACLs are inherited from the per-user app
// data directory. The constant still exists so the call sites are shared.
#[cfg(not(unix))]
const TOKEN_FILE_MODE: u32 = 0;

/// Write the port and auth token to the port file for MCP sidecar discovery.
/// Format: `{port}:{token}` — the sidecar sends that token in the auth
/// handshake. Atomic, so the sidecar never reads a partial line.
pub(crate) fn write_port_file(app: &AppHandle, port: u16, token: &str) -> Result<(), String> {
    let path = app_paths::get_port_file_path(app)?;
    write_port_file_at(&path, port, token)?;
    log::debug!("[MCP Bridge] Port {port} written to {path:?} (0600, with auth token)");
    Ok(())
}

/// Path-taking core of [`write_port_file`], so the permission contract is
/// testable without a Tauri app handle.
pub(crate) fn write_port_file_at(path: &Path, port: u16, token: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Cannot determine parent directory of {path:?}"))?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create app data directory {parent:?}: {e}"))?;
    // Fatal when the directory is writable by others, a warning when it is
    // merely visible to them (audit round 2, item 1 — see `token_dir`).
    super::token_dir::guard_parent_dir(parent)?;

    let content = format!("{port}:{token}");
    write_secured(path, parent, content.as_bytes())?;

    // Defence in depth. `write_secured` verified 0600 on the inode *before*
    // it had this name, so a mismatch here should be impossible; if the
    // published file is anything else, delete it rather than leave a readable
    // secret on disk.
    if let Err(e) = verify_mode(path, TOKEN_FILE_MODE) {
        return Err(abandon_unprotected_token(path, e));
    }
    Ok(())
}

/// Remove the port file when the bridge stops.
/// Logs errors for non-NotFound failures (permission issues, etc.)
pub fn remove_port_file<R: tauri::Runtime>(app: &AppHandle<R>) {
    match app_paths::get_port_file_path(app) {
        Ok(path) => match std::fs::remove_file(&path) {
            Ok(()) => log::debug!("[MCP Bridge] Port file removed: {path:?}"),
            // Already removed — not an error.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => log::warn!("[MCP Bridge] Failed to remove port file {path:?}: {e}"),
        },
        Err(e) => log::warn!("[MCP Bridge] Cannot determine port file path: {e}"),
    }
}

// ---------------------------------------------------------------------------
// The secure write
// ---------------------------------------------------------------------------

/// Stage the contents in a temp file, lock that file to 0600, verify it, and
/// only then rename it over `path`.
///
/// Deliberately NOT `app_paths::atomic_write_file` (audit round 1, finding 1):
/// that writer *preserves the target's* permissions, which is right for user
/// documents and wrong for a secret. A target that was 0644 handed 0644 to
/// the temp file, so the new token was published world-readable and a chmod
/// afterwards was the only thing that narrowed it — a window in which the
/// live token is readable by every local user. Here the file is 0600 before
/// it has a name, so there is no window and no dependence on the target's
/// existing mode.
///
/// The staged file is removed on every failure path by `NamedTempFile`'s
/// `Drop`, so a refusal never leaks a copy of the token.
fn write_secured(path: &Path, parent: &Path, contents: &[u8]) -> Result<(), String> {
    let mut temp = NamedTempFile::new_in(parent)
        .map_err(|e| format!("Failed to create temp file in {parent:?}: {e}"))?;

    // BEFORE the secret is written, not after it (audit 20260907 #388). The
    // old order set the mode immediately before the rename, which protects the
    // published name but leaves the staging window resting on `NamedTempFile`'s
    // default — the exact dependency this module's header says it exists to
    // remove. tempfile 3.27 opens with `mode(0o600)` on Unix and a umask can
    // only clear bits, so the window was never actually wider than 0600; the
    // point is that the guarantee is now this file's own and re-stat'ed, not
    // inherited from a dependency's implementation detail.
    enforce_mode(temp.path(), TOKEN_FILE_MODE)
        .map_err(|e| format!("Refusing to expose the MCP bridge token: {e}"))?;

    temp.write_all(contents)
        .map_err(|e| format!("Failed to write temp file: {e}"))?;
    temp.flush()
        .map_err(|e| format!("Failed to flush temp file: {e}"))?;
    temp.as_file()
        .sync_all()
        .map_err(|e| format!("Failed to sync temp file: {e}"))?;

    // Re-stat immediately before the rename: `set_permissions` can succeed
    // nominally on a filesystem that does not honour Unix modes, and the write
    // above is the only thing between the two checks.
    verify_mode(temp.path(), TOKEN_FILE_MODE)
        .map_err(|e| format!("Refusing to expose the MCP bridge token: {e}"))?;

    // `persist` is the atomic rename, and it REPLACES an existing target on
    // EVERY platform: Unix `rename(2)` does, and on Windows `NamedTempFile`
    // calls `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING` (tempfile 3.27.0
    // `file/imp/windows.rs`, reached with `overwrite: true`).
    //
    // There used to be a Windows-only `remove_file(path)` + retry here, on the
    // premise that Windows `rename` refuses an existing target. That premise is
    // false, and the fallback was DESTRUCTIVE (audit 20260907 #389): it fired on
    // ANY persist failure — a transient sharing refusal from an antivirus
    // scanner included — so it deleted the live token file and then failed to
    // rewrite it, leaving the bridge's only credential gone. `atomic_replace.rs`
    // had the identical defect and the identical false premise (audit 20260906
    // B1); removing it there without a retry turned CI's Windows leg red with
    // `os error 5`, because the second attempt was the thing that had been
    // absorbing the contention by accident.
    //
    // So this uses the ONE retry that survived that: `persist_with_retry`
    // retries the atomic move itself, which means the previous token file holds
    // its bytes until a move succeeds, and if every attempt fails it is exactly
    // as it was.
    crate::atomic_persist::persist_with_retry(temp, path).map_err(|e| {
        format!(
            "Failed to persist {path:?}: {}",
            crate::command_error::CommandError::from(e).message()
        )
    })
}

/// Delete a token file whose published mode could not be verified, folding a
/// cleanup failure into the message the caller reports.
///
/// Discarding the `remove_file` result (audit round 1, finding 2) let this
/// return "refusing to expose the token" while the readable token was still
/// sitting on disk — telling the operator the opposite of what happened.
fn abandon_unprotected_token(path: &Path, cause: String) -> String {
    let prefix = format!("Refusing to expose the MCP bridge token: {cause}");
    match std::fs::remove_file(path) {
        Ok(()) => prefix,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => prefix,
        Err(e) => format!(
            "{prefix}; and the unprotected file could not be removed: {e} — \
             delete {path:?} by hand"
        ),
    }
}

// ---------------------------------------------------------------------------
// Unix permission enforcement
// ---------------------------------------------------------------------------

/// Set `path` to `mode`, then re-stat to confirm the filesystem agreed.
///
/// The re-stat is the point: `set_permissions` can succeed nominally on
/// filesystems that do not honour Unix modes, and the caller must not assume
/// a secret is protected when it is not.
#[cfg(unix)]
fn enforce_mode(path: &Path, mode: u32) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
        .map_err(|e| format!("failed to set {path:?} to {mode:04o}: {e}"))?;
    verify_mode(path, mode)
}

/// Re-stat `path` and confirm its mode is exactly `want`.
#[cfg(unix)]
fn verify_mode(path: &Path, want: u32) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let got = std::fs::metadata(path)
        .map_err(|e| format!("failed to stat {path:?}: {e}"))?
        .permissions()
        .mode()
        & 0o777;
    if got != want {
        return Err(format!("{path:?} is mode {got:04o}, expected {want:04o}"));
    }
    Ok(())
}

#[cfg(not(unix))]
fn enforce_mode(_path: &Path, _mode: u32) -> Result<(), String> {
    Ok(())
}

#[cfg(not(unix))]
fn verify_mode(_path: &Path, _want: u32) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
#[path = "token_file.test.rs"]
mod tests;
