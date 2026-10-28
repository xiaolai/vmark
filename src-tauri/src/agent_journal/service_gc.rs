//! The startup retention pass (ADR-AL13).
//!
//! Startup runs the collector once under the default caps, after the
//! legacy import (pruning deleted comment threads), and keeps a summary for the status: how many revisions
//! were tombstoned, every cap warning (at 80% of a cap, or over it with
//! only pinned records left), why the pass deferred, and why it could not
//! run. Each warning is logged, so a journal held over its cap by pins is
//! visible without the webview. A pass that cannot run (a corrupt or
//! degraded journal, an unreadable file) is an error in the summary, never
//! a startup failure: the journal still serves without collecting. A pass
//! that finds the journal corrupt (a reachable text the pack lost) leaves
//! the writer refusing writes as `JOURNAL_CORRUPT` until it is reopened.
//!
//! @module agent_journal/service_gc

use serde::Serialize;

use crate::agent_journal::writer::Writer;
use crate::agent_journal::writer_gc::{GcPolicy, GcWarning};

/// What the startup pass did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GcSummary {
    pub collected: usize,
    pub warnings: Vec<GcWarning>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deferred: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob_error: Option<String>,
    /// The pass could not run, as `CODE: message`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Run one collection under `policy`, log it and summarize it.
pub fn startup_gc(writer: &Writer, policy: &GcPolicy) -> GcSummary {
    let report = match writer.collect_startup(policy) {
        Ok(report) => report,
        Err(e) => {
            let error = format!("{}: {e}", e.code());
            log::warn!("agent journal: retention pass did not run: {error}");
            return GcSummary {
                error: Some(error),
                ..GcSummary::default()
            };
        }
    };
    for w in &report.warnings {
        log::warn!(
            "agent journal: retention {:?} {:?} for {:?}: {} of {} (pinned by {:?})",
            w.kind,
            w.limit,
            w.doc,
            w.used,
            w.cap,
            w.pinned_by
        );
    }
    if let Some(why) = &report.deferred {
        log::info!("agent journal: retention pass deferred: {why}");
    }
    if let Some(e) = &report.blob_error {
        log::warn!("agent journal: retention pass left unreferenced blobs: {e}");
    }
    if !report.collected.is_empty() {
        log::info!(
            "agent journal: retention pass collected {} revision(s)",
            report.collected.len()
        );
    }
    GcSummary {
        collected: report.collected.len(),
        warnings: report.warnings,
        deferred: report.deferred,
        blob_error: report.blob_error,
        error: None,
    }
}
