//! The per-scan report: what a workspace scan observed and appended.
//!
//! Split out of `scan.rs` for size. A pure data record with no scanning logic,
//! which is what makes it the cheapest thing to move out.
//!
//! @coordinates-with scan.rs — the module this was split from
//! @module coherence/scan_report

#[derive(Debug, Default, PartialEq, serde::Serialize)]
pub struct ScanReport {
    pub navigations: usize,
    pub git_mutations: usize,
    pub external_edits: usize,
    /// Set when the git observation could not be trusted and reconciliation
    /// was deferred to the next scan (#1207).
    pub git_observation_unreliable: bool,
    pub adopted: usize,
    pub absent_marked: usize,
    pub diagnostics: usize,
    pub merge_deferred: bool,
    /// D3.3: completed-merge diagnostics appended this scan (deduped by
    /// merge commit SHA across repeated scans).
    pub merges: usize,
    /// False when the walk was truncated or a directory was unreadable —
    /// deletion reconciliation was skipped for safety.
    pub complete: bool,
}
