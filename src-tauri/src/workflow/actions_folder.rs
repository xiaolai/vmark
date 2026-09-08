//! `action/read-folder`: every accepted regular file directly inside a
//! workspace directory, concatenated in a deterministic order.
//!
//! Split from `actions.rs` at the file-size gate. Three properties hold here:
//!   - Entries are ordered by their RAW names (#255) — `OsString`, which
//!     orders by bytes and needs no locale — so identical folders feed a
//!     workflow identically on every filesystem and platform. A sort on the
//!     lossy UTF-8 rendering could order two distinct non-UTF-8 names as
//!     equal and leave them in filesystem order.
//!
//!     "Every platform" is a claim about the ENCODING, and it is pinned:
//!     `OsString`'s `Ord` compares raw bytes on Unix and WTF-8 on Windows,
//!     and for any name that can exist on BOTH — valid Unicode — those are
//!     the same bytes, which is UTF-8 order, which is code-point order.
//!     `actions.test.rs` asserts that agreement over ASCII, accents, CJK and
//!     an astral character, the last being where a UTF-16 order (how Windows
//!     STORES names) would diverge. A name that is not valid Unicode cannot
//!     exist on the other platform at all, so there is nothing to agree with.
//!   - Each read is bounded by the smaller of the per-file cap and what is
//!     left of the total budget (#254), on the bytes actually read: the last
//!     file cannot allocate a full 10 MB past the 100 MB total before it is
//!     refused, and one that grows during the read cannot pass.
//!
//!     The budget charges **what is EMITTED**, not what was read (#256): a
//!     file that is skipped is unpaid, or a folder would be refused over a
//!     file that contributed nothing. Enforcing that consistently is what
//!     #511 fixed: a file whose bytes are definitively not UTF-8 is skipped
//!     even when it is the read against the remaining budget that noticed,
//!     so the same directory no longer succeeds or fails depending on
//!     filename ORDER — which is what it did while a late non-UTF-8 file
//!     returned `OverBudget` and an early one was free.
//!
//!     The per-entry framing (`--- name ---` and the blank line) is NOT
//!     charged: it is at most ~22 bytes × `MAX_FILES_PER_FOLDER`, ~22 KB
//!     against 100 MB, and the file caps are pinned exactly by tests that
//!     fill the budget to the byte.
//!   - **One output buffer, not a `Vec<String>` joined at the end** (#507).
//!     Each entry was formatted into its own `String` (a copy of the file) and
//!     `join` then copied all of them again, so a 100 MB read peaked at
//!     roughly 200 MB plus the per-entry buffers.
//!   - Type and size are judged on the OPEN handle (#253, `bounded_read`),
//!     so a FIFO planted between the listing and the read is refused by the
//!     read, not waited on.
//!
//! @coordinates-with actions.rs — the dispatcher and the shared limits
//! @module workflow::actions_folder

use super::actions::{matches_accept, MAX_FILE_SIZE_BYTES};
use crate::bounded_read::{open_regular, BoundedReadError};
use std::collections::HashMap;
use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_FILES_PER_FOLDER: usize = 1000;
const MAX_TOTAL_READ_BYTES: u64 = 100 * 1024 * 1024; // 100MB

/// One folder entry's bytes, or why it contributed nothing.
enum EntryRead {
    Bytes(Vec<u8>),
    /// Over the per-file cap: skipped, the folder still reads.
    Oversized,
    /// Would carry the total past its budget: the folder is refused.
    OverBudget,
    /// Not a regular file, or unreadable: skipped with a reason.
    Skipped(String),
}

/// Read one entry with at most `remaining` bytes of the total budget left.
fn read_entry(path: &Path, remaining: u64) -> EntryRead {
    let (file, reported_len) = match open_regular(path) {
        Ok(pair) => pair,
        Err(BoundedReadError::NotRegular) => {
            return EntryRead::Skipped("not a regular file".into())
        }
        Err(e) => return EntryRead::Skipped(e.to_string()),
    };
    if reported_len > MAX_FILE_SIZE_BYTES {
        return EntryRead::Oversized;
    }
    // The bound is whichever is smaller: the per-file cap, or what the
    // total can still take. One byte past it decides.
    let limit = MAX_FILE_SIZE_BYTES.min(remaining);
    let mut buf = Vec::new();
    if let Err(e) = file.take(limit.saturating_add(1)).read_to_end(&mut buf) {
        return EntryRead::Skipped(e.to_string());
    }
    if buf.len() as u64 > limit {
        // A file that is definitively not text contributes nothing, so it is
        // SKIPPED rather than allowed to refuse the whole folder (#511). The
        // budget charges what is emitted (#256), and enforcing that only when
        // the decode is reached made the same directory succeed or fail on
        // filename ORDER: an early non-UTF-8 file was free, a late one hit the
        // remaining budget first and came back `OverBudget`.
        //
        // `error_len().is_some()` is the distinction that makes this safe: an
        // INVALID sequence is invalid however much more had followed, whereas
        // a truncated one (`None`) says only that the read stopped mid
        // character, which is exactly what a bounded read does.
        if let Err(e) = std::str::from_utf8(&buf) {
            if e.error_len().is_some() {
                return EntryRead::Skipped("not valid UTF-8".into());
            }
        }
        return if remaining < MAX_FILE_SIZE_BYTES {
            EntryRead::OverBudget
        } else {
            EntryRead::Oversized
        };
    }
    EntryRead::Bytes(buf)
}

/// The accepted entries of `path`, in the deterministic RAW-name order (#255),
/// refusing a directory with more of them than the cap allows.
///
/// Split out of `read_folder` (audit 20260907 #506), which held enumeration,
/// the cap, containment, blocking I/O, decoding, budgeting and formatting in
/// one scope. This half is decided entirely by the listing and the accept
/// pattern, and it is the half with a bound in it.
async fn collect_candidates(
    path_str: &str,
    path: &Path,
    accept: &str,
) -> Result<Vec<(OsString, PathBuf)>, String> {
    let mut dir = tokio::fs::read_dir(path)
        .await
        .map_err(|e| format!("Failed to read directory '{}': {}", path_str, e))?;

    let mut candidates: Vec<(OsString, PathBuf)> = Vec::new();
    while let Some(entry) = dir
        .next_entry()
        .await
        .map_err(|e| format!("Failed to read entry: {}", e))?
    {
        if candidates.len() + 1 > MAX_FILES_PER_FOLDER {
            return Err(format!(
                "Directory '{}' exceeds max file limit ({})",
                path_str, MAX_FILES_PER_FOLDER
            ));
        }
        let name = entry.file_name();
        if !matches_accept(&name.to_string_lossy(), accept) {
            continue;
        }
        candidates.push((name, entry.path()));
    }
    candidates.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(candidates)
}

/// The section label for an entry, UNIQUE even when its name is not UTF-8
/// (audit 20260907 #508). `to_string_lossy` maps every invalid byte to the
/// replacement character, so two names differing only in their invalid bytes
/// render IDENTICALLY — two sections a consumer cannot tell apart, in output
/// whose whole structure is "this content came from that name". The ORDER was
/// already fixed for exactly this (#255, header); the LABEL was not. A valid
/// name is unchanged, so only a name that cannot round-trip gains the byte
/// suffix — and it gains it because nothing else distinguishes it.
fn section_label(raw_name: &OsString) -> String {
    match raw_name.to_str() {
        Some(name) => name.to_string(),
        None => {
            let hex: String = raw_name
                .as_encoded_bytes()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            format!("{} (bytes {hex})", raw_name.to_string_lossy())
        }
    }
}

/// An entry the read did not include, and why.
struct SkippedEntry {
    label: String,
    reason: String,
}

/// The trailing section naming what the read left out (audit 20260907 #510).
/// Every skip was already LOGGED, so "silently omitted" is half true — but a
/// log line is not reachable by what consumes this output, the next workflow
/// step: a read returning three of five files was indistinguishable from one
/// returning all five, so a genie summarising "the folder" was summarising an
/// unannounced subset. In band, in the same `--- name ---` vocabulary, and only
/// when something WAS skipped, so a complete read is byte-identical to before;
/// like the per-entry framing it is not charged against the budget (header).
/// Refusing the folder instead — the finding's other option — is what #511
/// removed: one binary file would refuse the lot.
fn skipped_section(skipped: &[SkippedEntry]) -> String {
    let mut out = format!("--- skipped ({}) ---", skipped.len());
    for entry in skipped {
        out.push('\n');
        out.push_str(&entry.label);
        out.push_str(": ");
        out.push_str(&entry.reason);
    }
    out
}

pub(super) async fn read_folder(
    path_str: &str,
    path: &Path,
    params: &HashMap<String, String>,
    workspace_root: &Path,
) -> Result<String, String> {
    // Canonical root for per-entry symlink containment checks below.
    let canonical_root = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    let accept = params.get("accept").map(|s| s.as_str()).unwrap_or("*");
    let candidates = collect_candidates(path_str, path, accept).await?;

    // One buffer, appended in place (#507).
    let mut out = String::new();
    let mut total_bytes: u64 = 0;
    let mut skipped: Vec<SkippedEntry> = Vec::new();
    for (raw_name, raw_path) in candidates {
        let name = raw_name.to_string_lossy().into_owned();
        let label = section_label(&raw_name);
        // Resolve symlinks and verify the target stays inside the
        // workspace — the directory was validated, but an entry may
        // be a symlink pointing outside the sandbox.
        let entry_path = match tokio::fs::canonicalize(&raw_path).await {
            Ok(p) => p,
            Err(e) => {
                log::warn!("Skipping unresolvable entry '{}': {}", name, e);
                skipped.push(SkippedEntry {
                    label,
                    reason: format!("could not be resolved: {e}"),
                });
                continue;
            }
        };
        if !entry_path.starts_with(&canonical_root) {
            log::warn!("Skipping '{}': resolves outside the workspace", name);
            skipped.push(SkippedEntry {
                label,
                reason: "resolves outside the workspace".to_string(),
            });
            continue;
        }

        let remaining = MAX_TOTAL_READ_BYTES.saturating_sub(total_bytes);
        let read = tokio::task::spawn_blocking(move || read_entry(&entry_path, remaining))
            .await
            .map_err(|e| format!("Failed to read '{}': {}", name, e))?;
        let content = match read {
            EntryRead::Bytes(bytes) => match String::from_utf8(bytes) {
                Ok(text) => text,
                Err(e) => {
                    log::warn!("Skipping unreadable file '{}': {}", name, e);
                    skipped.push(SkippedEntry {
                        label,
                        reason: "not valid UTF-8".to_string(),
                    });
                    continue;
                }
            },
            EntryRead::Oversized => {
                log::warn!("Skipping oversized file '{}'", name);
                skipped.push(SkippedEntry {
                    label,
                    reason: format!("over the per-file limit ({MAX_FILE_SIZE_BYTES} bytes)"),
                });
                continue;
            }
            EntryRead::OverBudget => {
                return Err(format!(
                    "Total read size exceeds limit ({} bytes)",
                    MAX_TOTAL_READ_BYTES
                ));
            }
            EntryRead::Skipped(reason) => {
                log::warn!("Skipping '{}': {}", name, reason);
                skipped.push(SkippedEntry { label, reason });
                continue;
            }
        };
        total_bytes += content.len() as u64;
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str("--- ");
        out.push_str(&label);
        out.push_str(" ---\n");
        out.push_str(&content);
    }
    if !skipped.is_empty() {
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str(&skipped_section(&skipped));
    }
    Ok(out)
}

#[cfg(test)]
#[path = "actions_folder.test.rs"]
mod tests;
