//! Genie directory scanning.
//!
//! Recursively scans directories for `.md` (markdown one-shot) and
//! `.yml`/`.yaml` (workflow) genie files, extracting names from filenames
//! and categories from subdirectory structure (WI-7.1).

use super::types::{GenieEntry, GenieKind, GenieMenuEntry};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

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

/// Recursively scan a directory for `.md` files. Subdirectory names become categories.
pub(crate) fn scan_genies_dir(
    dir: &Path,
    base: &Path,
    source: &str,
    entries: &mut HashMap<String, GenieEntry>,
) {
    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        // Skip symlinks for safety
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }

        let path = entry.path();
        if ft.is_dir() {
            scan_genies_dir(&path, base, source, entries);
        } else if let Some(kind) = classify(path.extension()) {
            let name: String = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .chars()
                .filter(|c| !c.is_control())
                .collect();

            // Category from subdirectory relative to base.
            // Normalize backslashes to forward slashes so Windows paths
            // produce the same category/key strings as POSIX.
            let category = path
                .parent()
                .and_then(|p| p.strip_prefix(base).ok())
                .filter(|rel| !rel.as_os_str().is_empty())
                .map(|rel| rel.to_string_lossy().replace('\\', "/"));

            // Key by relative path including extension to avoid collisions
            // between markdown and yaml genies that share a stem.
            let rel_key = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");

            entries.insert(
                rel_key,
                GenieEntry {
                    name,
                    path: path.to_string_lossy().to_string(),
                    source: source.to_string(),
                    category,
                    kind,
                },
            );
        }
    }
}

/// Scan a directory for `.md` genie files and return menu entries sorted by title.
pub fn scan_genies_with_titles(dir: &Path) -> Vec<GenieMenuEntry> {
    let mut entries = Vec::new();
    scan_genies_recursive(dir, dir, &mut entries);
    entries.sort_by(|a, b| a.title.cmp(&b.title));
    entries
}

fn scan_genies_recursive(dir: &Path, base: &Path, entries: &mut Vec<GenieMenuEntry>) {
    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }

        let path = entry.path();
        if ft.is_dir() {
            scan_genies_recursive(&path, base, entries);
        } else if classify(path.extension()).is_some() {
            let filename_stem = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            // Always use filename as menu title — renaming the file changes the display.
            // Strip control characters to prevent misleading UI labels.
            let title: String = filename_stem.chars().filter(|c| !c.is_control()).collect();

            let category = path
                .parent()
                .and_then(|p| p.strip_prefix(base).ok())
                .filter(|rel| !rel.as_os_str().is_empty())
                .map(|rel| rel.to_string_lossy().replace('\\', "/"));

            entries.push(GenieMenuEntry {
                title,
                path: path.to_string_lossy().to_string(),
                category,
            });
        }
    }
}

