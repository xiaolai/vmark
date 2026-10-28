//! Creating a comment anchor from a selection.
//!
//! @module agent_journal/comment_anchor/create

use super::outline::{heading_path_at, outline};
use super::work::utf16;
use super::{
    admit_quote, AnchorError, AnchorSelection, CreatedAnchor, Mapping, OffsetHint,
    SelectionPrecision, StoredAnchor, CONTEXT_UNITS,
};
use crate::agent_journal::ids::RevisionId;

/// An anchor for `selection` in `text`, created on `revision`. An exact,
/// non-empty selection is kept as it is, its bounds moved out of a surrogate
/// pair; anything else widens to the root blocks it touches (else the next
/// block, else the last one). A quote over the size bound is refused.
pub fn create_anchor(
    text: &str,
    selection: &AnchorSelection,
    revision: RevisionId,
) -> Result<CreatedAnchor, AnchorError> {
    let units = utf16(text);
    if selection.start > selection.end || selection.end > units.len() as u64 {
        return Err(AnchorError::InvalidSelection(format!(
            "selection {}..{} is not within a text of {} UTF-16 units",
            selection.start,
            selection.end,
            units.len()
        )));
    }
    let (s, e) = (selection.start as usize, selection.end as usize);
    let outline = outline(text);
    let (start, end, mapping) = if selection.precision == SelectionPrecision::Exact && s < e {
        let start = if splits_pair(&units, s) { s - 1 } else { s };
        let end = if splits_pair(&units, e) { e + 1 } else { e };
        (start, end, Mapping::Exact)
    } else {
        let (start, end) = widen(&outline.blocks, s as u64, e as u64)?;
        (start as usize, end as usize, Mapping::Widened)
    };
    // Bounds never split a surrogate pair, so these slices are whole UTF-16.
    let quote = String::from_utf16_lossy(&units[start..end]);
    admit_quote(&quote)?;
    let mut before = start.saturating_sub(CONTEXT_UNITS);
    if splits_pair(&units, before) {
        before += 1;
    }
    let mut after = (end + CONTEXT_UNITS).min(units.len());
    if splits_pair(&units, after) {
        after -= 1;
    }
    let anchor = StoredAnchor {
        quote,
        prefix: String::from_utf16_lossy(&units[before..start]),
        suffix: String::from_utf16_lossy(&units[end..after]),
        heading_path: heading_path_at(&outline.headings, start as u64),
        hint: Some(OffsetHint {
            revision,
            offset: start as u64,
        }),
    };
    Ok(CreatedAnchor {
        anchor,
        start: start as u64,
        end: end as u64,
        mapping,
    })
}

/// True when `i` falls between the two halves of a surrogate pair.
fn splits_pair(units: &[u16], i: usize) -> bool {
    i > 0
        && i < units.len()
        && (0xD800..=0xDBFF).contains(&units[i - 1])
        && (0xDC00..=0xDFFF).contains(&units[i])
}

/// The root blocks touching `start..=end`; else the next block; else the last.
fn widen(blocks: &[(u64, u64)], start: u64, end: u64) -> Result<(u64, u64), AnchorError> {
    let mut touching = blocks.iter().filter(|(a, b)| *a <= end && *b >= start);
    if let Some(&(first, first_end)) = touching.next() {
        let last_end = touching.next_back().map_or(first_end, |&(_, b)| b);
        return Ok((first, last_end));
    }
    blocks
        .iter()
        .find(|(a, _)| *a >= end)
        .or(blocks.last())
        .copied()
        .ok_or_else(|| {
            AnchorError::InvalidSelection("the document has no block to anchor to".into())
        })
}
