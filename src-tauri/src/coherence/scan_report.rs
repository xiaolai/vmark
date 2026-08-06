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
    /// Set when the ledger holds entries in a format this build cannot parse,
    /// so reconciliation was refused (WI-2.2).
    ///
    /// The scan still RETURNS rather than erroring, and that is the point: the
    /// READ surfaces run a scan first — `perform_breakdown_in` sits behind both
    /// `coherence_breakdown` and `coherence_status` — so propagating the
    /// refusal turned "the breakdown is missing whatever the newer build wrote"
    /// into "the breakdown panel is dead". The remedy (upgrade VMark) has to
    /// stay reachable from an app that still opens.
    ///
    /// Declining to reconcile is already a first-class scan outcome; this is the
    /// third member of the family alongside `merge_deferred` and
    /// `git_observation_unreliable`. Nothing was reconciled, so `complete` is
    /// false and no deletion is inferred from history that was not read. Writes
    /// are unaffected — they take the lock directly and still get the refusal.
    pub ledger_short_read: bool,
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
