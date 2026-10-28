//! The app windows' lifecycle, as the journal sees it.
//!
//! A destroyed app window releases every base root its documents held and
//! tombstones its label, so a capture still in flight cannot pin a stale
//! base. A label can be built again (`main` is a fixed label the app
//! rebuilds), so a live window under the label keeps it open whichever of
//! the release and the rebuild runs first. Both are no-ops until the
//! journal is ready.
//!
//! A page load that started, and a destroyed window, also revoke the
//! label's page registrations (`page_events`) — from launch, not only once
//! the journal is ready, because the page table exists from the start. The
//! cleanup worker's pass then sweeps what the revoked pages owned. Neither
//! takes the writer lock for the revocation, and the table update finishes
//! before the destroy's writer call begins.

use std::sync::Arc;

use tauri::Manager;

use super::AgentJournalState;
use crate::agent_journal::admission::cleanup_worker::Pass;
use crate::agent_journal::admission::page_events::{
    page_destroyed, page_started, register_page, sweep_pass,
};
use crate::agent_journal::admission::page_table::Registration;
use crate::agent_journal::writer::Writer;
use crate::command_error::CommandError;

fn writer<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<std::sync::Arc<Writer>> {
    app.try_state::<AgentJournalState>()
        .and_then(|s| s.writer())
}

/// The app window `label` was destroyed: release the journal base roots
/// its documents held (`Writer::release_window_label`), then attribute any
/// unpinned overflow to the windows still open
/// (`Writer::reconcile_live_windows`). No-op until ready.
///
/// Tauri drops the destroyed window from the app before the `Destroyed`
/// handler runs, so a window found under `label` here is a rebuild that
/// was built first: its label is reopened at once, or every base it
/// registers would be refused and left collectable. Such a window cannot
/// have registered a base yet (its page runs only after the main thread
/// returns to the event loop), so releasing the label's names takes none
/// of its own.
pub fn release_window_label<R: tauri::Runtime>(app: &tauri::AppHandle<R>, label: &str) {
    if let Some(state) = app.try_state::<AgentJournalState>() {
        page_destroyed(&state.pages, &state.cleanup, label, cleanup_pass(app));
    }
    if let Some(writer) = writer(app) {
        let rebuilt = app.get_webview_window(label).is_some();
        writer.release_window_label(label);
        if rebuilt {
            writer.reopen_window_label(label);
        }
        let live = app
            .webview_windows()
            .into_keys()
            .filter(|l| rebuilt || l != label)
            .collect();
        writer.reconcile_live_windows(&live);
    }
}

/// The app window `label` is about to be built again: let its new
/// documents register base roots (`Writer::reopen_window_label`). Takes
/// the writer lock and does no I/O. No-op until ready.
pub fn reopen_window_label<R: tauri::Runtime>(app: &tauri::AppHandle<R>, label: &str) {
    if let Some(writer) = writer(app) {
        writer.reopen_window_label(label);
    }
}

/// A page load started in `label`'s webview: revoke its registrations and
/// signal the cleanup worker. Runs on the main thread from the page-load
/// hook; takes the page table's lock and the worker's, never the writer's.
pub fn page_load_started<R: tauri::Runtime>(app: &tauri::AppHandle<R>, label: &str) {
    if let Some(state) = app.try_state::<AgentJournalState>() {
        page_started(&state.pages, &state.cleanup, label, cleanup_pass(app));
    }
}

/// Register `page_identity` for the page in `label`'s webview, replacing
/// the caller's own pair `replaces` when given; a replacement signals the
/// cleanup worker. Takes the page table's lock and the worker's, never the
/// writer's.
///
/// # Errors
/// The journal's off refusal (`JOURNAL_UNAVAILABLE`, or
/// `JOURNAL_FUTURE_FORMAT`) before anything is minted while no writer is
/// open; `PageTable::register`'s refusals otherwise.
pub fn register_window_page<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
    page_identity: &str,
    replaces: Option<(&str, &str)>,
) -> Result<Registration, CommandError> {
    let state = app.state::<AgentJournalState>();
    let writer = state.writer().ok_or_else(|| state.off_refusal())?;
    register_page(
        &state.pages,
        &state.cleanup,
        Some(&writer),
        label,
        page_identity,
        replaces,
        cleanup_pass(app),
    )
}

/// The worker's pass: the sweep over the app's journal, once ready.
fn cleanup_pass<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Pass {
    let app = app.clone();
    Arc::new(move || {
        if let Some(state) = app.try_state::<AgentJournalState>() {
            sweep_pass(state.controller(), &state.pages);
        }
    })
}

#[cfg(test)]
#[path = "page_traces.test.rs"]
mod page_traces_tests;
#[cfg(all(test, not(target_os = "windows")))]
#[path = "service_pages.test.rs"]
mod service_pages_tests;
