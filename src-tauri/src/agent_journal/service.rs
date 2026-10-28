//! The app's one journal: opened at startup, shared by every window.
//!
//! Purpose: own where the journal lives and how it starts. Startup runs on
//! its own thread — recovery replays the whole journal and the legacy import
//! fsyncs once per new checkpoint, and neither may hold up the first window.
//!
//! Key decisions:
//!   - `<appData>/agent-journal/`, owner-only. Under the app-data directory
//!     of the running identifier, so a dev build (`app.vmark.dev`) has its
//!     own journal; never beside a user's document.
//!   - The outcome is set once. A failed open leaves no writer at all — the
//!     journal is off for the session and the status says why — rather than
//!     a writer over a history it could not read. A journal a newer build
//!     wrote is off the same way, for every document (`service_off`).
//!   - A failed legacy import does not stop the journal: the original log is
//!     untouched, the next start retries, and the status carries the error.
//!   - A verified import retires the log (`retire_legacy`): moved aside, never
//!     rewritten; unverified or failed, it stays where it is.
//!   - Startup then runs one retention pass (`service_gc`); its summary,
//!     warnings included, is in the status. A pass that cannot run is
//!     reported there and does not stop the journal.
//!   - Document identity becomes durable when startup finishes: the
//!     registry attaches its index in the journal's directory
//!     (`service_identity`). An index that cannot be used (incompatible,
//!     unreadable, or failing to open) disables identity (its operations
//!     refuse; saving continues). The status says so, and why.
//!
//! @module agent_journal/service

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;

use crate::agent_journal::admission::cleanup_worker::CleanupWorker;
use crate::agent_journal::admission::page_table::PageTable;
use crate::agent_journal::capture::{docs_with_pending, linearize_all_pending};
use crate::agent_journal::controller::Controller;
use crate::agent_journal::degraded_drain::DrainScheduler;
use crate::agent_journal::doc_registry::DocRegistry;
use crate::agent_journal::generation_events::{LiveUpdates, LiveUpdatesCell};
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::legacy_import::{
    import_legacy_file, LegacyImportReport, LEGACY_CHECKPOINT_FILE,
};
use crate::agent_journal::service_gc::{startup_gc, GcSummary};
use crate::agent_journal::service_identity::IdentityMode;
pub use crate::agent_journal::service_legacy::{retire_legacy, LegacyRetirement};
use crate::agent_journal::writer::{OpenReport, Writer, WriterConfig};
use crate::agent_journal::writer_gc::GcPolicy;

/// The journal's directory under the app-data directory.
pub const JOURNAL_DIR: &str = "agent-journal";

/// A journal that opened, with what its startup found.
pub struct Started {
    pub writer: Arc<Writer>,
    /// Where the journal lives; the identity index sits beside it.
    pub journal_dir: PathBuf,
    pub open: OpenReport,
    /// The legacy import's report, or its error as `CODE: message`.
    pub legacy: Result<LegacyImportReport, String>,
    /// What became of the legacy log after the import.
    pub retirement: LegacyRetirement,
    /// The startup retention pass (`service_gc`).
    pub gc: GcSummary,
}

/// Open (creating) the journal under `app_data`, then import the legacy
/// checkpoint log beside it.
///
/// # Errors
/// `CODE: message` when the directory cannot be prepared or the journal
/// cannot be recovered; typed when a newer build wrote it (`service_off`).
pub fn start(app_data: &Path) -> Result<Started, StartFailure> {
    let dir = app_data.join(JOURNAL_DIR);
    startup::private_dir(&dir).map_err(|e| StartFailure::open(&e.into()))?;
    let cfg = WriterConfig {
        dir: dir.clone(),
        sync: SyncPolicy::Full,
        faults: Arc::default(),
    };
    let (writer, open) = Writer::open(cfg).map_err(|e| StartFailure::open(&e))?;
    // Saves captured before a crash, still pending, land in order now.
    let linearized = linearize_all_pending(&writer);
    if linearized > 0 {
        log::info!("agent journal: linearized {linearized} pending save(s) at startup");
    }
    let legacy_path = app_data.join(LEGACY_CHECKPOINT_FILE);
    let legacy =
        import_legacy_file(&writer, &legacy_path).map_err(|e| format!("{}: {e}", e.code()));
    // No frontend writes the log any more (checkpoints go to the journal),
    // so a verified import is the whole file.
    let retirement = retire_legacy(&legacy_path, &legacy);
    let gc = startup_gc(&writer, &GcPolicy::default());
    Ok(Started {
        writer: Arc::new(writer),
        journal_dir: dir,
        open,
        legacy,
        retirement,
        gc,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Starting,
    Ready,
    Failed,
}

/// What the journal is doing, for the webview and for diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentJournalStatus {
    pub phase: Phase,
    /// Decimal string: generations cross into JavaScript as strings.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation: Option<String>,
    /// Written by a newer build: the journal is off (phase `failed`).
    pub read_only: bool,
    /// An ambiguous write failure stopped controlled mutations until
    /// restart, or a document's degraded queue holds a record not yet durable.
    pub degraded: bool,
    /// Whether changes reach the windows as events (`generation_events`);
    /// independent of the writer's health.
    pub live_updates: LiveUpdates,
    pub truncated_tail_bytes: u64,
    pub uncommitted_at_start: usize,
    /// Selection certificates that fell back to a barrier since open.
    pub uncertified_fallbacks: u64,
    /// The writer's per-open name, which every framed request must carry.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub incarnation: Option<String>,
    /// Page registrations refused at the per-label cap since launch.
    pub registration_cap_refusals: u64,
    /// Cleanup-worker runs lost to a failed start or a panic since launch.
    pub cleanup_worker_failures: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legacy: Option<LegacyImportReport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retirement: Option<LegacyRetirement>,
    /// How document identity is held (`service_identity`).
    pub identity: IdentityMode,
    /// Why identity is disabled.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gc: Option<GcSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Managed state: empty until the startup thread finishes. The document
/// registry and the drainers live as long as the app, beside the writer.
#[derive(Default)]
pub struct AgentJournalState {
    /// Taken by the first `finish`, before the outcome is published.
    finishing: OnceLock<()>,
    outcome: OnceLock<Result<Started, StartFailure>>,
    pub(super) docs: Arc<DocRegistry>,
    /// The identity index's attach: `Err` (why) when identity is disabled.
    pub(super) identity: OnceLock<Result<(), String>>,
    drains: Arc<DrainScheduler>,
    /// Held for the whole of a Git export: its record of exported tips is
    /// read, then rewritten, around the ref swap.
    pub(super) git_exports: Arc<Mutex<()>>,
    /// Set by the generation-event forwarder (`generation_events`).
    live_updates: Arc<LiveUpdatesCell>,
    /// Live webview pages, and the worker that sweeps after revocations;
    /// process-wide, so they outlive no writer.
    pages: Arc<PageTable>,
    pub(super) cleanup: Arc<CleanupWorker>,
}

impl AgentJournalState {
    /// Record the startup outcome. Only the first call counts. The identity
    /// index attaches before the outcome is visible: a key resolved the
    /// moment the controller exists must get its durable document, never a
    /// session one the attach then discards. Documents whose pending saves
    /// startup could not linearize go to the background retry.
    pub fn finish(&self, outcome: Result<Started, StartFailure>) {
        if self.finishing.set(()).is_err() {
            return;
        }
        if let Ok(started) = &outcome {
            self.attach_identity(&started.journal_dir);
        }
        if self.outcome.set(outcome).is_err() {
            return;
        }
        if let Some(writer) = self.writer() {
            for doc in docs_with_pending(&writer) {
                self.drains.ensure(writer.clone(), doc);
            }
        }
    }

    /// The shared writer, once the journal is ready.
    pub fn writer(&self) -> Option<Arc<Writer>> {
        match self.outcome.get() {
            Some(Ok(started)) => Some(started.writer.clone()),
            _ => None,
        }
    }

    /// The journal's directory, once the journal is ready (the Git export
    /// keeps its record of exported branch tips beside the journal).
    pub fn journal_dir(&self) -> Option<PathBuf> {
        match self.outcome.get() {
            Some(Ok(started)) => Some(started.journal_dir.clone()),
            _ => None,
        }
    }

    /// The controlled-write entry, once the journal is ready.
    pub fn controller(&self) -> Option<Controller> {
        self.writer()
            .map(|w| Controller::new(w, self.docs.clone(), self.drains.clone()))
    }

    /// The process's page registrations.
    pub fn pages(&self) -> &Arc<PageTable> {
        &self.pages
    }

    /// The forwarder's live-update state, which it marks itself.
    pub fn live_updates(&self) -> &Arc<LiveUpdatesCell> {
        &self.live_updates
    }

    pub fn status(&self) -> AgentJournalStatus {
        let (identity, identity_error) = self.identity_status();
        let mut status = AgentJournalStatus {
            phase: Phase::Starting,
            generation: None,
            read_only: false,
            degraded: false,
            live_updates: self.live_updates.get(),
            truncated_tail_bytes: 0,
            uncommitted_at_start: 0,
            uncertified_fallbacks: 0,
            incarnation: None,
            registration_cap_refusals: self.pages.registration_cap_refusals(),
            cleanup_worker_failures: self.cleanup.failures(),
            legacy: None,
            retirement: None,
            identity,
            identity_error,
            gc: None,
            error: None,
        };
        match self.outcome.get() {
            None => {}
            Some(Err(e)) => {
                status.phase = Phase::Failed;
                // No writer, so no forwarder: nothing will ever be live.
                status.live_updates = LiveUpdates::Failed;
                status.error = Some(e.message().to_string());
                status.read_only = e.is_future_format();
            }
            Some(Ok(s)) => {
                status.phase = Phase::Ready;
                let (generation, degraded, fallbacks) = s.writer.status_facts();
                status.generation = Some(generation.to_string());
                status.degraded = degraded;
                status.truncated_tail_bytes = s.open.truncated_tail_bytes;
                status.uncommitted_at_start = s.open.uncommitted.len();
                status.uncertified_fallbacks = fallbacks;
                status.incarnation = Some(s.writer.incarnation().to_string());
                status.retirement = Some(s.retirement.clone());
                status.gc = Some(s.gc.clone());
                match &s.legacy {
                    Ok(report) => status.legacy = Some(report.clone()),
                    Err(e) => status.error = Some(e.clone()),
                }
            }
        }
        status
    }
}

#[path = "service_windows.rs"]
mod windows;
pub use windows::{
    page_load_started, register_window_page, release_window_label, reopen_window_label,
};
#[path = "service_off.rs"]
mod off;
pub use off::StartFailure;
#[path = "service_startup.rs"]
mod startup;
pub use startup::spawn_startup;
