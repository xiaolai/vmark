//! Deriving a revision's review effects from its provenance. Pure.
//!
//! Every non-settled hunk's span maps through the revision's window:
//! `editedSince` and `block` are sticky, and the first block records where
//! the span last was (`lastCertified`). Capture transitions follow the
//! overlap rule of the TypeScript ledger: an unblocked `pending` /
//! `conflicted` hunk whose span the window hit, or that a coarse new hunk
//! claims, is `superseded` by agent content and `resolvedByHumanEdit` by a
//! human save only when its live text is its base text. A restore or a
//! `hunkRevert` is a barrier: it never supersedes an older hunk
//! (`capture_target`). A blocked hunk is never transitioned by capture —
//! nothing is inferred across a break. The writer derives these and refuses
//! worker effects that differ; the Rust tests use them as the worker
//! stand-in. Live texts a human save must check are sliced in one pass over
//! the postimage (`utf16_slices`), not once per hunk.

use crate::agent_journal::ids::{BlobHash, HunkId, RevisionId};
use crate::agent_journal::projection::{DocState, HunkEntry};
use crate::agent_journal::provenance::Provenance;
use crate::agent_journal::review::{
    Hunk, HunkKind, HunkState, HunkTransition, LastCertified, MappedSpan, Range, ReviewOp,
};
use crate::agent_journal::review_rules::capture_target;
use crate::agent_journal::text::utf16_slices;

/// What one revision record does to the hunks that existed before it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Derived {
    /// One span per hunk non-settled before the record, in hunk-id order.
    pub spans: Vec<MappedSpan>,
    /// Capture transitions, in hunk-id order.
    pub transitions: Vec<HunkTransition>,
    /// Unblocked hunks whose own text or interior the window edited
    /// (`hit`). A `hunkRevert` that hits another hunk is refused.
    pub hit: Vec<HunkId>,
}

pub struct DeriveCtx<'a> {
    pub doc: &'a DocState,
    /// The revision the window maps from (the record's linear parent).
    pub parent: Option<RevisionId>,
    pub op: &'a ReviewOp,
    pub window: &'a Provenance,
    pub postimage: &'a str,
    /// New hunks of this record; coarse ones claim their target range.
    pub new_hunks: &'a [Hunk],
    /// An applied `hunkRevert`: the hunk and the range of the text it restored.
    pub reverted: Option<(&'a HunkId, Range)>,
}

fn to_i64(v: u64) -> Result<i64, String> {
    i64::try_from(v).map_err(|_| format!("offset {v} out of range"))
}

fn to_u64(v: i64) -> Result<u64, String> {
    u64::try_from(v).map_err(|_| format!("mapped offset {v} is negative"))
}

fn claimed(s: &MappedSpan, claims: &[Range]) -> bool {
    let (from, to) = (s.range.start, s.range.end);
    claims.iter().any(|c| {
        if s.growing {
            c.start < from && from < c.end
        } else {
            from < c.end && to > c.start
        }
    })
}

/// A capture transition still waiting for the live-text check of a human
/// save (`check`), in hunk-id order.
struct Candidate {
    transition: HunkTransition,
    check: Option<(Range, BlobHash)>,
}

pub fn derive(c: &DeriveCtx<'_>) -> Result<Derived, String> {
    let claims: Vec<Range> = c
        .new_hunks
        .iter()
        .filter(|h| {
            matches!(
                h.kind,
                HunkKind::Restore | HunkKind::LargeChange | HunkKind::TooComplex
            )
        })
        .map(|h| h.target_range)
        .collect();
    let mut out = Derived::default();
    let mut candidates = Vec::new();
    for (id, h) in c
        .doc
        .hunks
        .iter()
        .filter(|(_, h)| h.state != HunkState::Settled)
    {
        let (span, hit) = map_one(c, id, h)?;
        if hit {
            out.hit.push(id.clone());
        }
        let active = matches!(h.state, HunkState::Pending | HunkState::Conflicted);
        if active && span.block.is_none() && (hit || claimed(&span, &claims)) {
            candidates.extend(candidate(c.op, id, h, span.range));
        }
        out.spans.push(span);
    }
    out.transitions = settle_candidates(c.postimage, candidates)?;
    Ok(out)
}

/// The span of hunk `id` after this record, and whether the window hit it
/// unblocked. An applied `hunkRevert` puts its own hunk on the restored text.
fn map_one(c: &DeriveCtx<'_>, id: &HunkId, h: &HunkEntry) -> Result<(MappedSpan, bool), String> {
    let old = &h.span;
    if let Some((_, range)) = c.reverted.filter(|(r, _)| *r == id) {
        let span = MappedSpan {
            hunk_id: id.clone(),
            range,
            growing: range.start == range.end,
            edited_since: old.edited_since,
            block: None,
            last_certified: None,
        };
        return Ok((span, false));
    }
    let m = c.window.map_span(
        to_i64(old.range.start)?,
        to_i64(old.range.end)?,
        old.growing,
    )?;
    let range = Range {
        start: to_u64(m.from)?,
        end: to_u64(m.to)?,
    };
    let block = old.block.clone().or(m.block);
    let last_certified = match (&old.block, &block, c.parent) {
        (None, Some(_), Some(at)) => Some(LastCertified {
            at,
            range: old.range,
        }),
        (None, Some(_), None) => return Err("a span exists before any revision".into()),
        _ => old.last_certified,
    };
    let hit = block.is_none() && m.hit;
    let span = MappedSpan {
        hunk_id: id.clone(),
        range,
        growing: old.growing,
        edited_since: old.edited_since || m.edited,
        block,
        last_certified,
    };
    Ok((span, hit))
}

/// The capture transition `op` makes of an active hunk, if any. A human
/// save transitions only when the live text at `range` is the base text.
fn candidate(op: &ReviewOp, id: &HunkId, h: &HunkEntry, range: Range) -> Option<Candidate> {
    let to = capture_target(op, h.state)?;
    let check = matches!(op, ReviewOp::None).then(|| (range, h.hunk.base_text_hash.clone()));
    Some(Candidate {
        transition: HunkTransition {
            hunk_id: id.clone(),
            expected_review_gen: h.review_gen,
            to,
        },
        check,
    })
}

/// Keep the candidates whose live-text check holds. An empty span's live
/// text is `""`; an inverted one's is unknown (its text was deleted and
/// re-typed, `MappedSpan`), so it never matches a base.
fn settle_candidates(
    postimage: &str,
    candidates: Vec<Candidate>,
) -> Result<Vec<HunkTransition>, String> {
    let ranges: Vec<Range> = candidates
        .iter()
        .filter_map(|k| k.check.as_ref().map(|(r, _)| *r))
        .filter(|r| r.start < r.end)
        .collect();
    let mut texts = utf16_slices(postimage, &ranges)?.into_iter();
    let mut out = Vec::with_capacity(candidates.len());
    for k in candidates {
        let keep = match &k.check {
            None => true,
            Some((r, _)) if r.start > r.end => false,
            Some((r, base)) if r.start == r.end => *base == BlobHash::of_text(""),
            Some((_, base)) => {
                let here = texts.next().ok_or("live-text slice missing")?;
                BlobHash::of_text(here) == *base
            }
        };
        if keep {
            out.push(k.transition);
        }
    }
    Ok(out)
}
