//! The revert decision, shared with the TypeScript worker's `revertHunk`,
//! in order:
//!
//! 1. the span carries a `block` → `AMBIGUOUS_REVERT`;
//! 2. it is a deletion anchor sharing its offset with another revertable
//!    anchor → `AMBIGUOUS_REVERT` (no block: offsets alone cannot order them);
//! 3. inverted → conflicted; 4. base text in place → found base;
//! 5. a normal span whose text is not the target → conflicted; 6. applied.
//!
//! `gate` (steps 1–2) runs before `prepare` reserves anything and before a
//! revert-derived decision is recorded, so a refusal changes nothing.
//! `decide` (steps 3–6) is pure over the head text.

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::HunkId;
use crate::agent_journal::projection::DocState;
use crate::agent_journal::review::{HunkState, MappedSpan, Range};

/// Steps 1–2 for hunk `id` of `d`. An unknown hunk passes (the caller's CAS
/// reports it).
pub fn gate(d: &DocState, id: &HunkId) -> Result<(), TxnError> {
    let Some(h) = d.hunks.get(id) else {
        return Ok(());
    };
    let s = &h.span;
    if let Some(block) = &s.block {
        return Err(TxnError::AmbiguousRevert {
            hunk: id.clone(),
            block: Some(block.clone()),
        });
    }
    let revertable = |st: HunkState| {
        matches!(
            st,
            HunkState::Pending | HunkState::Conflicted | HunkState::Reverted
        )
    };
    let collides = s.growing
        && d.hunks.iter().any(|(o, e)| {
            o != id && revertable(e.state) && e.span.growing && e.span.range.start == s.range.start
        });
    if collides {
        return Err(TxnError::AmbiguousRevert {
            hunk: id.clone(),
            block: None,
        });
    }
    Ok(())
}

/// Steps 3–6.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RevertDecision {
    /// Replace `[from, to)` of the current text with the live base text;
    /// the restored text then occupies `restored`.
    Apply {
        from: u64,
        to: u64,
        restored: Range,
        postimage: String,
    },
    FoundBase,
    Conflicted,
}

fn offset(v: u64) -> Result<usize, String> {
    usize::try_from(v).map_err(|_| format!("span offset {v} does not fit this platform"))
}

/// `p` sits between a high and a low surrogate of `units`.
fn splits_pair(units: &[u16], p: usize) -> bool {
    p > 0
        && p < units.len()
        && (0xD800..=0xDBFF).contains(&units[p - 1])
        && (0xDC00..=0xDFFF).contains(&units[p])
}

/// `live_base` / `live_target` are already swapped for a revert of a revert.
/// `Err` is geometry that cannot belong to `current` — a writer invariant.
pub fn decide(
    span: &MappedSpan,
    live_base: &str,
    live_target: &str,
    current: &str,
) -> Result<RevertDecision, String> {
    let cur: Vec<u16> = current.encode_utf16().collect();
    let (from, to) = (offset(span.range.start)?, offset(span.range.end)?);
    if from.max(to) > cur.len() {
        return Err(format!(
            "span [{from}, {to}) outside the text ({} units)",
            cur.len()
        ));
    }
    for p in [from, to] {
        if splits_pair(&cur, p) {
            return Err(format!("span offset {p} falls inside a surrogate pair"));
        }
    }
    if from > to {
        return Ok(RevertDecision::Conflicted);
    }
    let units = |s: &str| s.encode_utf16().collect::<Vec<u16>>();
    let (base, target) = (units(live_base), units(live_target));
    let here = &cur[from..to];
    if here == base.as_slice() {
        return Ok(RevertDecision::FoundBase);
    }
    if !span.growing && here != target.as_slice() {
        return Ok(RevertDecision::Conflicted);
    }
    let end = if span.growing { from } else { to };
    let mut next = Vec::with_capacity(cur.len() + base.len());
    next.extend_from_slice(&cur[..from]);
    next.extend_from_slice(&base);
    next.extend_from_slice(&cur[end..]);
    let postimage =
        String::from_utf16(&next).map_err(|_| "revert would split a surrogate pair".to_string())?;
    let restored = Range {
        start: from as u64,
        end: (from + base.len()) as u64,
    };
    Ok(RevertDecision::Apply {
        from: from as u64,
        to: end as u64,
        restored,
        postimage,
    })
}

#[cfg(test)]
#[path = "revert_gate.test.rs"]
mod tests;
