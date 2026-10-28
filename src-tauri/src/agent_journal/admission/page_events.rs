//! What a page's lifecycle does to the page table and the cleanup worker:
//! a page load that started, a destroyed window and a registration that
//! replaces an older one each revoke generations, then signal the worker,
//! whose pass is the controller's sweep.
//!
//! Key decisions:
//!   - These entries take the table lock and the worker's state lock, one
//!     after the other and never together, and never the writer lock: they
//!     run on the main thread, which must not wait behind an append.
//!   - The table changes before the worker is signalled, so the pass that
//!     follows sees the revocation.
//!   - A pass with no writer yet does nothing: no transaction can be owned
//!     before the writer exists.
//!   - Each entry leaves a debug trace naming its label, and a registration
//!     the identity, generation and replaced pair, so a native run can
//!     correlate a document's identity with the events Rust saw. A refusal
//!     logs only its journal code: the identity it refused is unvalidated
//!     webview text.
//!
//! @module agent_journal/admission/page_events

use crate::agent_journal::admission::cleanup_worker::{CleanupWorker, Pass};
use crate::agent_journal::admission::owned::OwnedEnd;
use crate::agent_journal::admission::page_table::{PageTable, Registration};
use crate::agent_journal::controller::Controller;
use crate::agent_journal::ids::TxnId;
use crate::agent_journal::writer::Writer;
use crate::command_error::CommandError;

/// A page load started in `label`: revoke what it held, then signal.
pub fn page_started(pages: &PageTable, worker: &CleanupWorker, label: &str, pass: Pass) {
    log::debug!("[agent_journal] page load started in {label}");
    pages.started(label);
    worker.signal(pass);
}

/// `label`'s window is gone: remove it, then signal.
pub fn page_destroyed(pages: &PageTable, worker: &CleanupWorker, label: &str, pass: Pass) {
    log::debug!("[agent_journal] window destroyed: {label}");
    pages.destroy(label);
    worker.signal(pass);
}

/// Register a page (`PageTable::register`); a registration that replaces
/// an older pair revokes it, so it signals the worker.
///
/// # Errors
/// As `PageTable::register`.
#[allow(clippy::too_many_arguments)]
pub fn register_page(
    pages: &PageTable,
    worker: &CleanupWorker,
    writer: Option<&Writer>,
    label: &str,
    page_identity: &str,
    replaces: Option<(&str, &str)>,
    pass: Pass,
) -> Result<Registration, CommandError> {
    let reg = pages
        .register(writer, label, page_identity, replaces)
        .inspect_err(|e| {
            let code = e
                .detail()
                .and_then(|d| d.get("journalCode"))
                .and_then(|c| c.as_str());
            log::debug!(
                "[agent_journal] page registration refused in {label}: {}",
                code.unwrap_or("no journal code")
            );
        })?;
    let replaced = replaces.map_or_else(String::new, |(id, gen)| {
        format!("; replaces {id} generation {gen}")
    });
    log::debug!(
        "[agent_journal] page registered in {label}: {} generation {}{replaced}",
        reg.page_identity.as_str(),
        reg.webview_generation
    );
    if replaces.is_some() {
        worker.signal(pass);
    }
    Ok(reg)
}

/// One cleanup pass: the controller's sweep, its outcomes logged.
pub fn sweep_pass(controller: Option<Controller>, pages: &PageTable) -> Vec<(TxnId, OwnedEnd)> {
    let Some(c) = controller else {
        return Vec::new();
    };
    let ended = c.sweep(pages);
    for (txn, end) in &ended {
        match end {
            OwnedEnd::Recorded | OwnedEnd::AlreadyTerminal => {}
            OwnedEnd::Queued | OwnedEnd::AlreadyQueued => {
                log::warn!(
                    "agent journal: owned transaction {} ended queued ({end:?})",
                    txn.0
                );
            }
            OwnedEnd::WriterStopped | OwnedEnd::Invariant(_) => {
                log::error!(
                    "agent journal: owned transaction {} not ended ({end:?})",
                    txn.0
                );
            }
        }
    }
    ended
}
