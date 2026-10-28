//! Genie directory scanning.
//!
//! Scans directories for `.md` (markdown one-shot) and `.yml`/`.yaml`
//! (workflow) genie files, extracting names from filenames and categories
//! from subdirectory structure.
//!
//! Both scanners share ONE walk, and it is bounded: a worklist rather
//! than recursion, so a deep tree cannot grow the stack; a depth ceiling, so
//! a tree that is not a genie tree is not descended into; and an entry
//! ceiling, so a directory of a hundred thousand files does not hold the
//! command — and the picker — for as long as the disk takes. Symlinks are
//! never followed, which bounds nothing by itself: a real directory can be
//! as deep and as wide as its owner likes.

use super::types::{GenieEntry, GenieKind, GenieMenuEntry};
use crate::peer_text::is_bidi_formatting;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// How many directory levels below the scanned root a walk will enter. A
/// genie tree is `<category>/<name>.md` — two levels — so eight is generous;
/// anything deeper is not a genie tree, and the walk does not enter it.
pub(crate) const MAX_SCAN_DEPTH: usize = 8;

/// How many directory entries a walk will look at before it stops. A picker
/// listing ten thousand genies is not a use case; a tree that large stalls
/// the command and the menu alike.
pub(crate) const MAX_SCAN_ENTRIES: usize = 10_000;

/// Classify a file extension into a GenieKind, if any.
fn classify(ext: Option<&std::ffi::OsStr>) -> Option<GenieKind> {
    let ext = ext?.to_string_lossy();
    let lower = ext.to_ascii_lowercase();
    match lower.as_str() {
        "md" => Some(GenieKind::Markdown),
        "yml" | "yaml" => Some(GenieKind::Workflow),
        _ => None,
    }
}

/// Every genie file under `dir`, iteratively and bounded.
///
/// `visit` receives each genie file's path and kind, in the filesystem's
/// order — callers sort. Returns `true` when the listing is INCOMPLETE for any
/// reason — a depth or entry bound, a directory that could not be listed, an
/// entry the directory iterator could not hand over, an entry that could not
/// be typed, a path that is not UTF-8. Each reason is
/// logged where it happens, which is what a user's log needs; the flag is the
/// observation point `scanning.test.rs` asserts on.
fn walk_genie_files(dir: &Path, visit: impl FnMut(&Path, GenieKind)) -> bool {
    walk_bounded(dir, MAX_SCAN_DEPTH, MAX_SCAN_ENTRIES, visit)
}

/// The walk itself, with its bounds as parameters so they can be tested at
/// a size a test can build. `dir` is depth 0; a directory is entered only
/// while its depth stays within `max_depth`.
fn walk_bounded(
    dir: &Path,
    max_depth: usize,
    max_entries: usize,
    mut visit: impl FnMut(&Path, GenieKind),
) -> bool {
    let mut pending: Vec<(PathBuf, usize)> = vec![(dir.to_path_buf(), 0)];
    let mut seen = 0usize;
    let mut truncated = false;
    while let Some((current, depth)) = pending.pop() {
        let read_dir = match fs::read_dir(&current) {
            Ok(read_dir) => read_dir,
            Err(e) => {
                // Loud, not silent: an unreadable genies directory
                // produced an EMPTY picker that looked exactly like a user
                // who has no genies, with nothing anywhere saying why.
                log::warn!("[genies] cannot list {current:?}: {e}");
                truncated = true;
                continue;
            }
        };
        for entry in read_dir {
            // `flatten()` here dropped an `io::Error` the directory iterator
            // reported — the one silent discard the loud-error fix left behind, one
            // layer in: an entry the OS could not hand over vanished from the
            // listing with nothing logged and the listing still reported
            // COMPLETE. Same treatment as an entry that cannot be typed.
            let entry = match entry {
                Ok(entry) => entry,
                Err(e) => {
                    log::warn!("[genies] cannot read an entry of {current:?}: {e}");
                    truncated = true;
                    continue;
                }
            };
            seen += 1;
            if seen > max_entries {
                log::warn!(
                    "[genies] scan of {dir:?} stopped after {max_entries} entries; the rest is not listed"
                );
                return true;
            }
            // Never followed: a link out of the tree is not a genie, and a
            // link cycle would otherwise be a walk with no end.
            let ft = match entry.file_type() {
                Ok(ft) => ft,
                Err(e) => {
                    log::warn!("[genies] cannot type {:?}: {e}", entry.path());
                    truncated = true;
                    continue;
                }
            };
            if ft.is_symlink() {
                continue;
            }
            let path = entry.path();
            if ft.is_dir() {
                if depth + 1 > max_depth {
                    log::warn!(
                        "[genies] {path:?} is more than {max_depth} levels deep; not scanned"
                    );
                    truncated = true;
                    continue;
                }
                pending.push((path, depth + 1));
            } else if ft.is_file() {
                // `is_file()`, not "everything that is not a directory": a
                // FIFO, a socket or a device node named `x.md` used to be
                // listed as a genie. `bounded_read` refuses to open one, so
                // the picker offered a row that could only ever fail — and a
                // FIFO is exactly the shape whose open would block if the
                // reader ever stopped passing `O_NONBLOCK`.
                // A path that is not UTF-8 cannot round-trip: the
                // entry travels to the picker as a lossy `String`, and
                // `read_genie` then canonicalizes THAT and fails — while two
                // different names can flatten to the same key and evict each
                // other. Same rule as the FIFO above: never offer a row that
                // can only fail.
                if path.to_str().is_none() {
                    log::warn!("[genies] skipping {path:?}: the path is not UTF-8");
                    truncated = true;
                    continue;
                }
                if let Some(kind) = classify(path.extension()) {
                    visit(&path, kind);
                }
            }
        }
    }
    truncated
}

/// The category a genie file belongs to: its directory relative to `base`,
/// with `\` normalized to `/` so Windows paths produce the same category and
/// key strings as POSIX; `None` for a file directly under `base`.
fn category_of(path: &Path, base: &Path) -> Option<String> {
    path.parent()
        .and_then(|p| p.strip_prefix(base).ok())
        .filter(|rel| !rel.as_os_str().is_empty())
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
}

/// Whether `c` may appear in a label at all: not a control character, and
/// not one that reorders the text AROUND it rather than drawing anything.
/// `char::is_control` covers none of the bidi formatting characters (they are
/// `Cf`, not `Cc`), so a genie named `harmless\u{202E}gnp.exe.md` once rendered
/// a menu label reading `harmless.exe.png` — the Trojan-Source class, in a
/// list the user clicks to RUN something.
fn renders_honestly(c: char) -> bool {
    !c.is_control() && !is_bidi_formatting(c)
}

/// The display name for a genie file: its stem, minus every character that
/// could render a misleading label.
///
/// A stem made ENTIRELY of those characters sanitizes to nothing, and an empty
/// row in the picker names no file at all — so the whole file name stands in.
/// That always has something left: the walk only ever visits `.md`, `.yml` and
/// `.yaml` files, so the extension survives the filter.
fn display_name(path: &Path) -> String {
    let sanitized = |name: &std::ffi::OsStr| -> String {
        name.to_string_lossy()
            .chars()
            .filter(|c| renders_honestly(*c))
            .collect()
    };
    let stem = sanitized(path.file_stem().unwrap_or_default());
    if !stem.is_empty() {
        return stem;
    }
    sanitized(path.file_name().unwrap_or_default())
}

/// Scan `dir` for genie files. Subdirectory names (relative to `base`)
/// become categories.
pub(crate) fn scan_genies_dir(
    dir: &Path,
    base: &Path,
    source: &str,
    entries: &mut HashMap<String, GenieEntry>,
) {
    walk_genie_files(dir, |path, kind| {
        // Key by relative path including extension to avoid collisions
        // between markdown and yaml genies that share a stem.
        let rel_key = path
            .strip_prefix(base)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        entries.insert(
            rel_key,
            GenieEntry {
                name: display_name(path),
                path: path.to_string_lossy().to_string(),
                source: source.to_string(),
                category: category_of(path, base),
                kind,
            },
        );
    });
}

/// Scan a directory for genie files and return menu entries sorted by title.
/// The title is always the filename — renaming the file changes the display.
pub fn scan_genies_with_titles(dir: &Path) -> Vec<GenieMenuEntry> {
    let mut entries = Vec::new();
    walk_genie_files(dir, |path, _| {
        entries.push(GenieMenuEntry {
            title: display_name(path),
            path: path.to_string_lossy().to_string(),
            category: category_of(path, dir),
        });
    });
    // Path breaks a title tie: two genies in different categories share a
    // stem, and leaving those in filesystem order made the menu's order
    // differ between machines and between runs.
    entries.sort_by(|a, b| a.title.cmp(&b.title).then_with(|| a.path.cmp(&b.path)));
    entries
}

#[cfg(test)]
#[path = "scanning.test.rs"]
mod tests;
