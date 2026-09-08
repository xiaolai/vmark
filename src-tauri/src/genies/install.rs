//! Default genies installer.
//!
//! Bundles default genie templates (via `include_str!`) and installs
//! them into the app data directory on first run.
//!
//! A genie is PUBLISHED, never written in place (#153): the bytes go to a
//! sibling temp file, and the final name is claimed with an atomic
//! no-clobber rename (`NamedTempFile::persist_noclobber`), which refuses an
//! existing target. `create_new` + `write_all` used to reserve the final name
//! before the content was complete, so a full disk or a crash mid-write left
//! a truncated genie that every later launch treated as installed. The first
//! rewrite fell back, where `hard_link` was unavailable, to a check followed
//! by an overwrite-capable rename — and a genie created between the check and
//! the rename was lost to the bundle. There is no such fallback now: a
//! filesystem with no no-clobber primitive reports an error rather than
//! renaming over whatever is there.
//!
//! What counts as "already installed" is what the picker can list (#154):
//! `scanning.rs` never follows symlinks, so a link squatting on a genie's
//! name — like a directory or a socket — is reported, not counted. One
//! squatter does not stop the rest of the bundle from landing.

use super::commands::global_genies_dir;
use std::fs;
use std::io::Write as IoWrite;
use std::path::Path;
use tauri::AppHandle;
use tempfile::NamedTempFile;

struct DefaultGenie {
    path: &'static str,
    content: &'static str,
}

const DEFAULT_GENIES: &[DefaultGenie] = &[
    // Editing
    DefaultGenie {
        path: "editing/polish.md",
        content: include_str!("../../resources/genies/editing/polish.md"),
    },
    DefaultGenie {
        path: "editing/condense.md",
        content: include_str!("../../resources/genies/editing/condense.md"),
    },
    DefaultGenie {
        path: "editing/fix-grammar.md",
        content: include_str!("../../resources/genies/editing/fix-grammar.md"),
    },
    DefaultGenie {
        path: "editing/simplify.md",
        content: include_str!("../../resources/genies/editing/simplify.md"),
    },
    // Creative
    DefaultGenie {
        path: "creative/expand.md",
        content: include_str!("../../resources/genies/creative/expand.md"),
    },
    DefaultGenie {
        path: "creative/rephrase.md",
        content: include_str!("../../resources/genies/creative/rephrase.md"),
    },
    DefaultGenie {
        path: "creative/vivid.md",
        content: include_str!("../../resources/genies/creative/vivid.md"),
    },
    DefaultGenie {
        path: "creative/continue.md",
        content: include_str!("../../resources/genies/creative/continue.md"),
    },
    // Structure
    DefaultGenie {
        path: "structure/summarize.md",
        content: include_str!("../../resources/genies/structure/summarize.md"),
    },
    DefaultGenie {
        path: "structure/outline.md",
        content: include_str!("../../resources/genies/structure/outline.md"),
    },
    DefaultGenie {
        path: "structure/headline.md",
        content: include_str!("../../resources/genies/structure/headline.md"),
    },
    // Tools
    DefaultGenie {
        path: "tools/translate.md",
        content: include_str!("../../resources/genies/tools/translate.md"),
    },
    DefaultGenie {
        path: "tools/rewrite-in-english.md",
        content: include_str!("../../resources/genies/tools/rewrite-in-english.md"),
    },
];

/// Genie names (file stems) for every bundled default genie.
///
/// The name is the file stem of each `DEFAULT_GENIES` path — i.e. the token a
/// `uses: genie/<name>` workflow step references. This is the single source of
/// truth for "which genies ship with the app", used to validate that bundled
/// sample workflows only reference genies that actually exist.
#[cfg(test)]
pub fn default_genie_names() -> Vec<&'static str> {
    DEFAULT_GENIES
        .iter()
        .filter_map(|g| {
            std::path::Path::new(g.path)
                .file_stem()
                .and_then(|s| s.to_str())
        })
        .collect()
}

/// Install default genies into `<appDataDir>/genies/` if they don't already exist.
pub fn install_default_genies(app: &AppHandle) -> Result<(), String> {
    install_default_genies_into(&global_genies_dir(app)?)
}

/// Install every bundled genie under `base`, creating only the files that do
/// not exist yet. Split from the `AppHandle` resolution so the no-overwrite
/// contract can be exercised on a temp directory.
fn install_default_genies_into(base: &Path) -> Result<(), String> {
    fs::create_dir_all(base).map_err(|e| format!("Failed to create dir {:?}: {}", base, e))?;
    let canonical_base =
        fs::canonicalize(base).map_err(|e| format!("Failed to resolve {:?}: {}", base, e))?;
    // One genie's problem is reported, and the next genie is still
    // installed: the loop used to stop at the first `?`, so a single
    // squatter left every genie after it out of the picker as well.
    let mut problems = Vec::new();
    for genie in DEFAULT_GENIES {
        if let Err(e) = install_one(base, &canonical_base, genie) {
            problems.push(e);
        }
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems.join("; "))
    }
}

/// Install one bundled genie under `base`, or explain why it could not be.
fn install_one(base: &Path, canonical_base: &Path, genie: &DefaultGenie) -> Result<(), String> {
    let target = base.join(genie.path);

    // Create parent directories — and refuse one that resolves outside
    // the genies directory (#152): a category directory replaced by a
    // symlink would otherwise have the bundled files written wherever it
    // points.
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create dir {:?}: {}", parent, e))?;
        ensure_inside(parent, canonical_base)?;
    }

    // Already installed — the common case on every launch after the
    // first. Only a regular file counts (#154): a directory, a socket, a
    // link squatting on the name is an error, not a genie. The publish
    // below re-checks atomically, so this is only a shortcut around writing
    // thirteen temp files per launch.
    //
    // ONE stat, and only `NotFound` reaches the publish (#348). `is_ok()`
    // followed by a second `symlink_metadata` inside `already_installed` read
    // the name twice: a file deleted between the two reported "exists but is
    // not a readable file: No such file or directory" and left the genie
    // uninstalled, and every failure that was not absence — an unreadable
    // parent, a stalled mount — fell through to a publish that could only
    // fail again with the same error, one layer further from its cause.
    match fs::symlink_metadata(&target) {
        Ok(meta) => already_installed(&target, &meta),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            publish_no_clobber(&target, genie.content.as_bytes())
        }
        Err(e) => Err(format!("{target:?} could not be examined: {e}")),
    }
}

/// `parent` must lie under `canonical_base` once symlinks are resolved.
fn ensure_inside(parent: &Path, canonical_base: &Path) -> Result<(), String> {
    let resolved =
        fs::canonicalize(parent).map_err(|e| format!("Failed to resolve {:?}: {}", parent, e))?;
    if resolved.starts_with(canonical_base) {
        Ok(())
    } else {
        Err(format!(
            "{:?} resolves to {:?}, outside the genies directory; refusing to install there",
            parent, resolved
        ))
    }
}

/// What may sit at a genie's final name and count as installed: a regular
/// file, and nothing else (#154). The scanner never follows links, so a
/// symlink at the name — even one that resolves to a regular file — is a
/// genie the picker will not list; counting it as installed would leave that
/// genie missing on every launch, silently. A directory, a socket or a
/// dangling link is reported for the same reason.
fn already_installed(target: &Path, meta: &fs::Metadata) -> Result<(), String> {
    if meta.is_file() {
        return Ok(());
    }
    if meta.is_symlink() {
        return Err(format!(
            "{:?} is a symbolic link, not an installed genie: the genie scanner never follows \
             links, so the picker would not list it",
            target
        ));
    }
    Err(format!("{:?} exists but is not a regular file", target))
}

/// Write `content` to `target` unless something is there already, without a
/// moment at which the final name holds partial content.
///
/// The claim is `persist_noclobber`: `renameat2(RENAME_NOREPLACE)` on Linux,
/// `renameatx_np(RENAME_EXCL)` on macOS, `MoveFileExW` WITHOUT
/// `MOVEFILE_REPLACE_EXISTING` on Windows — and, inside tempfile, where the
/// filesystem has no such rename, `link` + `unlink`, which refuses an existing
/// target just the same. Neither tier can overwrite, so nothing that lands on
/// the name after the installer's check can be lost to the bundle. What the
/// claim refused to clobber must be a regular file (#154), or the refusal is
/// reported rather than counted as installed.
fn publish_no_clobber(target: &Path, content: &[u8]) -> Result<(), String> {
    publish_with(target, content, claim_no_clobber)
}

/// The claim itself, named so `install.test.rs` can plant a file in the window
/// after the check and then run THIS function — the one production uses —
/// rather than a no-clobber claim the test supplied to itself.
fn claim_no_clobber(temp: NamedTempFile, to: &Path) -> Result<(), tempfile::PersistError> {
    temp.persist_noclobber(to).map(|_| ())
}

/// [`publish_no_clobber`] with the claim injected, so the window after every
/// check — something appearing at the name just before the publish — can be
/// exercised deterministically (`install.test.rs`).
///
/// The temp file lives in the target's directory (same filesystem, so a
/// rename or a link is possible). On any refusal the temp file comes back
/// inside the `PersistError` and is removed when it drops; on success the
/// temp name no longer exists. A claim refused because SOMETHING holds the
/// name is judged by what that something is; any other refusal is reported.
fn publish_with(
    target: &Path,
    content: &[u8],
    claim: impl FnOnce(NamedTempFile, &Path) -> Result<(), tempfile::PersistError>,
) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("{:?} has no parent directory", target))?;
    let mut temp = NamedTempFile::new_in(parent)
        .map_err(|e| format!("Failed to create temp file in {:?}: {}", parent, e))?;
    temp.write_all(content)
        .and_then(|()| temp.as_file().sync_all())
        .map_err(|e| format!("Failed to write {:?}: {}", target, e))?;
    match claim(temp, target) {
        Ok(()) => Ok(()),
        Err(refusal) => {
            // Removes the temp file, whatever the reason.
            drop(refusal.file);
            // `EEXIST` on Unix, `ERROR_ALREADY_EXISTS` on Windows — and, for a
            // directory at the name, some kernels say `EISDIR` instead. What
            // decides is whether something holds the name, not which errno.
            // One stat, and only a `NotFound` is "nothing is there" (#348).
            match fs::symlink_metadata(target) {
                Ok(meta) => already_installed(target, &meta),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    Err(format!("Failed to publish {:?}: {}", target, refusal.error))
                }
                Err(e) => Err(format!(
                    "Failed to publish {:?}: {} (and {:?} could not be examined: {})",
                    target, refusal.error, target, e
                )),
            }
        }
    }
}

#[cfg(test)]
#[path = "install.test.rs"]
mod tests;
