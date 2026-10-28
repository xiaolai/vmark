//! The provenance accumulator and its persisted payload, shared byte for
//! byte with the TypeScript worker and pinned by
//! `src/test/fixtures/agentJournal/provenance.json`.
//!
//! A capture window's map L / R of every original gap (sequential
//! CodeMirror `mapPos` per transaction, never a composed change set), the
//! effects (characters deleted, gaps touched) and the breaks (bounded or
//! whole-document). Spans move only through it; a break that reaches
//! a span leaves a sticky `Block` on it.
//!
//! Positions are `i64` UTF-16 code units: thresholds may be −1, and every
//! wire value is ≤ 2^53−1 (`MAX_SAFE`).

mod accumulator;
mod body;
mod changed;
mod intervals;
mod payload;
mod pieces;
mod runs;

use serde::{Deserialize, Serialize};

pub use accumulator::{Provenance, SpanMapping};
pub use changed::ChangedRun;
pub use payload::{Certificate, ProvenancePayload};
pub use pieces::Section;

/// Hard memory cap in entries (TS default, and the largest a payload may declare).
pub const PROVENANCE_CAP: u64 = 16384;

/// The smallest cap: a whole-document break alone holds four entries (one
/// L piece, one R piece, one deleted and one touched interval).
pub const MIN_PROVENANCE_CAP: u64 = 4;
/// Every offset and length on the wire is at most 2^53−1.
pub const MAX_SAFE: i64 = (1 << 53) - 1;

/// Break reason codes. Any other value is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BreakReason {
    SnapshotOnly,
    WholeDocumentWrite,
    ExternalReload,
    Restore,
    UncertifiedRange,
    CapOverflow,
    UnclosedEpoch,
    ParentMismatch,
}

impl BreakReason {
    /// A whole break stands for an unmapped whole-document change; only a
    /// bounded break is an uncertified range.
    fn is_whole(self) -> bool {
        self != BreakReason::UncertifiedRange
    }
}

/// The sticky automatic-revert block a break leaves on a span — the
/// reason and what raised it. `origin` is never empty.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, try_from = "BlockWire")]
pub struct Block {
    pub reason: BreakReason,
    pub origin: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BlockWire {
    reason: BreakReason,
    origin: String,
}

impl TryFrom<BlockWire> for Block {
    type Error = String;
    fn try_from(w: BlockWire) -> Result<Self, String> {
        Block::new(w.reason, &w.origin)
    }
}

impl Block {
    pub fn new(reason: BreakReason, origin: &str) -> Result<Self, String> {
        if origin.is_empty() {
            return Err("a break needs an origin".into());
        }
        Ok(Self {
            reason,
            origin: origin.to_string(),
        })
    }
}

/// Serde helper: an `Option` field that must be present (`null` allowed).
pub fn required_option<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d)
}

#[cfg(test)]
#[path = "accumulator.test.rs"]
mod accumulator_tests;
