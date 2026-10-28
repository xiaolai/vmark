//! Retiring the legacy checkpoint log (`mcp-checkpoints.jsonl`).
//!
//! Purpose: after startup imports the log into the journal, move it aside
//! only when the journal verifiably holds every checkpoint in it. The log
//! is renamed, never rewritten or deleted; unverified or failed, it stays
//! where it is and the next start retries. Idempotent: a missing log is
//! `Absent`, and an earlier identical archive is reused.
//!
//! @module agent_journal/service_legacy

use std::path::Path;

use serde::Serialize;

use crate::agent_journal::legacy_import::{retire_legacy_file, LegacyImportReport, RetireError};

/// What startup did with `mcp-checkpoints.jsonl` once it was imported.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum LegacyRetirement {
    /// No log to retire (never existed, or retired by an earlier start).
    Absent,
    /// Moved aside to this file name, beside where it was.
    Retired { to: String },
    /// The journal does not hold every checkpoint exactly: kept in place.
    NotVerified,
    /// The import or the move failed: kept in place; the next start retries.
    Kept { reason: String },
}

/// Retire the legacy log at `path` after a verified `import`. Idempotent:
/// a missing log is `Absent`, and an earlier identical archive is reused.
pub fn retire_legacy(path: &Path, import: &Result<LegacyImportReport, String>) -> LegacyRetirement {
    let report = match import {
        Ok(report) => report,
        Err(e) => return LegacyRetirement::Kept { reason: e.clone() },
    };
    let out = match retire_legacy_file(path, report) {
        Ok(to) => LegacyRetirement::Retired {
            to: to
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
        },
        Err(RetireError::NotFound) => LegacyRetirement::Absent,
        Err(RetireError::NotVerified) => LegacyRetirement::NotVerified,
        Err(RetireError::TargetExists) => LegacyRetirement::Kept {
            reason: "every archive name beside it is taken".into(),
        },
        Err(RetireError::Io(e)) => LegacyRetirement::Kept { reason: e },
    };
    match &out {
        LegacyRetirement::Retired { to } => {
            log::info!("agent journal: legacy checkpoint log retired to {to}")
        }
        LegacyRetirement::NotVerified => {
            log::warn!("agent journal: legacy checkpoint log kept: the journal does not verify it")
        }
        LegacyRetirement::Kept { reason } => {
            log::warn!("agent journal: legacy checkpoint log kept: {reason}")
        }
        LegacyRetirement::Absent => {}
    }
    out
}
