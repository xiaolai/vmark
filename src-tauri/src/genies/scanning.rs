//! Genie directory scanning.
//!
//! Recursively scans directories for `.md` genie files, extracting names
//! and categories from subdirectory structure and frontmatter.

use super::types::{GenieEntry, GenieMenuEntry};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

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
        } else if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("md")) {
            let name = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            // Category from subdirectory relative to base
            let category = path
                .parent()
                .and_then(|p| p.strip_prefix(base).ok())
                .filter(|rel| !rel.as_os_str().is_empty())
                .map(|rel| rel.to_string_lossy().to_string());

            // Key by relative path (e.g. "writing/improve") to avoid collisions
            // between files with the same stem in different categories.
            let rel_key = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .with_extension("")
                .to_string_lossy()
                .to_string();

            entries.insert(
                rel_key,
                GenieEntry {
                    name,
                    path: path.to_string_lossy().to_string(),
                    source: source.to_string(),
                    category,
                },
            );
        }
    }
}

/// Scan a directory and return genie entries with titles resolved from frontmatter.
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
        } else if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("md")) {
            let filename_stem = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            let title = match fs::read_to_string(&path) {
                Ok(content) => extract_frontmatter_name(&content).unwrap_or(filename_stem),
                Err(_) => filename_stem,
            };

            let category = path
                .parent()
                .and_then(|p| p.strip_prefix(base).ok())
                .filter(|rel| !rel.as_os_str().is_empty())
                .map(|rel| rel.to_string_lossy().to_string());

            entries.push(GenieMenuEntry {
                title,
                path: path.to_string_lossy().to_string(),
                category,
            });
        }
    }
}

/// Extract the `name:` value from YAML frontmatter without a full parse.
pub(crate) fn extract_frontmatter_name(content: &str) -> Option<String> {
    let content = content.trim_start_matches('\u{FEFF}');
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return None;
    }
    let after_first = &trimmed[3..];
    let closing = after_first.find("\n---")?;
    let frontmatter = &after_first[..closing];

    for line in frontmatter.lines() {
        let line = line.trim();
        if let Some((key, value)) = line.split_once(':') {
            if key.trim().eq_ignore_ascii_case("name") {
                let name = value.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
                if !name.is_empty() {
                    return Some(name);
                }
            }
        }
    }
    None
}
