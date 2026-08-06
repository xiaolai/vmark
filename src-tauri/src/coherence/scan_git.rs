//! The git-classification phase of a workspace scan (R18: classify before
//! touching content).
//!
//! Split from `scan.rs` for the file-size gate, on a real seam rather than an
//! arbitrary line: this phase decides whether the scan may proceed AT ALL, and
//! two of its three outcomes stop the scan outright. Keeping that decision in
//! one named function makes "when does a scan refuse to reconcile?" answerable
//! without reading the content walk.
//!
//! @coordinates-with scan.rs — the module this was split from
//! @coordinates-with gitops.rs — observe/classify, the inputs to this decision
//! @module coherence/scan_git

use serde_json::json;

use super::gitops::{classify, GitClass, GitObservation};
use super::scan_report::ScanReport;
use super::state::WorkspaceKernel;
use super::types::Envelope;

/// How a scan learns the workspace's git state (WI-4.1).
///
/// A seam, not indirection for its own sake: the `ObservationUnreliable` branch
/// below fires only when `git` FAILS to resolve a HEAD it previously could — a
/// transient condition that cannot be provoked from a healthy repository, so
/// without an injection point that branch is unreachable from a test. It guards
/// against minting a spurious external-edit revision (#1207), exactly the kind
/// of silent, data-shaped bug a regression test has to hold down.
pub(super) type GitObserver = fn(&std::path::Path) -> Option<GitObservation>;

/// Whether the scan may continue into content reconciliation.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum GitPhase {
    /// Stop and return the report as-is — the reason is already recorded on it.
    Stop,
    /// Proceed, carrying both the classification and the observation forward.
    ///
    /// The content walk needs `class` to tell a git mutation apart from a
    /// genuine external edit, and the scan stores `observation` as the next
    /// scan's baseline — but only on this path. That asymmetry is the #1207
    /// guard: `Stop` for an unreliable read deliberately does NOT hand the
    /// observation back, so the bad reading can never become the baseline.
    Continue {
        class: GitClass,
        observation: Option<GitObservation>,
    },
}

/// Classify the workspace's git state and decide whether reconciliation is safe.
pub(super) fn run_git_phase(
    kernel: &mut WorkspaceKernel,
    report: &mut ScanReport,
    observe_git: GitObserver,
) -> Result<GitPhase, String> {
    let current_git = observe_git(kernel.root());
    let class = classify(kernel.last_git.as_ref(), current_git.as_ref());

    if class == GitClass::MergeInProgress {
        // Defer: reconcile once the merge concludes.
        kernel.last_git = current_git;
        report.merge_deferred = true;
        return Ok(GitPhase::Stop);
    }

    if class == GitClass::ObservationUnreliable {
        // A repository that HAD a resolvable HEAD now reports none, so the
        // `git` read failed rather than the repo changing. Reconciling on it
        // would mint a spurious external-edit revision for what is really a
        // git mutation (#1207). Return WITHOUT storing the bad observation, so
        // the next scan compares against the same good baseline and reconciles
        // normally — a transient failure costs one cycle.
        //
        // Note the asymmetry with MergeInProgress above, which DOES store its
        // observation: a merge is a real state the repo is in, whereas this is
        // a reading we do not believe.
        report.git_observation_unreliable = true;
        return Ok(GitPhase::Stop);
    }

    if let GitClass::Navigation { op, from, to } = &class {
        if kernel.is_initialized() {
            let env = Envelope::create(
                "navigation",
                kernel.writer(),
                json!({ "git": { "op": op, "from": from, "to": to } }),
            );
            kernel.append_and_apply(&env)?;
            report.navigations += 1;
        }
    }

    Ok(GitPhase::Continue {
        class,
        observation: current_git,
    })
}
