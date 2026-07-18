//! Edge-state projection (pure — ADR-C4). Spec §9.2: every displayed
//! state is a projection over (origin edge, resolution records, viewing
//! context) — nothing here mutates anything (I5).

use uuid::Uuid;

use super::dag::{resolve, ContextView, Resolved, RevisionDag};
use super::types::{InputRole, ObjectId, RevisionId};

/// One origin edge: transformation `txf` read `upstream@pinned` while
/// producing `downstream@downstream_rev`. Immutable historical fact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OriginEdge {
    pub txf: Uuid,
    pub input: u32,
    pub upstream: ObjectId,
    pub pinned: RevisionId,
    pub downstream: ObjectId,
    pub downstream_rev: RevisionId,
    pub role: InputRole,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolutionKind {
    Ratification,
    Waiver,
}

/// A resolution record already matched to one edge (ledger §5.4.3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EdgeResolution {
    pub kind: ResolutionKind,
    pub resolved_against: RevisionId,
    pub time: String,
    pub id: Uuid,
    pub expires: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckVerdict {
    NoContradiction,
    Contradiction,
    Unknown,
}

/// A semantic-check result matched to one edge (ledger §5.4.4; written
/// from Phase 2b, projected here so the state machine is complete now).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EdgeCheck {
    pub pinned: RevisionId,
    pub checked_against: RevisionId,
    pub verdict: CheckVerdict,
    pub time: String,
    pub id: Uuid,
}

/// Spec §6.2 / §9.2 display states.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EdgeState {
    Fresh { ratified: bool, ahead: bool },
    /// Version-stale, no applicable check result yet.
    VersionStale,
    StaleValid,
    StaleContradicted,
    StaleUnknown,
    Waived,
    /// `multi_head`: live selection over a multi-head upstream (no single
    /// `resolved_against` exists — accept-newer and waive are disabled).
    Diverged { multi_head: bool },
    /// Context pins a revision the upstream never had — surfaced, never
    /// guessed.
    Unpinnable,
}

fn parse_time(t: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(t).ok()
}

/// Latest applicable record wins: max (time, id); unparseable times are
/// skipped defensively (they would have been quarantined upstream).
fn latest_resolution<'a>(
    records: &'a [EdgeResolution],
    against: &RevisionId,
) -> Option<&'a EdgeResolution> {
    records
        .iter()
        .filter(|r| &r.resolved_against == against)
        .filter_map(|r| parse_time(&r.time).map(|t| (t, r.id, r)))
        .max_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)))
        .map(|(_, _, r)| r)
}

fn latest_check<'a>(
    checks: &'a [EdgeCheck],
    pinned: &RevisionId,
    against: &RevisionId,
) -> Option<&'a EdgeCheck> {
    checks
        .iter()
        .filter(|c| &c.pinned == pinned && &c.checked_against == against)
        .filter_map(|c| parse_time(&c.time).map(|t| (t, c.id, c)))
        .max_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)))
        .map(|(_, _, c)| c)
}

fn waiver_active(r: &EdgeResolution, now: &str) -> bool {
    match (&r.expires, parse_time(now)) {
        (Some(exp), Some(now_t)) => parse_time(exp).is_none_or(|e| e > now_t),
        (Some(_), None) => false,
        (None, _) => true,
    }
}

/// Project one edge in one context (spec §9.2). `None` means the edge is
/// not live in this context: contextual role (provenance, not an edge) or
/// a superseded downstream revision (retired — the *revise* resolution).
pub fn project_edge(
    edge: &OriginEdge,
    ctx: &ContextView,
    dag: &RevisionDag,
    resolutions: &[EdgeResolution],
    checks: &[EdgeCheck],
    now: &str,
) -> Option<EdgeState> {
    if edge.role != InputRole::Direct {
        return None;
    }
    // Liveness: the edge belongs to the downstream revision this context
    // actually selects (multi-head live downstream: any head qualifies).
    match resolve(ctx, dag, &edge.downstream) {
        Resolved::Single(r) if r == edge.downstream_rev => {}
        Resolved::DivergedHeads
            if dag.heads(&edge.downstream).contains(&edge.downstream_rev) => {}
        _ => return None,
    }

    let sel = match resolve(ctx, dag, &edge.upstream) {
        Resolved::Single(r) => r,
        Resolved::DivergedHeads => return Some(EdgeState::Diverged { multi_head: true }),
        Resolved::UnknownPin | Resolved::Absent => return Some(EdgeState::Unpinnable),
    };

    if let Some(r) = latest_resolution(resolutions, &sel) {
        match r.kind {
            ResolutionKind::Ratification => {
                return Some(EdgeState::Fresh { ratified: true, ahead: false })
            }
            ResolutionKind::Waiver if waiver_active(r, now) => return Some(EdgeState::Waived),
            ResolutionKind::Waiver => {} // expired — fall through to axis 1
        }
    }

    if edge.pinned == sel {
        return Some(EdgeState::Fresh { ratified: false, ahead: false });
    }
    if dag.is_ancestor(&edge.upstream, &edge.pinned, &sel) {
        return Some(match latest_check(checks, &edge.pinned, &sel).map(|c| c.verdict) {
            Some(CheckVerdict::NoContradiction) => EdgeState::StaleValid,
            Some(CheckVerdict::Contradiction) => EdgeState::StaleContradicted,
            Some(CheckVerdict::Unknown) => EdgeState::StaleUnknown,
            None => EdgeState::VersionStale,
        });
    }
    if dag.is_ancestor(&edge.upstream, &sel, &edge.pinned) {
        return Some(EdgeState::Fresh { ratified: false, ahead: true });
    }
    Some(EdgeState::Diverged { multi_head: false })
}

#[cfg(test)]
#[path = "project.test.rs"]
mod tests;
