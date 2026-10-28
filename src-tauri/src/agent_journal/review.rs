//! Review-side schema types: `reviewOp`, hunks, mapped spans,
//! capture-driven transitions and review-only decisions.
//!
//! Offsets are UTF-16 code units into canonical Markdown, because
//! the diff/mapping worker runs in JavaScript. Rust only validates them.
//! `reviewGen` values travel as decimal strings (`u64_wire`).

use serde::{Deserialize, Serialize};

use crate::agent_journal::hunk_id::{hunk_id, HunkIdInput, IdRange};
use crate::agent_journal::ids::{BlobHash, HunkId, RevisionId, TxnId};
use crate::agent_journal::provenance::Block;

/// The closed set of review behaviours, recorded per revision from its
/// mutation kind — never inferred from the actor. Decoded through
/// [`ReviewOpWire`], so an unknown key is refused on every variant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "op",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    from = "ReviewOpWire"
)]
pub enum ReviewOp {
    /// Agent / system content mutation: diffed into hunks.
    Review,
    /// Plain human save: recorded, no hunks.
    None,
    /// Attaches to an existing hunk (pending ↔ reverted).
    HunkRevert {
        hunk_id: HunkId,
        #[serde(with = "crate::agent_journal::u64_wire")]
        expected_review_gen: u64,
    },
    /// Creates exactly one coarse restore item.
    Restore { source: RestoreSource },
}

/// `ReviewOp` as read. `deny_unknown_fields` cannot see keys beside the
/// tag of a unit variant, so `review` and `none` decode as empty struct
/// variants here; the written shape (`{"op":"review"}`) is unchanged.
#[derive(Deserialize)]
#[serde(
    tag = "op",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum ReviewOpWire {
    Review {},
    None {},
    HunkRevert {
        hunk_id: HunkId,
        #[serde(with = "crate::agent_journal::u64_wire")]
        expected_review_gen: u64,
    },
    Restore {
        source: RestoreSource,
    },
}

impl From<ReviewOpWire> for ReviewOp {
    fn from(w: ReviewOpWire) -> Self {
        match w {
            ReviewOpWire::Review {} => Self::Review,
            ReviewOpWire::None {} => Self::None,
            ReviewOpWire::HunkRevert {
                hunk_id,
                expected_review_gen,
            } => Self::HunkRevert {
                hunk_id,
                expected_review_gen,
            },
            ReviewOpWire::Restore { source } => Self::Restore { source },
        }
    }
}

/// What a restore puts back. The plan names only `sourceRevision`; restoring
/// an `uncommitted` preimage or a legacy checkpoint has no revision, so the
/// source is a union (reported back as a plan gap).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "from",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RestoreSource {
    Revision { revision: RevisionId },
    UncommittedPreimage { txn: TxnId },
    LegacyCheckpoint { legacy_id: String },
}

/// Half-open range `[start, end)` in UTF-16 code units. On the wire it is
/// `{from, to}`, the shape the TS worker and the hunk id use. Only a
/// mapped span's range may be inverted (see `MappedSpan`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Range {
    #[serde(rename = "from")]
    pub start: u64,
    #[serde(rename = "to")]
    pub end: u64,
}

/// What kind of review item a hunk is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HunkKind {
    /// An ordinary diff hunk.
    Change,
    /// One coarse hunk because the split did not fit the free slots.
    LargeChange,
    /// One coarse hunk because the diff ran out of budget.
    TooComplex,
    /// The single item a `restore` revision creates.
    Restore,
}

/// A hunk as created. Geometry and text hashes persist with it so decisions
/// stay resolvable after the diff algorithm changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Hunk {
    pub id: HunkId,
    pub kind: HunkKind,
    pub base: Option<RevisionId>,
    pub target: RevisionId,
    pub base_range: Range,
    pub target_range: Range,
    pub base_text_hash: BlobHash,
    pub target_text_hash: BlobHash,
}

impl Hunk {
    /// The canonical hunk id (`hunk_id`). The algorithm version is
    /// deliberately not an input. Fails on a range outside `0 ≤ from ≤ to ≤
    /// 2^53−1`. A missing base (first revision) hashes as JSON `null`.
    pub fn compute_id(
        base: Option<RevisionId>,
        target: RevisionId,
        base_range: Range,
        target_range: Range,
        base_text_hash: &BlobHash,
        target_text_hash: &BlobHash,
    ) -> Result<HunkId, String> {
        let range = |r: Range| IdRange {
            from: r.start,
            to: r.end,
        };
        let input = HunkIdInput {
            base_rev: base.map(|b| b.to_string()),
            target_rev: target.to_string(),
            base_range: range(base_range),
            target_range: range(target_range),
            base_text_hash: base_text_hash.digest_hex().into(),
            target_text_hash: target_text_hash.digest_hex().into(),
        };
        hunk_id(&input).map(HunkId)
    }

    /// Whether `id` is the canonical id of the hunk's own fields.
    pub fn id_is_consistent(&self) -> bool {
        Self::compute_id(
            self.base,
            self.target,
            self.base_range,
            self.target_range,
            &self.base_text_hash,
            &self.target_text_hash,
        )
        .is_ok_and(|id| id == self.id)
    }
}

/// Review state of one hunk (the transition table).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HunkState {
    Pending,
    Kept,
    Reverted,
    Conflicted,
    Superseded,
    ResolvedByHumanEdit,
    Settled,
}

impl HunkState {
    /// `kept`, `reverted`, `superseded`, `resolvedByHumanEdit` — the states
    /// "Clear reviewed" may settle and capture never changes.
    pub fn is_decided(self) -> bool {
        matches!(
            self,
            Self::Kept | Self::Reverted | Self::Superseded | Self::ResolvedByHumanEdit
        )
    }
}

/// A hunk's span mapped into the new revision, persisted eagerly with it.
/// It moves only through certified
/// provenance (`span_map`); the writer derives it and refuses a worker span
/// that differs.
///
/// `range` is the mapping result in the new revision's UTF-16 offsets. It may
/// be inverted (`from > to`): the hunk text was deleted and re-typed, so its
/// text is unknown. Once `block` is set the range is no longer evidence of
/// anything; `last_certified` keeps the last range that was.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MappedSpan {
    pub hunk_id: HunkId,
    pub range: Range,
    /// Deletion anchor: expected text `""`, absorbs text inserted at it.
    pub growing: bool,
    /// "Edited since" — sticky span metadata; does not bump `reviewGen`.
    pub edited_since: bool,
    /// Sticky automatic-revert block: the first break that reached the
    /// span. Always present on the wire (`null` when certified).
    #[serde(deserialize_with = "crate::agent_journal::provenance::required_option")]
    pub block: Option<Block>,
    /// Display only: the span as it was last certified, in the coordinates of
    /// revision `at`. Set when `block` is first set (absent for blocks that
    /// had no certified predecessor, such as a schema-v1 history) and sticky.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_certified: Option<LastCertified>,
}

/// Where a now-blocked span last was, under certified provenance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LastCertified {
    pub at: RevisionId,
    pub range: Range,
}

/// A capture-driven transition (`superseded` or `resolvedByHumanEdit`),
/// appended atomically in the same record as the revision that causes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HunkTransition {
    pub hunk_id: HunkId,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub expected_review_gen: u64,
    pub to: HunkState,
}

/// The worker-computed review effects a revision record carries.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewEffects {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub new_hunks: Vec<Hunk>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub transitions: Vec<HunkTransition>,
    /// One span for every hunk that was non-`settled` before this record.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub spans: Vec<MappedSpan>,
    /// Diff algorithm version — metadata, never part of a hunk id.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub algorithm: String,
}

/// A review-only decision (no content change; no prepare/commit).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewAction {
    Keep,
    Unkeep,
    /// `conflicted` → `resolvedByHumanEdit` after the user edited by hand.
    MarkHandled,
    /// A refused revert, decided by the worker before any prepare.
    Conflicted,
    /// The three-way revert found the base text already in place: a
    /// user-initiated resolution with no content change (TS `revertFoundBase`).
    RevertFoundBase,
    /// "Clear reviewed": one atomic batch into `settled`.
    ClearReviewed,
}

/// One hunk named by a review-only decision, with its `reviewGen` CAS.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewItem {
    pub hunk_id: HunkId,
    #[serde(with = "crate::agent_journal::u64_wire")]
    pub expected_review_gen: u64,
}
