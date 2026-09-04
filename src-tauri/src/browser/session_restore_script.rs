//! The localStorage replay script a `session.load` runs in the page, and its result.
//!
//! Split from `session_commands.rs`. The script is the asset `session_restore.src.js`
//! (`include_str!`); the saved values and the approved origin are appended to it as
//! the arguments of a CALL — never interpolated into code. The script re-checks the
//! EXECUTING document's live origin against the approved one immediately before any
//! write, in the SAME synchronous turn, so a navigation that raced the main-thread
//! dispatch cannot land the credential in a different origin. Every write is checked:
//! a rejected `setItem` (quota, a storage-disabled origin) puts the preceding writes
//! back to their previous values and reports the failing entry's INDEX — never the
//! key or the value (audit 2026-09-03 round 1; it used to be swallowed and reported as
//! applied:true). A put-back that itself throws is REPORTED, by index, as a distinct
//! outcome (round 3, #30): the page's storage is then only partly restored, and the
//! caller is told that instead of being told the rollback succeeded.
//!
//! The JavaScript is executed, against a storage that throws, by
//! `src/services/browser/sessionRestoreScript.test.ts`; the tests here cover the
//! parse, the call shape, and how each outcome is reported.
//!
//! @coordinates-with browser/session_commands.rs — the only caller
//! @coordinates-with src/services/browser/sessionRestoreScript.test.ts — runs the asset

use crate::browser::ai_guards::surface_failure;
use crate::browser::refusals::stale_command;
use crate::command_error::{CommandError, ErrorCode};

/// The asset, whole: one function expression over `(d, expected)`.
const RESTORE_SRC: &str = include_str!("session_restore.src.js");

/// What the page reported back, parsed without trusting its shape.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum RestoreOutcome {
    Applied,
    OriginChanged,
    /// Storage could not be READ at data index `index`, before any write: nothing
    /// was written, so there is nothing to roll back.
    ReadFailed {
        index: Option<u64>,
    },
    /// Write `index` was rejected; every earlier write was put back.
    WriteFailed {
        index: Option<u64>,
    },
    /// Write `index` was rejected AND putting back the earlier writes at `failed`
    /// (data indices, ascending) threw too: the page's storage is partly restored.
    RollbackFailed {
        index: Option<u64>,
        failed: Vec<u64>,
    },
    Unreadable,
}

/// `pairs` and `expected` are JSON literals (an array of `[key, value]` pairs and
/// the committed origin URL string), already serialized by the caller. They become
/// the CALL's arguments, after the whole asset.
pub(super) fn restore_script(pairs: &str, expected: &str) -> String {
    format!("return ({RESTORE_SRC})({pairs},{expected});")
}

pub(super) fn parse_restore_outcome(raw: &str) -> RestoreOutcome {
    let Ok(outcome) = serde_json::from_str::<serde_json::Value>(raw) else {
        return RestoreOutcome::Unreadable;
    };
    if outcome.get("applied").and_then(|v| v.as_bool()) == Some(true) {
        return RestoreOutcome::Applied;
    }
    match outcome.get("reason").and_then(|v| v.as_str()) {
        Some("origin-changed") => RestoreOutcome::OriginChanged,
        Some("read-failed") => RestoreOutcome::ReadFailed {
            index: outcome.get("index").and_then(|v| v.as_u64()),
        },
        Some("write-failed") => {
            let index = outcome.get("index").and_then(|v| v.as_u64());
            match rollback_failures(&outcome) {
                Some(failed) if failed.is_empty() => RestoreOutcome::WriteFailed { index },
                Some(failed) => RestoreOutcome::RollbackFailed { index, failed },
                None => RestoreOutcome::Unreadable,
            }
        }
        _ => RestoreOutcome::Unreadable,
    }
}

/// The `rollbackFailed` list: always an array of indices from this script, so
/// anything else — absent, not an array, a non-index — is `None`, a shape the script
/// never produces. Normalised to ascending, deduplicated data indices.
fn rollback_failures(outcome: &serde_json::Value) -> Option<Vec<u64>> {
    let items = outcome.get("rollbackFailed")?.as_array()?;
    let mut failed = items
        .iter()
        .map(serde_json::Value::as_u64)
        .collect::<Option<Vec<u64>>>()?;
    failed.sort_unstable();
    failed.dedup();
    Some(failed)
}

impl RestoreOutcome {
    /// Report the outcome at the command boundary. A refused write is `io`
    /// (`detail.rolledBack` says whether the page is as it was); an origin that moved
    /// under the restore is the same stale-command conflict every other late write
    /// raises; a result this script cannot have produced is an internal failure.
    pub(super) fn into_result(self, tab_id: &str) -> Result<(), CommandError> {
        match self {
            RestoreOutcome::Applied => Ok(()),
            // The page's origin changed before the write: refuse rather than plant a
            // credential in a different origin.
            RestoreOutcome::OriginChanged => Err(stale_command(
                tab_id,
                "before the session could be restored",
            )),
            RestoreOutcome::ReadFailed { index } => Err(CommandError::new(
                ErrorCode::Io,
                "the page's localStorage could not be read (storage policy); nothing was written",
            )
            .with_detail(serde_json::json!({ "index": index, "written": false }))),
            RestoreOutcome::WriteFailed { index } => Err(CommandError::new(
                ErrorCode::Io,
                "the page refused a localStorage write (quota or storage policy); the restore was rolled back",
            )
            .with_detail(serde_json::json!({ "index": index, "rolledBack": true }))),
            RestoreOutcome::RollbackFailed { index, failed } => Err(CommandError::new(
                ErrorCode::Io,
                "the page refused a localStorage write (quota or storage policy), and putting the earlier writes back failed too — the page's storage is only partly restored",
            )
            .with_detail(serde_json::json!({
                "index": index,
                "rolledBack": false,
                "rollbackFailed": failed,
            }))),
            RestoreOutcome::Unreadable => {
                Err(surface_failure("session restore returned an unreadable result"))
            }
        }
    }
}

#[cfg(test)]
#[path = "session_restore_script.test.rs"]
mod tests;
