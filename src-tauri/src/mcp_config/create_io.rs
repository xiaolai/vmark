//! Creating a config that does not exist yet: failure-atomic AND no-clobber.
//!
//! Both properties, or the file is not safe to create — and the two obvious
//! implementations each buy one by selling the other, which is how each has
//! been lost in turn:
//!
//! - **temp + `rename`** (`app_paths::atomic_write_file`) is failure-atomic,
//!   but rename REPLACES. A config another client created in the window
//!   between our snapshot and our write was silently discarded.
//! - **`create_new` onto the destination** never clobbers, but it writes in
//!   place: an ENOSPC, EIO or crash part way through strands a truncated
//!   `~/.claude.json` where there had been no file at all — unparseable for
//!   Claude Code, and unparseable for our own next install, which is an
//!   error by design.
//!
//! Staging beside the destination and hard-linking the staged file into place
//! gets both. The bytes are complete and fsynced before the destination
//! exists at all, and `link(2)` / `CreateHardLinkW` refuses an existing
//! destination rather than replacing it.
//!
//! ## When hard links are not available
//!
//! Every mainstream home-directory filesystem — APFS, HFS+, ext4, btrfs, xfs,
//! zfs, NTFS — supports them. A network or FUSE-mounted home may not: SMB with
//! links disabled server-side, or an sshfs / cloud-sync layer that withholds
//! them. (Not exFAT, despite the obvious guess — it has no POSIX permissions,
//! so such a home fails earlier, at the `set_permissions` in `stage_config`.)
//!
//! Refusing outright there would make the install impossible on those systems
//! for a property that is *desirable* rather than load-bearing: this path only
//! ever creates a file that did not exist, so losing atomicity risks a
//! truncated **new** config, not the destruction of an existing one. So the
//! link failure falls through to `create_in_place`, which keeps the mandatory
//! property (no-clobber, via `create_new`) and gives up the desirable one,
//! recording that in the log.
//!
//! The ordering is deliberate: **no-clobber is never traded, atomicity is
//! traded only when the filesystem leaves no alternative.** The degraded path
//! still removes a partial file on any error it observes; only a hard crash
//! mid-write can strand one, and only on a filesystem that already refused us
//! the better option.
//!
//! Only this path carries the hard-link dependency. Updating a config that
//! already exists goes through `atomic_write_file` and needs nothing but
//! rename.

use std::fs;
use std::io::{self, Write};
use std::path::Path;

use tempfile::NamedTempFile;

use super::backup_io::sync_parent_dir;

/// Mode for a config VMark creates from nothing.
///
/// `~/.claude.json` and `~/.codex/config.toml` carry paths, env values and
/// tokens, so a fresh one is owner-only rather than whatever the umask
/// happens to allow. Both creation paths set it at creation time — the staged
/// file carries its inode (and therefore its mode) to the destination through
/// the hard link; the in-place fallback passes it to `open(2)` — so neither
/// leaves a window where the file exists at a wider mode.
#[cfg(unix)]
const FRESH_CONFIG_MODE: u32 = 0o600;

/// How bytes reach a freshly created file.
///
/// A parameter purely so a test can fail *after* some bytes have landed. The
/// guarantee that matters — destination absent, never partial — is only
/// interesting once the write got part way, and no portable filesystem hands
/// out an ENOSPC on demand. Typed over `File` rather than `NamedTempFile` so
/// the staged and in-place paths share one seam and one implementation.
type WriteFn = fn(&mut fs::File, &[u8]) -> io::Result<()>;

/// How the staged file reaches its destination.
///
/// A parameter for the same reason: no portable filesystem refuses
/// `hard_link` on demand, and the fallback below is the half of this module
/// that only runs on filesystems we cannot create in a test.
type LinkFn = fn(&Path, &Path) -> io::Result<()>;

fn write_and_sync(file: &mut fs::File, contents: &[u8]) -> io::Result<()> {
    file.write_all(contents)?;
    file.flush()?;
    file.sync_all()
}

/// `fs::hard_link` is generic over `AsRef<Path>`, so it cannot coerce to a
/// `LinkFn` pointer directly.
fn link_into_place(from: &Path, to: &Path) -> io::Result<()> {
    fs::hard_link(from, to)
}

/// Where to stage: the destination's own directory, so the hard link that
/// follows stays inside one filesystem.
fn staging_dir(path: &Path) -> &Path {
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    }
}

/// Write `contents` into a durable, owner-only temp file beside `path`.
///
/// Any failure — including one part way through the write — drops the
/// `NamedTempFile`, which unlinks the partial file. The destination has still
/// never been touched when the error surfaces.
fn stage_config(path: &Path, contents: &[u8], write: WriteFn) -> Result<NamedTempFile, String> {
    let dir = staging_dir(path);
    let mut staged = tempfile::Builder::new()
        .prefix(".vmark-config-")
        .tempfile_in(dir)
        .map_err(|e| {
            rust_i18n::t!(
                "errors.mcp.stageConfigFailed",
                dir = dir.display(),
                detail = e.to_string()
            )
            .to_string()
        })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // `tempfile` already creates 0600, but the destination inherits this
        // file's bits, so the guarantee is stated here rather than borrowed
        // from a dependency's default.
        fs::set_permissions(staged.path(), fs::Permissions::from_mode(FRESH_CONFIG_MODE)).map_err(
            |e| {
                rust_i18n::t!(
                    "errors.mcp.restrictStagedConfigFailed",
                    path = staged.path().display(),
                    detail = e.to_string()
                )
                .to_string()
            },
        )?;
    }

    write(staged.as_file_mut(), contents).map_err(|e| {
        rust_i18n::t!(
            "errors.mcp.writeStagedConfigFailed",
            path = path.display(),
            detail = e.to_string()
        )
        .to_string()
    })?;
    Ok(staged)
}

/// Create `path` holding `contents`, refusing to overwrite a file that
/// appeared meanwhile.
///
/// `Ok(false)` means "it appeared — retry the whole merge against it".
pub(crate) fn create_new_config(path: &Path, contents: &[u8]) -> Result<bool, String> {
    create_new_config_via(path, contents, write_and_sync, link_into_place)
}

fn create_new_config_via(
    path: &Path,
    contents: &[u8],
    write: WriteFn,
    link: LinkFn,
) -> Result<bool, String> {
    let staged = stage_config(path, contents, write)?;

    match link(staged.path(), path) {
        Ok(()) => {
            // Unlink the staging name, leaving the destination as the sole
            // link to the inode; then make the new directory entry durable.
            drop(staged);
            sync_parent_dir(path);
            Ok(true)
        }
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Ok(false),
        Err(link_err) => {
            // Discard the staged bytes before trying again in place — leaving
            // it would strand a temp file next to the config on every attempt.
            drop(staged);
            create_in_place(path, contents, write, &link_err)
        }
    }
}

/// Fallback for a filesystem that will not hard-link: create the destination
/// exclusively and write into it.
///
/// Keeps no-clobber (`create_new` fails rather than replacing) and gives up
/// atomicity, which is why it is the fallback and not the default. A write
/// failure we can see is cleaned up; a hard crash cannot be.
fn create_in_place(
    path: &Path,
    contents: &[u8],
    write: WriteFn,
    link_err: &io::Error,
) -> Result<bool, String> {
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // Set at creation, so the file never exists at a wider mode.
        opts.mode(FRESH_CONFIG_MODE);
    }

    let mut file = match opts.open(path) {
        Ok(file) => file,
        // It appeared while we were failing to link it — same answer as the
        // link path: retry the merge against it.
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => return Ok(false),
        // Both routes failed. Report both: the link error names why we are
        // here, the open error names why the way out was closed too.
        Err(open_err) => {
            return Err(rust_i18n::t!(
                "errors.mcp.createConfigFailed",
                path = path.display(),
                link_detail = link_err,
                open_detail = open_err
            )
            .to_string());
        }
    };

    if let Err(write_err) = write(&mut file, contents) {
        drop(file);
        // The destination exists and is partial. Removing it restores
        // "absent, never partial" for every failure we can observe.
        let removed = fs::remove_file(path);
        return Err(match removed {
            Ok(()) => rust_i18n::t!(
                "errors.mcp.writeConfigPartialRemoved",
                path = path.display(),
                detail = write_err
            )
            .to_string(),
            Err(cleanup_err) => rust_i18n::t!(
                "errors.mcp.writeConfigPartialOrphaned",
                path = path.display(),
                detail = write_err,
                cleanup_detail = cleanup_err
            )
            .to_string(),
        });
    }
    drop(file);
    sync_parent_dir(path);

    log::warn!(
        "Created {} without the usual crash-safety: this filesystem refused to \
         hard-link a staged copy into place ({link_err}), most often a network \
         or FUSE-mounted home directory. The config is complete and fsynced, \
         and an existing file was never at risk, but a crash during a future \
         first-time write here could leave a partial file.",
        path.display()
    );
    Ok(true)
}

#[cfg(test)]
#[path = "create_io.test.rs"]
mod tests;
