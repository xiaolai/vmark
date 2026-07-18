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
        let rel_dir = dir
            .strip_prefix(root)
            .unwrap_or(&dir)
            .to_string_lossy()
            .into_owned();
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
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .into_owned();
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
                if !IGNORED_DIRS.contains(&name.as_str()) {
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

fn finish(mut out: Vec<(String, String)>) -> Result<Vec<(String, String)>, String> {
    out.sort();
    Ok(out)
}
