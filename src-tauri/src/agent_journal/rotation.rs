//! Rotation breaks for a whole-text agent write's declared script.
//!
//! The script of `document.write`, `document.transform` and
//! `workflow.apply_patch` is the operation by definition, so its own
//! hunks are exact. Where a changed run sits next to equal text, though,
//! the same texts admit the run shifted through that text ("aZ" appended
//! after "aZ" is also "Za" inserted after "a"), and which copy an older
//! hunk at that edge belongs to is a choice. Each run therefore adds one
//! bounded `uncertifiedRange` break, origin `agent:rotation`, over every
//! original gap the run can shift to without crossing a neighbouring run,
//! plus one unit on each side, widened outward to code points. It blocks
//! only older hunks: the revision's new hunks never map through their
//! own window.
//!
//! Every break is a persisted entry, so the window must still fit its cap
//! afterwards; one that does not is refused before it is persisted.

use super::FallbackReason;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::provenance::{BreakReason, ChangedRun, Provenance};

/// The tools whose certificate is a declared script.
const DECLARED_SCRIPT_TOOLS: [&str; 3] = [
    "document.write",
    "document.transform",
    "workflow.apply_patch",
];

const ORIGIN: &str = "agent:rotation";

/// Whether `tool`'s certificate is a declared script.
pub(crate) fn declares_script(tool: &str) -> bool {
    DECLARED_SCRIPT_TOOLS.contains(&tool)
}

/// Add one rotation break per run of `window`, the checked map
/// `pre → post`; `OverCap` when the window no longer fits its cap. A
/// break the window refuses is an internal inconsistency.
pub(crate) fn add_rotation_breaks(
    window: &mut Provenance,
    pre: &str,
    post: &str,
    runs: &[ChangedRun],
) -> Result<Result<(), FallbackReason>, TxnError> {
    let (a, b): (Vec<u16>, Vec<u16>) =
        (pre.encode_utf16().collect(), post.encode_utf16().collect());
    for (i, run) in runs.iter().enumerate() {
        let prev = i
            .checked_sub(1)
            .map_or((0, 0), |p| (runs[p].a.1, runs[p].b.1));
        let next = runs
            .get(i + 1)
            .map_or((len(&a), len(&b)), |n| (n.a.0, n.b.0));
        let (g0, g1) = region(&a, &b, run, prev, next);
        window
            .break_gaps(g0, g1, BreakReason::UncertifiedRange, ORIGIN)
            .map_err(TxnError::Invariant)?;
    }
    if window.entries() as u64 > window.cap() {
        return Ok(Err(FallbackReason::OverCap));
    }
    Ok(Ok(()))
}

fn len(units: &[u16]) -> i64 {
    // The texts were bounded to i64 when the certificate was checked.
    units.len() as i64
}

fn at(units: &[u16], i: i64) -> u16 {
    units[i as usize]
}

/// The original gaps `run` can rotate to, one unit wider on each side,
/// clamped to the text and widened outward to code points. `prev` ends
/// and `next` starts the equal text the run may shift through.
fn region(
    a: &[u16],
    b: &[u16],
    run: &ChangedRun,
    prev: (i64, i64),
    next: (i64, i64),
) -> (i64, i64) {
    let (mut a0, mut a1, mut b0, mut b1) = (run.a.0, run.a.1, run.b.0, run.b.1);
    // Left: the unit before the run joins it, its last unit leaves it.
    while a0 > prev.0 && b0 > prev.1 && at(a, a1 - 1) == at(b, b1 - 1) {
        (a0, a1, b0, b1) = (a0 - 1, a1 - 1, b0 - 1, b1 - 1);
    }
    let left = a0;
    (a0, a1, b0, b1) = (run.a.0, run.a.1, run.b.0, run.b.1);
    // Right: the unit after the run joins it, its first unit leaves it.
    while a1 < next.0 && b1 < next.1 && at(a, a0) == at(b, b0) {
        (a0, a1, b0, b1) = (a0 + 1, a1 + 1, b0 + 1, b1 + 1);
    }
    let right = a1;
    let g0 = (left - 1).max(0);
    let g1 = (right + 1).min(len(a));
    (snap_left(a, g0), snap_right(a, g1))
}

fn is_low(u: u16) -> bool {
    (0xDC00..=0xDFFF).contains(&u)
}

fn is_high(u: u16) -> bool {
    (0xD800..=0xDBFF).contains(&u)
}

/// Gap `g` moved left off the middle of a surrogate pair.
fn snap_left(a: &[u16], g: i64) -> i64 {
    if g > 0 && g < len(a) && is_low(at(a, g)) && is_high(at(a, g - 1)) {
        g - 1
    } else {
        g
    }
}

/// Gap `g` moved right off the middle of a surrogate pair.
fn snap_right(a: &[u16], g: i64) -> i64 {
    if g > 0 && g < len(a) && is_low(at(a, g)) && is_high(at(a, g - 1)) {
        g + 1
    } else {
        g
    }
}

#[cfg(test)]
#[path = "rotation.test.rs"]
mod tests;

#[cfg(test)]
#[path = "rotation_fuzz.test.rs"]
mod fuzz_tests;

#[cfg(test)]
#[path = "rotation_geometry.test.rs"]
mod geometry_tests;

#[cfg(test)]
#[path = "rotation_history_golden.test.rs"]
mod history_golden_tests;
