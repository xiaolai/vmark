//! The pre-spawn half of `run_workflow` that touches the filesystem: which
//! files a run may modify, and the snapshot that makes them recoverable.
//!
//! Split from `commands.rs` at the file-size gate (#262). The snapshot is
//! REQUIRED for a file-modifying workflow (#266): "snapshots created before
//! execution for file-modifying steps" is the recovery guarantee the module
//! header promises, and a snapshot that failed used to be logged and walked
//! past — the destructive `save-file` steps then ran with nothing to restore.
//! And it is the ONLY thing that needs the app-data directory (#265): a
//! workflow with nothing to snapshot never asks for it, so a platform that
//! cannot resolve one still runs action-only workflows. The execution id is
//! settled here too (`execution_id_for`, #264): it names the snapshot
//! directory, so it is validated before anything is built from it.
//!
//! `prepare_run` is the whole stretch between admission and the spawn: the
//! snapshot — bounded, and stopped by the runner's cancel flag between
//! chunks (#267) — a cancel that landed meanwhile, and the genies directory
//! the runner reads from. It is AWAITED by the command on purpose: #266
//! makes a failed snapshot the invoke's own error, and only work the command
//! waits for can refuse the command.
//!
//! @coordinates-with commands.rs — the only caller
//! @coordinates-with snapshots.rs — `create_snapshot_unless`
//! @module workflow::prepare

use super::genie_step::resolve_genies_dir;
use super::snapshots;
use super::state::WorkflowRunnerState;
use super::types::RawWorkflow;
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};
use uuid::Uuid;

/// The id a run will carry: the caller's, validated (#264), or a fresh UUID.
///
/// The RULE — non-empty, at most `snapshots::MAX_ID_LEN`, drawn from
/// `[A-Za-z0-9_-]` — is `snapshots::validate_id`'s, and is consulted here
/// rather than restated (audit 20260907 #549). Both are path-safety rules
/// about the SAME string: the id is the key every event and cancel is matched
/// on AND a snapshot directory name, so two copies could drift into a value
/// this entry point accepts and the snapshot layer refuses — or worse, the
/// other way. Reuse is refused one step later, by
/// `WorkflowRunnerState::begin_execution`.
///
/// What is NOT delegated is the MESSAGE. `validate_id` echoes the whole id,
/// and echoing an unbounded value is the defect #550 removed from here: a
/// megabyte-long id produced a megabyte-long `CommandError` across IPC and
/// into the log. The bound belongs with the message that has to respect it.
pub(super) fn execution_id_for(supplied: Option<String>) -> Result<String, CommandError> {
    let Some(id) = supplied else {
        return Ok(Uuid::new_v4().to_string());
    };
    match snapshots::validate_id(&id) {
        Ok(()) => Ok(id),
        Err(_) => Err(CommandError::invalid_input(format!(
            "invalid execution id {} ({} characters): expected 1–{} characters from [A-Za-z0-9_-]",
            preview(&id),
            id.chars().count(),
            snapshots::MAX_ID_LEN,
        ))),
    }
}

/// How much of a rejected id the message quotes.
const ID_PREVIEW_CHARS: usize = 32;

/// A bounded, debug-quoted look at a value this function is REFUSING for being
/// unbounded (#550). Echoing the whole id made the refusal itself the way past
/// the limit: a megabyte-long id produced a megabyte-long `CommandError`
/// message, serialized across IPC and written to the log. The LENGTH is what a
/// caller needs to see; a prefix is what makes it recognisable.
fn preview(id: &str) -> String {
    let head: String = id.chars().take(ID_PREVIEW_CHARS).collect();
    if head.chars().count() < id.chars().count() {
        format!("{head:?}…")
    } else {
        format!("{head:?}")
    }
}

/// Refuse a `save-file` step whose target cannot be snapshotted (#521/#551).
///
/// `snapshot_targets` reads `with.path` as written, but a step's `with` values
/// carry the full expression grammar — `${{ env.OUT }}`, `${{ steps.x.outputs.
/// path }}`, legacy `${VAR}` — which the RUNNER resolves, long after the
/// pre-run snapshot has been taken. So a dynamic path made the snapshot
/// protect a literal placeholder while `save-file` overwrote a real, existing
/// file that had never been copied: the recovery copy the whole mechanism
/// exists to provide was of the wrong file, and silently.
///
/// Refusing at admission is the fail-closed answer, and it is the honest one:
/// resolving the path early is not possible (it may depend on a step that has
/// not run), and snapshotting at write time is a different design. The error
/// says what to do about it, and every other `with` value stays dynamic.
pub(super) fn reject_dynamic_save_paths(workflow: &RawWorkflow) -> Result<(), CommandError> {
    for step in &workflow.steps {
        if step.uses != "action/save-file" {
            continue;
        }
        let Some(path) = step.with.get("path") else {
            continue;
        };
        if path.contains("${") {
            return Err(CommandError::invalid_input(format!(
                "step {:?}: a save-file path may not contain an expression ({path:?}). \
                 The pre-run snapshot has to know which file it is protecting before the \
                 workflow starts, and an expression is not resolved until the step runs.",
                step.id.as_deref().unwrap_or("(unnamed)")
            )));
        }
    }
    Ok(())
}

/// Every path an `action/save-file` step will write, resolved against the
/// workspace — each one ONCE. Pure, so the resolution is testable without a
/// snapshot.
///
/// Deduplicated (#552): a workflow that writes the same file in two steps is
/// ordinary — a draft then a revision — and the pre-run snapshot of a file is
/// the same copy whichever step is about to overwrite it. Copying it twice
/// charged it twice against the snapshot's own size and count limits, so a
/// workflow could be refused for a budget it did not actually need.
///
/// Deliberately NOT canonicalized: `reject_dynamic_save_paths` has already
/// refused every path that is not literal, and resolving these would introduce
/// a second resolution of a name the sandbox checks separately — the class
/// `ensure_dir.rs` and `commit_dir.rs` exist to remove. Two spellings of one
/// file are therefore still two targets, which is safe: an extra snapshot
/// costs a copy, never a missing recovery point.
pub(super) fn snapshot_targets(workflow: &RawWorkflow, workspace: &Path) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    workflow
        .steps
        .iter()
        .filter(|s| s.uses == "action/save-file")
        .filter_map(|s| s.with.get("path"))
        .map(|p| {
            if Path::new(p).is_absolute() {
                PathBuf::from(p)
            } else {
                workspace.join(p)
            }
        })
        .filter(|p| seen.insert(p.clone()))
        .collect()
}

/// The directory snapshots live under, resolved through `app_data_dir` ONLY
/// when `files` is non-empty (#265). `Ok(None)` means nothing to snapshot —
/// the resolver was never consulted, so its failure cannot refuse the run.
pub(super) fn snapshot_root(
    files: &[PathBuf],
    app_data_dir: impl FnOnce() -> Result<PathBuf, String>,
) -> Result<Option<PathBuf>, CommandError> {
    if files.is_empty() {
        return Ok(None);
    }
    app_data_dir().map(Some).map_err(|e| {
        localized_error!(
            ErrorCode::Io,
            "errors.workflow.appDataDirUnavailable",
            detail = e
        )
    })
}

/// Snapshot `files` under `app_data_dir`, or refuse the run. A workflow with
/// nothing to snapshot passes without touching the filesystem. `should_stop`
/// is consulted between chunks of every copy (#267).
pub(super) async fn snapshot_or_refuse(
    app_data_dir: &Path,
    execution_id: &str,
    files: &[PathBuf],
    workspace: &Path,
    should_stop: &(dyn Fn() -> bool + Sync),
) -> Result<(), CommandError> {
    if files.is_empty() {
        return Ok(());
    }
    snapshots::create_snapshot_unless(app_data_dir, execution_id, files, workspace, should_stop)
        .await
        .map(|_| ())
        .map_err(|e| {
            // A snapshot stops when `should_stop` says so (#267), and that
            // stop arrives here as an `Err` like any other — so a user who
            // pressed Cancel was told their workflow had failed to snapshot,
            // and the log recorded an I/O failure that never happened (#555).
            // The FLAG decides, not the message: `create_snapshot_unless`
            // returns a `String`, and branching on its text is exactly what
            // rule 50 forbids.
            if should_stop() {
                return CommandError::cancelled(
                    "workflow was cancelled while its snapshot was being taken",
                );
            }
            log::warn!("Refusing to run: pre-execution snapshot failed: {e}");
            localized_error!(ErrorCode::Io, "errors.workflow.snapshotFailed", detail = e)
        })
}

/// Everything between admission and the spawn (#262): the snapshot, the
/// cancel check, and the genies directory. Returns the directory the
/// runner's `genie/*` steps read from — `None` when the platform cannot
/// resolve app data, in which case genie steps report a clean error and
/// action-only workflows still run. Every `?` drops the caller's admission
/// guard, which clears the published id with the flag.
pub(super) async fn prepare_run<R: Runtime>(
    app: &AppHandle<R>,
    state: &WorkflowRunnerState,
    workflow: &RawWorkflow,
    workspace: &Path,
    execution_id: &str,
) -> Result<Option<PathBuf>, CommandError> {
    let files = snapshot_targets(workflow, workspace);
    if let Some(app_data_dir) = snapshot_root(&files, || {
        app.path().app_data_dir().map_err(|e| e.to_string())
    })? {
        let cancel = Arc::clone(&state.cancel_requested);
        let should_stop = move || cancel.load(Ordering::SeqCst);
        snapshot_or_refuse(&app_data_dir, execution_id, &files, workspace, &should_stop).await?;
    }

    // A cancel that landed during the snapshot stops the run here rather
    // than one step in (#267).
    if state.cancel_requested.load(Ordering::SeqCst) {
        return Err(CommandError::cancelled(
            "workflow was cancelled before it started",
        ));
    }

    // `None` is the documented degraded mode — a platform that cannot resolve
    // app data still runs action-only workflows, and genie steps report a clean
    // error. But the platform's REASON used to be dropped on the floor with
    // `.ok()` (audit 20260907 #556), so the later "genies directory
    // unavailable" was the only trace and named nothing. The behaviour is
    // unchanged; the cause is now recoverable.
    Ok(match app.path().app_data_dir() {
        Ok(dir) => Some(resolve_genies_dir(&dir)),
        Err(e) => {
            log::warn!(
                "[workflow] app data directory unavailable ({e}); `genie/*` steps in \
                 {execution_id} will refuse, action steps still run"
            );
            None
        }
    })
}

#[cfg(test)]
#[path = "prepare.test.rs"]
mod tests;
