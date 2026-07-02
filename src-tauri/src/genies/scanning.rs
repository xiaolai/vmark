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

#[cfg(test)]
mod tests {
    // WI-5.4 — genie directory scanning (TQ5 coverage gap).
    use super::*;
    use std::collections::HashMap;
    use std::ffi::OsStr;
    use tempfile::tempdir;

    #[test]
    fn classify_recognizes_md_and_yaml_case_insensitively() {
        assert_eq!(classify(Some(OsStr::new("md"))), Some(GenieKind::Markdown));
        assert_eq!(classify(Some(OsStr::new("MD"))), Some(GenieKind::Markdown));
        assert_eq!(classify(Some(OsStr::new("yml"))), Some(GenieKind::Workflow));
        assert_eq!(
            classify(Some(OsStr::new("YAML"))),
            Some(GenieKind::Workflow)
        );
        assert_eq!(classify(Some(OsStr::new("txt"))), None);
        assert_eq!(classify(None), None);
    }

    #[test]
    fn scan_derives_categories_from_subdirs_and_skips_non_genies() {
        let dir = tempdir().unwrap();
        let base = dir.path();
        std::fs::write(base.join("top.md"), "x").unwrap();
        let sub = base.join("writing");
        std::fs::create_dir(&sub).unwrap();
        std::fs::write(sub.join("clarity.md"), "x").unwrap();
        std::fs::write(sub.join("flow.yml"), "x").unwrap();
        std::fs::write(base.join("notgenie.txt"), "x").unwrap();

        let mut entries = HashMap::new();
        scan_genies_dir(base, base, "global", &mut entries);

        // top.md + writing/clarity.md + writing/flow.yml; .txt skipped.
        assert_eq!(entries.len(), 3);
        assert_eq!(entries.get("top.md").unwrap().category, None);
        assert_eq!(entries.get("top.md").unwrap().kind, GenieKind::Markdown);
        let clarity = entries.get("writing/clarity.md").unwrap();
        assert_eq!(clarity.category.as_deref(), Some("writing"));
        assert_eq!(
            entries.get("writing/flow.yml").unwrap().kind,
            GenieKind::Workflow
        );
    }

    #[test]
    #[cfg(unix)]
    fn scan_skips_symlinks() {
        let dir = tempdir().unwrap();
        let base = dir.path();
        let real = base.join("real.md");
        std::fs::write(&real, "x").unwrap();
        std::os::unix::fs::symlink(&real, base.join("link.md")).unwrap();

        let mut entries = HashMap::new();
        scan_genies_dir(base, base, "global", &mut entries);
        assert!(entries.contains_key("real.md"));
        assert!(!entries.contains_key("link.md"));
    }

    #[test]
    fn scan_menu_titles_are_sorted() {
        let dir = tempdir().unwrap();
        let base = dir.path();
        std::fs::write(base.join("zebra.md"), "x").unwrap();
        std::fs::write(base.join("alpha.md"), "x").unwrap();
        let menu = scan_genies_with_titles(base);
        let titles: Vec<&str> = menu.iter().map(|m| m.title.as_str()).collect();
        assert_eq!(titles, vec!["alpha", "zebra"]);
    }
}
