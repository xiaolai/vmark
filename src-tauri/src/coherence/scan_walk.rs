//! The scan's filesystem walk (split from `scan.rs` for the file-size
//! gate): ignored dirs, symlink refusal, DoS caps, the completeness-tracking
//! that gates deletion reconciliation, and the scan cache — a file whose
//! metadata stamp is unchanged since a scan last read it is not read again
//! (see `scan_cache.rs`).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::canonical::{masked_text, MaskedText};
use super::frontmatter::read_identity;
use super::scan::{ScanReport, IGNORED_DIRS, MAX_SCAN_FILES, MAX_SCAN_FILE_BYTES};
use super::scan_cache::{FileFacts, FileStamp};
use super::state::WorkspaceKernel;
use super::types::ContentHash;

/// One markdown file the walk found.
pub(super) struct WalkedFile {
    /// Workspace-relative, `/`-separated.
    pub rel: String,
    /// The text, when the file was read this pass; `None` when its stamp
    /// matched the scan cache and `facts` came from there.
    pub text: Option<String>,
    pub facts: FileFacts,
}

/// A walked file's content, as far as reconciliation has needed it.
pub(super) enum FileContent {
    /// Only the hash is known (the scan cache supplied it).
    Hashed(ContentHash),
    /// Read and hashed this pass; the bytes are ready for a snapshot.
    Read(MaskedText),
}

impl FileContent {
    pub(super) fn hash(&self) -> &ContentHash {
        match self {
            FileContent::Hashed(hash) => hash,
            FileContent::Read(masked) => &masked.hash,
        }
    }

    /// The bytes to snapshot. A file known only by its cached hash is read
    /// now; `None` when it no longer reads as text or no longer has the hash
    /// reconciliation decided on — it changed after the walk, and the scan its
    /// change triggers will see it.
    pub(super) fn into_masked(self, root: &Path, rel: &str) -> Option<MaskedText> {
        match self {
            FileContent::Read(masked) => Some(masked),
            FileContent::Hashed(hash) => {
                let masked = masked_text(&read_text(root, rel)?);
                (masked.hash == hash).then_some(masked)
            }
        }
    }
}

/// A walked file's content: hashed from the text read this pass, the cached
/// hash, or — for a remembered file whose hash was never needed before — read
/// now. `None` when it can no longer be read as UTF-8 text.
pub(super) fn file_content(root: &Path, file: &WalkedFile) -> Option<FileContent> {
    if let Some(text) = &file.text {
        return Some(FileContent::Read(masked_text(text)));
    }
    if let Some(hash) = &file.facts.hash {
        return Some(FileContent::Hashed(hash.clone()));
    }
    Some(FileContent::Read(masked_text(&read_text(root, &file.rel)?)))
}

fn read_text(root: &Path, rel: &str) -> Option<String> {
    String::from_utf8(std::fs::read(root.join(rel)).ok()?).ok()
}

/// Recursive markdown walk: skip ignored dirs, never follow symlinks
/// (diagnostic), surface unreadable dirs/files (diagnostic + incomplete
/// flag), enforce the DoS caps, and reuse what the scan cache already knows.
pub(super) fn walk_markdown(
    root: &Path,
    report: &mut ScanReport,
    kernel: &mut WorkspaceKernel,
    existing: &mut HashSet<(String, String)>,
    skipped_md: &mut Vec<String>,
) -> Result<Vec<WalkedFile>, String> {
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
                // deletion reconciliation must not run.
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
            // Entry errors surface and mark the walk incomplete — a
            // skipped entry must never become a deletion.
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
                return finish(kernel, out);
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let rel = to_workspace_rel(path.strip_prefix(root).unwrap_or(&path));
            // Taken BEFORE the stat: a write after it moves the stamp.
            let stamped_at = kernel.scan_cache.now();
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
            let stamp = FileStamp::of(&meta);
            let cached = stamp
                .as_ref()
                .and_then(|stamp| kernel.scan_cache.unchanged(&rel, stamp))
                .cloned();
            if let Some(facts) = cached {
                out.push(WalkedFile {
                    rel,
                    text: None,
                    facts,
                });
                continue;
            }
            kernel.scan_cache.note_read();
            match std::fs::read(&path) {
                Ok(bytes) => match String::from_utf8(bytes) {
                    Ok(text) => {
                        let facts = FileFacts {
                            identity: read_identity(&text),
                            hash: None,
                        };
                        kernel
                            .scan_cache
                            .remember(&rel, stamp, stamped_at, facts.clone());
                        out.push(WalkedFile {
                            rel,
                            text: Some(text),
                            facts,
                        });
                    }
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
    finish(kernel, out)
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

/// Sort by path, and drop every cache entry this walk did not see.
fn finish(
    kernel: &mut WorkspaceKernel,
    mut out: Vec<WalkedFile>,
) -> Result<Vec<WalkedFile>, String> {
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    let seen: HashSet<&str> = out.iter().map(|file| file.rel.as_str()).collect();
    kernel.scan_cache.keep_only(&seen);
    Ok(out)
}

#[cfg(test)]
#[path = "scan_walk.test.rs"]
mod tests;
