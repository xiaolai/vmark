//! The scan's filesystem walk (split from `scan.rs` for the file-size
//! gate): ignored dirs, symlink refusal, DoS caps, and the
//! completeness-tracking that gates deletion reconciliation.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::scan::{ScanReport, IGNORED_DIRS, MAX_SCAN_FILES, MAX_SCAN_FILE_BYTES};
use super::state::WorkspaceKernel;

/// Recursive markdown walk: skip ignored dirs, never follow symlinks
/// (diagnostic), surface unreadable dirs/files (diagnostic + incomplete
/// flag), and enforce the DoS caps.
pub(super) fn walk_markdown(
    root: &Path,
    report: &mut ScanReport,
    kernel: &mut WorkspaceKernel,
    existing: &mut HashSet<(String, String)>,
    skipped_md: &mut Vec<String>,
) -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let rel_dir = to_workspace_rel(dir.strip_prefix(root).unwrap_or(&dir));
        // F2 (dogfood session 2): a directory carrying the standard
        // CACHEDIR.TAG (cargo `target/`, other build caches) is a
        // self-declared cache — never content. Walking one dominated M5
        // on a real repo. Tag presence is exact; no name-based guessing.
        if dir != root && dir.join("CACHEDIR.TAG").is_file() {
            continue;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(e) => {
                // An unreadable directory means the walk is INCOMPLETE —
                // deletion reconciliation must not run (audit R9).
                report.complete = false;
                super::scan::emit_diagnostic(
                    kernel,
                    existing,
                    report,
                    "unreadable-dir",
                    &format!("directory listing failed: {e}"),
                    &rel_dir,
                )?;
                continue;
            }
        };
        for entry in entries {
            // Entry errors surface and mark the walk incomplete (audit
            // A14) — a skipped entry must never become a deletion.
            let Ok(entry) = entry else {
                report.complete = false;
                continue;
            };
            if out.len() >= MAX_SCAN_FILES {
                report.complete = false;
                super::scan::emit_diagnostic(
                    kernel,
                    existing,
                    report,
                    "scan-truncated",
                    &format!("workspace exceeds the {MAX_SCAN_FILES}-file scan cap"),
                    "",
                )?;
                return finish(out);
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let rel = to_workspace_rel(path.strip_prefix(root).unwrap_or(&path));
            let Ok(meta) = std::fs::symlink_metadata(&path) else {
                report.complete = false;
                continue;
            };
            if meta.file_type().is_symlink() {
                super::scan::emit_diagnostic(
                    kernel,
                    existing,
                    report,
                    "symlink-skipped",
                    "symlinks are never followed",
                    &rel,
                )?;
                continue;
            }
            if meta.is_dir() {
                // Two independent skips: a bare ignored NAME at any depth, and
                // an anchored workspace-relative PATH prefix (nested git
                // worktrees — see IGNORED_REL_PREFIXES).
                if !IGNORED_DIRS.contains(&name.as_str())
                    && !super::scan::path_at_or_under_ignored_prefix(&rel)
                {
                    stack.push(path);
                }
                continue;
            }
            if path.extension().is_none_or(|e| e != "md") {
                continue;
            }
            if meta.len() > MAX_SCAN_FILE_BYTES {
                skipped_md.push(rel.clone());
                super::scan::emit_diagnostic(
                    kernel,
                    existing,
                    report,
                    "file-too-large",
                    &format!("exceeds the {MAX_SCAN_FILE_BYTES}-byte scan cap"),
                    &rel,
                )?;
                continue;
            }
            match std::fs::read(&path) {
                Ok(bytes) => match String::from_utf8(bytes) {
                    Ok(text) => out.push((rel, text)),
                    Err(_) => {
                        skipped_md.push(rel.clone());
                        super::scan::emit_diagnostic(
                            kernel,
                            existing,
                            report,
                            "invalid-utf8",
                            "expected UTF-8 text",
                            &rel,
                        )?;
                    }
                },
                Err(e) => {
                    report.complete = false;
                    skipped_md.push(rel.clone());
                    super::scan::emit_diagnostic(
                        kernel,
                        existing,
                        report,
                        "unreadable",
                        &format!("read failed: {e}"),
                        &rel,
                    )?;
                }
            }
        }
    }
    finish(out)
}

/// Canonicalize a stripped relative path to the workspace's forward-slash
/// convention. Workspace-relative paths are `/`-separated everywhere: the IPC
/// path guard (`paths.rs`) rejects backslashes, and registry keys built from
/// frontmatter/IPC use `/`. `to_string_lossy()` yields the OS separator, so on
/// Windows the walked path must be rewritten to match — otherwise the guard
/// rejects it (`path contains backslash`) and no walked file ever reconciles.
/// On Unix `MAIN_SEPARATOR` is already `/`, so this is a no-op and a literal
/// `\` inside a filename is left untouched.
fn to_workspace_rel(rel: &Path) -> String {
    rel.to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/")
}

fn finish(mut out: Vec<(String, String)>) -> Result<Vec<(String, String)>, String> {
    out.sort();
    Ok(out)
}
