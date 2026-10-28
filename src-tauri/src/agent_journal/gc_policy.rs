//! The collector's caps and the warnings it raises (ADR-AL13), shared by
//! the planner, the writer and the startup pass's summary.
//!
//! @module agent_journal/gc_policy

use std::collections::BTreeMap;

use serde::Serialize;

use crate::agent_journal::ids::DocId;

/// ADR-AL13 retention caps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GcPolicy {
    pub max_revisions: usize,
    pub max_doc_bytes: u64,
    pub max_total_bytes: u64,
}

impl Default for GcPolicy {
    fn default() -> Self {
        Self {
            max_revisions: 500,
            max_doc_bytes: 100 * 1024 * 1024,
            max_total_bytes: 2 * 1024 * 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GcLimit {
    Revisions,
    DocBytes,
    TotalBytes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GcWarningKind {
    /// At 80% of a cap or more.
    NearCap,
    /// Over a cap with nothing unpinned left to collect.
    PinnedOverCap,
}

/// A cap warning; `doc` is `None` for the global byte cap.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GcWarning {
    pub doc: Option<DocId>,
    pub kind: GcWarningKind,
    pub limit: GcLimit,
    pub used: u64,
    pub cap: u64,
    /// What holds the retained revisions and blobs, by pin reason name
    /// (`blobRoots` for blobs only an unresolved transaction, a pending
    /// observation, a legacy checkpoint or the degraded queue roots).
    pub pinned_by: BTreeMap<String, usize>,
}
