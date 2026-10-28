//! The Tauri command that exports one document's journal into a Git
//! repository folder the user picked.
//!
//! Key decisions:
//!   - `async` + `spawn_blocking`: an export runs many `git` processes and
//!     must not hold the main thread or an async worker.
//!   - One export at a time (`AgentJournalState::git_exports`): the durable
//!     export record is read, then rewritten, around the ref swap.
//!   - The payload is a JSON string like every journal command:
//!     `{docKey, repository}` with an absolute folder path. The reply is
//!     bound to the caller's `callId`, checked before anything else.
//!
//! @module agent_journal/git_export/command

use serde::Deserialize;

use super::error::ExportError;
use super::export::{export_document, ExportReport};
use super::git::Git;
use super::names::branch_name;
use super::state::ExportState;
use crate::agent_journal::admission::bound::{bind_call, Bound, CallBind};
use crate::agent_journal::commands::run;
use crate::agent_journal::controller::decode;
use crate::agent_journal::refusal::refusal;
use crate::agent_journal::service::AgentJournalState;
use crate::command_error::CommandError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExportRequest {
    doc_key: String,
    repository: String,
}

/// Export the document `docKey` into the repository containing the folder
/// `repository` (`payload`: JSON `{docKey, repository}`).
///
/// # Errors
/// `detail.exportCode` names the refusal (`GIT_MISSING`, `NOT_A_REPOSITORY`,
/// `EXPORT_CONFLICT`, `UNRELATED_BRANCH`, `BRANCH_CHECKED_OUT`, …);
/// `JOURNAL_UNAVAILABLE` while the journal is not running.
#[tauri::command]
pub async fn agent_journal_git_export(
    state: tauri::State<'_, AgentJournalState>,
    payload: String,
    call_id: String,
) -> Result<Bound<CallBind, ExportReport>, CommandError> {
    bind_call(&call_id, export(&state, payload)).await
}

async fn export(state: &AgentJournalState, payload: String) -> Result<ExportReport, CommandError> {
    let dir = state.journal_dir().ok_or_else(|| state.off_refusal())?;
    let exports = state.git_exports.clone();
    run(state, move |c| {
        let req: ExportRequest = decode(&payload)?;
        let git = Git::open(&req.repository)?;
        let Some(doc) = c.docs.find(&req.doc_key).map_err(|e| refusal(&e))? else {
            return Err(ExportError::NoHistory.into());
        };
        let _one_at_a_time = exports
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let report = export_document(
            &c.writer,
            doc,
            &req.doc_key,
            &git,
            &ExportState::in_dir(&dir),
        )?;
        log::info!(
            "[agent-journal] exported {} commit(s) to {}",
            report.commits_created,
            branch_name(doc)
        );
        Ok(report)
    })
    .await
}
