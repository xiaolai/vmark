//! Diagnostic emission + ignored-path helpers split from `scan.rs` for the
//! file-size gate. Diagnostics are deduped against the ledger by (code,
//! path) so repeated scans never spam append-only history (spec §5.6);
//! ignored-dir paths are the walk's blind spots (audit C8).

use std::collections::HashSet;

use serde_json::json;

use super::scan::{ScanReport, IGNORED_DIRS};
use super::state::WorkspaceKernel;
use super::types::{Envelope, TypedBody};

/// A workspace-relative path that lives UNDER an ignored directory — the
/// walk never descends there, so its files can't be verified present or
/// absent (audit C8). Only a NON-LEAF segment counts: a real object whose
/// own filename is `node_modules` is not under an ignored dir (audit #3),
/// and both `/` and `\` are honored so a Windows-style path isn't misread
/// as a single unignored segment.
pub(super) fn path_under_ignored_dir(path: &str) -> bool {
    let mut segments: Vec<&str> = path.split(['/', '\\']).collect();
    segments.pop(); // drop the leaf — the file itself, not a parent dir
    segments.into_iter().any(|seg| IGNORED_DIRS.contains(&seg))
}

/// Diagnostics are deduped against the ledger by (code, path) so repeated
/// scans do not spam append-only history (spec §5.6).
pub(super) fn existing_diagnostic_keys(entries: &[Envelope]) -> HashSet<(String, String)> {
    let mut keys = HashSet::new();
    for entry in entries {
        if let Ok(TypedBody::Diagnostic(d)) = entry.typed() {
            keys.insert((d.code, d.path.unwrap_or_default()));
        }
    }
    keys
}

pub(super) fn emit_diagnostic(
    kernel: &mut WorkspaceKernel,
    existing: &mut HashSet<(String, String)>,
    report: &mut ScanReport,
    code: &str,
    message: &str,
    path: &str,
) -> Result<(), String> {
    report.diagnostics += 1;
    if !existing.insert((code.to_string(), path.to_string())) || !kernel.is_initialized() {
        return Ok(());
    }
    let env = Envelope::create(
        "diagnostic",
        kernel.writer(),
        json!({ "code": code, "message": message, "path": path }),
    );
    kernel.append_and_apply(&env)
}
