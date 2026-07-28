//! Timestamped, collision-proof, permission-preserving config backups.
//!
//! Split out of `install_io.rs` so the backup contract can be tested on its
//! own, without a wall clock in the way. Three properties matter, and each
//! one is a bug that shipped:
//!
//! 1. **Never clobber.** `fs::copy` truncates its destination and the
//!    timestamp is only second-granular, so two installs in the same second
//!    destroyed the first backup. `create_new(true)` makes the OS refuse.
//! 2. **Never widen permissions.** `create_new` alone gives the backup the
//!    process default (0644 under a typical umask), so a private 0600
//!    `~/.claude.json` — paths, env values, tokens — became a
//!    world-readable copy sitting next to it.
//! 3. **Be durable before the original is replaced.** An unflushed,
//!    unsynced backup that a crash loses is not a backup; the caller is
//!    about to overwrite the only other copy.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use chrono::Local;

/// Upper bound on backup-name variants tried for one base name.
const MAX_BACKUP_ATTEMPTS: u32 = 100;

/// The `-N` collision variant of a backup base path.
fn with_suffix(base: &Path, attempt: u32) -> PathBuf {
    let base_name = base
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "config.backup".to_string());
    base.with_file_name(format!("{}-{}", base_name, attempt))
}

/// `<config>.backup.<YYYYmmdd_HHMMSS>` beside the config.
pub(crate) fn generate_backup_path(config_path: &Path) -> PathBuf {
    let timestamp = Local::now().format("%Y%m%d_%H%M%S");
    let file_name = config_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "config".to_string());
    config_path.with_file_name(format!("{}.backup.{}", file_name, timestamp))
}

/// The source file's permission bits, or a private default when it cannot be
/// read. Defaulting *narrow* is the safe direction: an over-restrictive
/// backup is an inconvenience, an over-permissive one is a disclosure.
#[cfg(unix)]
fn source_mode(source: &Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(source)
        .map(|m| m.permissions().mode() & 0o7777)
        .unwrap_or(0o600)
}

/// Create the backup file, refusing to touch an existing one, with the
/// source's permission bits applied by `open(2)` itself so the file is never
/// momentarily wider than its source.
#[cfg(unix)]
fn create_backup_file(candidate: &Path, source: &Path) -> io::Result<fs::File> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let mode = source_mode(source);
    let file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .open(candidate)?;
    // `open(2)` masks the requested mode with the process umask, so a strict
    // umask would silently drop bits the source really has. Restore them now
    // that the file exists — this only ever *re*-widens toward the source,
    // never past it.
    fs::set_permissions(candidate, fs::Permissions::from_mode(mode))?;
    Ok(file)
}

#[cfg(not(unix))]
fn create_backup_file(candidate: &Path, _source: &Path) -> io::Result<fs::File> {
    // Windows has no mode bits to carry; the backup inherits the directory's
    // ACL exactly as the config it sits beside does.
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(candidate)
}

/// Best-effort durability for a newly created file's *name*.
///
/// `sync_all` on the file makes its bytes durable; only an fsync of the
/// containing directory makes the new directory entry durable. That call
/// legitimately fails on some filesystems (and cannot be made at all on
/// Windows), so a failure is logged rather than aborting an install whose
/// data is already on disk.
///
/// Shared with `create_io.rs`, which links a fresh config into place and owes
/// its directory entry the same guarantee.
pub(crate) fn sync_parent_dir(path: &Path) {
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        match fs::File::open(parent) {
            Ok(dir) => {
                if let Err(e) = dir.sync_all() {
                    log::warn!("Could not fsync backup directory {:?}: {}", parent, e);
                }
            }
            Err(e) => log::warn!(
                "Could not open backup directory {:?} to fsync: {}",
                parent,
                e
            ),
        }
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// Write `contents` to the first free variant of `base`, never overwriting.
///
/// `base` is injected rather than derived from the clock so the collision
/// behaviour is testable without hoping five calls land in the same second.
/// `source` supplies the permission bits only; its contents are not read —
/// the caller passes the exact snapshot it validated, so the backup can never
/// disagree with the bytes the caller is about to replace.
fn write_backup(source: &Path, base: &Path, contents: &[u8]) -> Result<PathBuf, String> {
    for attempt in 0..MAX_BACKUP_ATTEMPTS {
        let candidate = if attempt == 0 {
            base.to_path_buf()
        } else {
            with_suffix(base, attempt)
        };
        match create_backup_file(&candidate, source) {
            Ok(mut file) => {
                // One key per stage rather than one key with the stage
                // interpolated: an English "write"/"flush"/"sync" dropped into
                // the middle of a translated sentence is not a translation.
                file.write_all(contents).map_err(|e| {
                    rust_i18n::t!(
                        "errors.mcp.backupWriteFailed",
                        path = candidate.display(),
                        detail = e.to_string()
                    )
                    .to_string()
                })?;
                file.flush().map_err(|e| {
                    rust_i18n::t!(
                        "errors.mcp.backupFlushFailed",
                        path = candidate.display(),
                        detail = e.to_string()
                    )
                    .to_string()
                })?;
                // Durable BEFORE the caller replaces the original: a crash
                // between the two must not leave the new config on disk with
                // its purported backup missing or truncated.
                file.sync_all().map_err(|e| {
                    rust_i18n::t!(
                        "errors.mcp.backupSyncFailed",
                        path = candidate.display(),
                        detail = e.to_string()
                    )
                    .to_string()
                })?;
                drop(file);
                sync_parent_dir(&candidate);
                return Ok(candidate);
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => {
                return Err(rust_i18n::t!(
                    "errors.mcp.backupCreateFailed",
                    path = candidate.display(),
                    detail = e.to_string()
                )
                .to_string())
            }
        }
    }
    Err(rust_i18n::t!(
        "errors.mcp.backupVariantsExhausted",
        count = MAX_BACKUP_ATTEMPTS,
        path = base.display()
    )
    .to_string())
}

/// `write_backup` with the timestamped base name the app actually uses.
pub(crate) fn backup_config_file(source: &Path, contents: &[u8]) -> Result<PathBuf, String> {
    write_backup(source, &generate_backup_path(source), contents)
}

#[cfg(test)]
#[path = "backup_io.test.rs"]
mod tests;
