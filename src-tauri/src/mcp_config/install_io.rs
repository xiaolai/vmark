//! The one snapshot → validate → back up → replace workflow, shared by
//! install and uninstall.
//!
//! `config_io.rs` stays pure: it parses and merges config *content*.
//! Everything here touches the disk, and both mutations go through
//! `mutate_config_at` — install and uninstall previously carried separate
//! copies of this sequence and had already drifted apart on validation
//! order, post-write checks and race handling. Preserving the old file is
//! `backup_io.rs`; creating one from nothing is `create_io.rs`.
//!
//! Ordering is the whole point:
//!
//! 1. Snapshot the file (absent is `None`; unreadable is an error, never a
//!    silent "fresh install").
//! 2. Run the caller's transform. A config we cannot parse aborts **here**,
//!    before any file — including the backup — exists.
//! 3. Back up the snapshot bytes already in hand, fsynced, so the copy is
//!    durable before step 5 replaces the original.
//! 4. Re-read and compare against the snapshot, as the LAST thing before the
//!    write. Claude Code rewrites `~/.claude.json` constantly; merging into
//!    content that has since moved would drop their update. Step 3 used to
//!    sit *between* this check and the replace, which is a window wide enough
//!    for a competing writer to land in; taking the backup from memory first
//!    closes that. A detected move discards the backup and retries the whole
//!    merge against the new content.
//! 5. Replace atomically — or, when the file was absent at snapshot time,
//!    hand off to `create_io`, whose no-clobber create IS the check.

use super::backup_io::backup_config_file;
use super::client_tokens::TokenPolicy;
use super::config_io::{
    client_token_in, config_format, generate_config_content, remove_vmark_from_config,
};
use super::create_io::create_new_config;
use std::fs;
use std::io;
use std::path::Path;

/// How many times a mutation re-merges before giving up on a config another
/// process keeps rewriting under it. Three covers an unlucky collision with
/// a single competing writer; a config in a rewrite loop is a real problem
/// the user needs told about, not one to spin on.
pub(crate) const MAX_MUTATION_ATTEMPTS: u32 = 3;

/// Turns the current config content (`None` when the file is absent) into
/// its replacement, or `Ok(None)` for "nothing to do".
///
/// Named so both mutations declare the same contract, and so the retry loop
/// has one thing to call.
pub(crate) type ConfigTransform<'a> = dyn Fn(Option<&str>) -> Result<Option<String>, String> + 'a;

/// What a config mutation actually did.
#[derive(Debug)]
pub(crate) struct ConfigMutation {
    /// Where the pre-change content was saved, or `None` when nothing was
    /// written or the config did not exist yet.
    pub backup_path: Option<String>,
    /// False when the transform declined, or produced content identical to
    /// what was already on disk.
    pub changed: bool,
}

impl ConfigMutation {
    /// Nothing was written, so there is nothing to restore from either.
    fn unchanged() -> Self {
        ConfigMutation {
            backup_path: None,
            changed: false,
        }
    }

    /// The file was replaced (or created, in which case there is no backup).
    fn written(backup_path: Option<String>) -> Self {
        ConfigMutation {
            backup_path,
            changed: true,
        }
    }
}

/// Read a config file for merging: absent is `None`, unreadable is an error.
///
/// `fs::read_to_string(..).ok()` collapsed "no file yet" and "I cannot read
/// your file" into the same `None`, and `None` means "generate a fresh
/// vmark-only config". Only `NotFound` may be silent.
pub(crate) fn read_config_for_merge(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(rust_i18n::t!(
            "errors.mcp.readFailed",
            path = path.display(),
            detail = e.to_string()
        )
        .to_string()),
    }
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| {
                rust_i18n::t!(
                    "errors.mcp.createDirFailed",
                    path = parent.display(),
                    detail = e.to_string()
                )
                .to_string()
            })?;
        }
    }
    Ok(())
}

/// The last-moment compare-and-swap: is the file still the one we merged from?
///
/// **This narrows the race window; it does not close it.** Nothing now stands
/// between this read and the `atomic_write_file` that follows — the backup
/// used to, and no longer does — but a competing writer landing in the gap
/// still wins the inode and loses its change. The bound is one
/// read-then-rename pair.
///
/// Closing it outright would need a lock the *other* writers honour, and
/// Claude Code, Codex CLI and Gemini CLI take none: POSIX advisory locks and
/// `LockFileEx` only exclude participants, so a lock only VMark respects
/// would exclude nobody. `MAX_MUTATION_ATTEMPTS` is the mitigation — a racer
/// detected here costs a retry, and a config being rewritten faster than that
/// is reported to the user rather than clobbered.
fn snapshot_still_current(path: &Path, snapshot: &Option<String>) -> Result<bool, String> {
    Ok(read_config_for_merge(path)? == *snapshot)
}

/// Drop a backup taken for an attempt that then lost the race, so retrying
/// does not litter the user's directory with copies of content VMark never
/// replaced. Best effort: leftover clutter is not a reason to fail an install
/// that is otherwise about to succeed.
fn discard_superseded_backup(backup: &Path) {
    if let Err(e) = fs::remove_file(backup) {
        log::warn!("Could not remove superseded backup {:?}: {}", backup, e);
    }
}

/// Confirm the bytes that reached disk are the ones we meant to write.
fn verify_written(path: &Path, expected: &str) -> Result<(), String> {
    if read_config_for_merge(path)?.as_deref() != Some(expected) {
        return Err(rust_i18n::t!("errors.mcp.configMismatch").to_string());
    }
    Ok(())
}

/// Snapshot → validate → back up → check → atomically replace.
///
/// `transform` receives the current content (`None` when the file is absent)
/// and returns the replacement, or `Ok(None)` for "nothing to do". It must be
/// pure with respect to the filesystem — it is called once per attempt.
pub(crate) fn mutate_config_at(
    path: &Path,
    transform: &ConfigTransform,
) -> Result<ConfigMutation, String> {
    for _ in 0..MAX_MUTATION_ATTEMPTS {
        let snapshot = read_config_for_merge(path)?;

        // Validate and merge first — no side effects on any failure here.
        let Some(new_content) = transform(snapshot.as_deref())? else {
            return Ok(ConfigMutation::unchanged());
        };
        if snapshot.as_deref() == Some(new_content.as_str()) {
            // Nothing to write: don't reformat, back up or touch mtime on a
            // config we are not actually changing.
            return Ok(ConfigMutation::unchanged());
        }

        ensure_parent_dir(path)?;

        let Some(existing) = snapshot.as_deref() else {
            // Absent at snapshot time. The create is itself the check — it
            // refuses a destination that appeared — so this path has no
            // separate comparison, and therefore no window between one and
            // the write.
            if !create_new_config(path, new_content.as_bytes())? {
                continue;
            }
            verify_written(path, &new_content)?;
            return Ok(ConfigMutation::written(None));
        };

        // From the validated snapshot rather than a fresh read: the backup
        // must hold exactly the content the check below certifies and the
        // write then replaces, and taking it from memory is what lets it
        // happen BEFORE the check instead of inside the race window.
        let backup = backup_config_file(path, existing.as_bytes())?;
        if !snapshot_still_current(path, &snapshot)? {
            discard_superseded_backup(&backup);
            continue;
        }

        crate::app_paths::atomic_write_file(path, new_content.as_bytes())?;
        verify_written(path, &new_content)?;
        return Ok(ConfigMutation::written(Some(
            backup.to_string_lossy().to_string(),
        )));
    }

    Err(rust_i18n::t!("errors.mcp.configChangedOnDisk", path = path.display()).to_string())
}

/// Install the vmark entry into the config at `path`.
///
/// Returns the backup path, or `None` for a fresh install or a no-op.
///
/// The per-client credential is decided **inside** the transform, from the
/// content that attempt validated: a competing writer that changes the config
/// between attempts may also have changed the token, and deciding outside the
/// loop would write a credential chosen against content that no longer exists.
/// `policy.fresh` is minted once by the caller so a retry does not burn a new
/// credential per attempt.
pub(crate) fn install_config_at(
    path: &Path,
    provider_id: &str,
    binary_path: &str,
    policy: &TokenPolicy,
) -> Result<Option<String>, String> {
    let mutation = mutate_config_at(path, &|current| {
        let token = policy.choose(client_token_in(provider_id, current)?);
        generate_config_content(provider_id, binary_path, &token, current).map(Some)
    })?;
    Ok(mutation.backup_path)
}

/// Remove the vmark entry from the config at `path`.
///
/// An absent config, a blank one, or one with no vmark entry are all
/// "nothing to remove" — not errors, and not a reason to rewrite the file.
pub(crate) fn uninstall_config_at(
    path: &Path,
    provider_id: &str,
) -> Result<ConfigMutation, String> {
    // Reject an unknown provider up front, so it cannot masquerade as a
    // successful no-op on an absent config.
    config_format(provider_id)?;

    mutate_config_at(path, &|current| match current {
        // `remove_vmark_from_config` already answers `Ok(None)` for "there was
        // no vmark entry", which is exactly the transform's "nothing to do".
        Some(c) if !c.trim().is_empty() => remove_vmark_from_config(provider_id, c),
        _ => Ok(None),
    })
}

#[cfg(test)]
#[path = "install_io.test.rs"]
mod tests;
