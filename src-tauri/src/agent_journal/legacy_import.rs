//! One-time migration of the frontend's checkpoint log into the journal.
//!
//! The frontend keeps every AI-edit checkpoint as one JSON line in
//! `<appData>/mcp-checkpoints.jsonl`. Each well-formed line becomes one
//! `legacyCheckpoint` record whose preimage is a journal blob; nothing in a
//! revision chain refers to it.
//!
//! Key decisions:
//!   - Read with the frontend loader's rules: blank lines ignored, a line
//!     that does not parse (torn, ill-formed text, missing field) skipped and
//!     counted, and the newest line of a repeated id wins.
//!   - Idempotent by legacy id, so running it at every startup is the
//!     "once": only lines the journal has never seen are written.
//!   - The original file is never modified. `retire_legacy_file` renames it
//!     aside, and only for a report that verified every checkpoint in the
//!     journal byte for byte; a malformed line is not a verification failure
//!     because no reader could ever recover it, and the renamed file keeps it.
//!     Retiring is idempotent and never overwrites an earlier archive: the
//!     move is a no-replace claim (`claim_archive`), so an archive anyone
//!     creates meanwhile is refused and the next name tried, unless it is a
//!     regular-file copy of the original (`legacy_archive`). It also runs
//!     only under the journal's exclusive lock (`journal_file`).
//!   - The log is read whole, so it is capped (`LEGACY_MAX_BYTES`): a larger
//!     one is refused before anything is parsed or appended and stays where
//!     it is.
//!
//! @module agent_journal/legacy_import

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::agent_journal::codec::{self, LegacyMigration};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::record::Record;
use crate::agent_journal::writer::Writer;

#[path = "legacy_archive.rs"]
mod legacy_archive;
use legacy_archive::Original;

/// The frontend's checkpoint log, under the app-data directory.
pub const LEGACY_CHECKPOINT_FILE: &str = "mcp-checkpoints.jsonl";
/// Largest log the import reads. The frontend capped its retained
/// checkpoints at 5 MiB and rewrote the log to that at every start, so a
/// real log is far below this.
pub const LEGACY_MAX_BYTES: u64 = 64 * 1024 * 1024;
/// Appended to the file name when a verified original is retired.
pub const RETIRED_SUFFIX: &str = ".migrated";

/// What one import pass saw and did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportReport {
    /// The file existed.
    pub found: bool,
    /// Non-blank lines read.
    pub lines: usize,
    /// Lines skipped because they do not parse as a checkpoint.
    pub malformed: usize,
    /// Distinct checkpoint ids among the well-formed lines.
    pub checkpoints: usize,
    /// Records this pass appended (zero on a re-run).
    pub appended: usize,
    /// Every checkpoint is in the journal with identical metadata and bytes.
    pub verified: bool,
}

/// Why a retirement was refused. The original stays in place for all of them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RetireError {
    NotFound,
    NotVerified,
    TargetExists,
    Io(String),
}

/// Import every well-formed checkpoint of `path` not yet in the journal, then
/// verify all of them against the journal. A missing file is an empty report.
///
/// # Errors
/// The writer's refusal (degraded, corrupt) or an I/O
/// failure reading the file or appending; records appended before the
/// failure stay, and the next run continues from them. A log over
/// [`LEGACY_MAX_BYTES`] is an I/O refusal.
pub fn import_legacy_file(w: &Writer, path: &Path) -> Result<LegacyImportReport, TxnError> {
    import_legacy_file_within(w, path, LEGACY_MAX_BYTES)
}

/// [`import_legacy_file`] with the size cap as a parameter.
pub(crate) fn import_legacy_file_within(
    w: &Writer,
    path: &Path,
    max_bytes: u64,
) -> Result<LegacyImportReport, TxnError> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(LegacyImportReport::default())
        }
        Err(e) => return Err(e.into()),
    };
    // One byte past the cap is read, so a log that grew after any size
    // check is still caught; at `u64::MAX` the cap is the whole file.
    let mut bytes = Vec::new();
    let limit = max_bytes.saturating_add(1);
    std::io::Read::read_to_end(&mut std::io::Read::take(file, limit), &mut bytes)?;
    if bytes.len() as u64 > max_bytes {
        return Err(TxnError::Io(format!(
            "the legacy checkpoint log exceeds the {max_bytes}-byte import limit; it is kept unimported"
        )));
    }
    let (lines, malformed, migrations) = parse(&bytes);
    let appended = w.import_legacy(&migrations)?;
    let verified = migrations.iter().all(|m| in_journal(w, m));
    Ok(LegacyImportReport {
        found: true,
        lines,
        malformed,
        checkpoints: migrations.len(),
        appended,
        verified,
    })
}

/// Non-blank line count, malformed count, and one migration per id (the
/// newest line's), in first-seen order.
fn parse(bytes: &[u8]) -> (usize, usize, Vec<LegacyMigration>) {
    let (mut lines, mut malformed) = (0, 0);
    let mut out: Vec<LegacyMigration> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for raw in bytes.split(|b| *b == b'\n') {
        let Ok(line) = std::str::from_utf8(raw) else {
            lines += 1;
            malformed += 1;
            continue;
        };
        if line.trim().is_empty() {
            continue;
        }
        lines += 1;
        let Ok(m) = codec::migrate_legacy_line(line) else {
            malformed += 1;
            continue;
        };
        let id = legacy_id(&m).to_string();
        match index.get(&id) {
            Some(&at) => out[at] = m,
            None => {
                index.insert(id, out.len());
                out.push(m);
            }
        }
    }
    (lines, malformed, out)
}

fn legacy_id(m: &LegacyMigration) -> &str {
    match &m.record {
        Record::LegacyCheckpoint { legacy_id, .. } => legacy_id,
        _ => "",
    }
}

/// The journal holds this checkpoint with the same metadata, and its
/// preimage blob reads back as the same text.
fn in_journal(w: &Writer, m: &LegacyMigration) -> bool {
    let Record::LegacyCheckpoint {
        legacy_id,
        preimage,
        postimage,
        anchor,
        tool,
        description,
        timestamp,
    } = &m.record
    else {
        return false;
    };
    let Some(entry) = w.legacy_entry(legacy_id) else {
        return false;
    };
    let same = (
        &entry.preimage,
        &entry.postimage,
        &entry.anchor,
        &entry.tool,
    ) == (preimage, postimage, anchor, tool)
        && (&entry.description, entry.timestamp) == (description, *timestamp);
    same && w.blob_text(preimage).is_ok_and(|t| t == m.preimage_text)
}

/// Most archives tried beside the original (`.migrated`, `.migrated-2`, …).
pub const MAX_ARCHIVES: usize = 100;

/// Move a verified original aside to `<name>.migrated` (or the first free
/// `.migrated-<n>`). Never rewrites its bytes and never overwrites an
/// earlier archive: an archive byte-identical to the original is the same
/// retirement repeated (a crash after an earlier copy), so the original is
/// only removed.
///
/// The caller must have stopped every writer of the original first: a line
/// appended after `report` was taken would move aside unmigrated (kept, but
/// not in the journal).
///
/// # Errors
/// See [`RetireError`]; the original is untouched on every error.
pub fn retire_legacy_file(
    path: &Path,
    report: &LegacyImportReport,
) -> Result<PathBuf, RetireError> {
    retire_with(path, report, claim_archive)
}

/// Move `from` to `to` only if nothing is at `to`, in one step: an archive
/// created by anyone after the name was chosen is refused (`AlreadyExists`),
/// never replaced. `persist_noclobber` is `renameat2(RENAME_NOREPLACE)` on
/// Linux, `renamex_np(RENAME_EXCL)` on macOS, `MoveFileExW` without
/// `MOVEFILE_REPLACE_EXISTING` on Windows, and `link` + `unlink` where the
/// filesystem has neither. Cleanup is disabled first, so no outcome can
/// delete the original.
pub(crate) fn claim_archive(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut original = tempfile::TempPath::try_from_path(from)?;
    original.disable_cleanup(true);
    original.persist_noclobber(to).map_err(|e| e.error)
}

/// [`retire_legacy_file`] with the claim injected, so a test can create the
/// archive name just before the production claim runs.
pub(crate) fn retire_with(
    path: &Path,
    report: &LegacyImportReport,
    claim: impl Fn(&Path, &Path) -> std::io::Result<()>,
) -> Result<PathBuf, RetireError> {
    // A failed existence check is an I/O failure, not an absence.
    let exists = path
        .try_exists()
        .map_err(|e| RetireError::Io(e.to_string()))?;
    if !report.found || !exists {
        return Err(RetireError::NotFound);
    }
    if !report.verified {
        return Err(RetireError::NotVerified);
    }
    let name = path
        .file_name()
        .ok_or(RetireError::NotFound)?
        .to_os_string();
    let io = |e: std::io::Error| RetireError::Io(e.to_string());
    let mut original = Original::new(path).map_err(io)?;
    for n in 1..=MAX_ARCHIVES {
        let mut archive = name.clone();
        archive.push(RETIRED_SUFFIX);
        if n > 1 {
            archive.push(format!("-{n}"));
        }
        let target = path.with_file_name(archive);
        // Only a claim that finds the name free takes it; a taken name is
        // judged below, and any other failure is refused.
        match claim(path, &target) {
            Ok(()) => return Ok(target),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(RetireError::Io(format!("cannot claim archive name: {e}"))),
        }
        if original.is_copy_at(&target).map_err(io)? {
            std::fs::remove_file(path).map_err(io)?;
            return Ok(target);
        }
    }
    Err(RetireError::TargetExists)
}

#[cfg(test)]
#[path = "legacy_import_bounds.test.rs"]
mod bounds_tests;
