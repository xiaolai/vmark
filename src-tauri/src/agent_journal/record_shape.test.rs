//! Unknown fields are corruption at every nesting level of a record: a
//! field this build does not know would otherwise be dropped by the next
//! rewrite. Covers the review wire types (`reviewOp`, restore sources,
//! ranges, hunks, transitions, effects, decision items) and every
//! `observedParent` variant, and every actor and principal, including the
//! unit-like ones (`genesis`, `review`, `none`, `human`, `legacy`,
//! `anonymous`, …) whose extra keys serde would otherwise ignore.

use serde_json::{json, Value};

use crate::agent_journal::actor::{Actor, Principal};
use crate::agent_journal::codec::{self, Decoded};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{BlobHash, ConnectionId, DocId, HunkId, RevisionId, TxnId};
use crate::agent_journal::record::{Envelope, ObservedRef, Record, SCHEMA_VERSION};
use crate::agent_journal::review::{
    Hunk, HunkKind, HunkState, HunkTransition, MappedSpan, Range, RestoreSource, ReviewAction,
    ReviewEffects, ReviewItem, ReviewOp,
};

fn env(record: Record) -> Envelope {
    Envelope {
        schema_version: SCHEMA_VERSION,
        seq: 7,
        txn: TxnId::new(),
        at: 1,
        record,
        receipt: None,
    }
}

fn range(start: u64, end: u64) -> Range {
    Range { start, end }
}

fn hunk() -> Hunk {
    Hunk {
        id: HunkId("h".into()),
        kind: HunkKind::Change,
        base: None,
        target: RevisionId::new(),
        base_range: range(0, 1),
        target_range: range(0, 2),
        base_text_hash: BlobHash::of_text("a"),
        target_text_hash: BlobHash::of_text("bb"),
    }
}

fn transition() -> HunkTransition {
    HunkTransition {
        hunk_id: HunkId("h".into()),
        expected_review_gen: 0,
        to: HunkState::Superseded,
    }
}

fn prepared(review_op: ReviewOp) -> Envelope {
    env(Record::Prepared {
        doc: DocId::new(),
        parent: None,
        revision: RevisionId::new(),
        preimage: BlobHash::of_text(""),
        actor: Actor::Human,
        initiator: Actor::Human,
        tool: "t".into(),
        review_op,
        certificate: None,
    })
}

fn pending(observed_parent: ObservedRef) -> Envelope {
    env(Record::PendingObservation {
        doc: DocId::new(),
        actor: Actor::Human,
        initiator: Actor::Human,
        postimage: BlobHash::of_text("x"),
        observed_parent,
        observed_preimage: BlobHash::of_text(""),
        provenance: None,
    })
}

fn decode_value(v: &Value) -> Result<Decoded, TxnError> {
    codec::decode(&serde_json::to_vec(v).expect("json"))
}

/// `e` decodes; with one unknown key added to the object at `pointer` it
/// is corruption.
fn refuses_extra_at(e: &Envelope, pointer: &str) {
    let mut v = serde_json::to_value(e).expect("serializes");
    assert!(
        decode_value(&v).is_ok(),
        "the clean record decodes ({pointer})"
    );
    v.pointer_mut(pointer)
        .and_then(Value::as_object_mut)
        .unwrap_or_else(|| panic!("{pointer} is an object"))
        .insert("futureField".into(), json!(1));
    match decode_value(&v) {
        Err(TxnError::Corrupt(_)) => {}
        other => panic!("{pointer}: an unknown nested field must be corruption, got {other:?}"),
    }
}

#[test]
fn every_review_op_and_restore_source_refuses_unknown_fields() {
    let revert = ReviewOp::HunkRevert {
        hunk_id: HunkId("h".into()),
        expected_review_gen: 3,
    };
    for op in [ReviewOp::Review, ReviewOp::None, revert] {
        refuses_extra_at(&prepared(op), "/record/reviewOp");
    }
    for source in [
        RestoreSource::Revision {
            revision: RevisionId::new(),
        },
        RestoreSource::UncommittedPreimage { txn: TxnId::new() },
        RestoreSource::LegacyCheckpoint {
            legacy_id: "cp-1".into(),
        },
    ] {
        let e = prepared(ReviewOp::Restore { source });
        refuses_extra_at(&e, "/record/reviewOp");
        refuses_extra_at(&e, "/record/reviewOp/source");
    }
}

#[test]
fn hunks_ranges_transitions_effects_and_items_refuse_unknown_fields() {
    let tomb = env(Record::Tombstone {
        doc: DocId::new(),
        revision: RevisionId::new(),
        parent: None,
        actor: Actor::Human,
        preimage: None,
        postimage: BlobHash::of_text("bb"),
        review_op: ReviewOp::Review,
        hunks: vec![hunk()],
        transitions: vec![transition()],
        attached_to: None,
        addresses: vec![],
    });
    for p in [
        "/record/reviewOp",
        "/record/hunks/0",
        "/record/hunks/0/baseRange",
        "/record/hunks/0/targetRange",
        "/record/transitions/0",
    ] {
        refuses_extra_at(&tomb, p);
    }
    let observed = env(Record::ObservedRevision {
        revision: RevisionId::new(),
        parent: None,
        effects: ReviewEffects {
            new_hunks: vec![hunk()],
            transitions: vec![transition()],
            spans: vec![MappedSpan {
                hunk_id: HunkId("h".into()),
                range: range(1, 1),
                growing: true,
                edited_since: false,
                block: None,
                last_certified: None,
            }],
            algorithm: "myers".into(),
        },
    });
    for p in [
        "/record/effects",
        "/record/effects/newHunks/0",
        "/record/effects/transitions/0",
        "/record/effects/spans/0/range",
    ] {
        refuses_extra_at(&observed, p);
    }
    // An empty effects object is still an object with a closed shape.
    let bare = env(Record::ObservedRevision {
        revision: RevisionId::new(),
        parent: None,
        effects: ReviewEffects::default(),
    });
    refuses_extra_at(&bare, "/record/effects");
    let decision = env(Record::ReviewDecision {
        doc: DocId::new(),
        expected_head: None,
        action: ReviewAction::Keep,
        items: vec![ReviewItem {
            hunk_id: HunkId("h".into()),
            expected_review_gen: 0,
        }],
    });
    refuses_extra_at(&decision, "/record/items/0");
}

#[test]
fn every_observed_parent_variant_refuses_unknown_fields() {
    for base in [
        ObservedRef::Genesis,
        ObservedRef::Revision {
            revision: RevisionId::new(),
        },
        ObservedRef::Pending {
            observation: TxnId::new(),
        },
        ObservedRef::Unjournaled {
            revision: RevisionId::new(),
        },
    ] {
        refuses_extra_at(&pending(base.clone()), "/record/observedParent");
        let concurrent = env(Record::ConcurrentObservation {
            revision: RevisionId::new(),
            parent: None,
            observed_parent: base,
            observed_preimage: BlobHash::of_text(""),
            effects: ReviewEffects::default(),
        });
        refuses_extra_at(&concurrent, "/record/observedParent");
    }
}

#[test]
fn unit_like_variants_keep_their_bare_tag_on_the_wire() {
    // Older builds read exactly this shape: the strict decoding must not
    // change what is written.
    assert_eq!(
        serde_json::to_value(ObservedRef::Genesis).unwrap(),
        json!({"ref": "genesis"})
    );
    assert_eq!(
        serde_json::to_value(ReviewOp::Review).unwrap(),
        json!({"op": "review"})
    );
    assert_eq!(
        serde_json::to_value(ReviewOp::None).unwrap(),
        json!({"op": "none"})
    );
    for v in [
        json!({"ref": "genesis"}),
        json!({"ref": "pending", "observation": TxnId::new()}),
    ] {
        let back: ObservedRef = serde_json::from_value(v.clone()).expect("decodes");
        assert_eq!(serde_json::to_value(back).unwrap(), v);
    }
    for v in [json!({"op": "review"}), json!({"op": "none"})] {
        let back: ReviewOp = serde_json::from_value(v.clone()).expect("decodes");
        assert_eq!(serde_json::to_value(back).unwrap(), v);
    }
}

fn mcp(principal: Principal) -> Actor {
    Actor::Mcp {
        principal,
        connection_id: ConnectionId::new(),
        session_label: None,
        display_name: None,
    }
}

fn authored(actor: Actor) -> Envelope {
    let mut e = prepared(ReviewOp::Review);
    if let Record::Prepared { actor: a, .. } = &mut e.record {
        *a = actor;
    }
    e
}

#[test]
fn every_actor_and_principal_variant_refuses_unknown_fields() {
    for actor in [
        Actor::Human,
        Actor::Legacy,
        Actor::System {
            reason: "gc".into(),
        },
    ] {
        refuses_extra_at(&authored(actor), "/record/actor");
    }
    for principal in [
        Principal::Anonymous,
        Principal::Unrecognized,
        Principal::Ambiguous,
        Principal::Provider {
            provider: "p".into(),
        },
    ] {
        let e = authored(mcp(principal));
        refuses_extra_at(&e, "/record/actor");
        refuses_extra_at(&e, "/record/actor/principal");
    }
}

#[test]
fn unit_like_actors_and_principals_keep_their_bare_tag_on_the_wire() {
    for v in [json!({"type": "human"}), json!({"type": "legacy"})] {
        let back: Actor = serde_json::from_value(v.clone()).expect("decodes");
        assert_eq!(serde_json::to_value(back).unwrap(), v);
    }
    for state in ["anonymous", "unrecognized", "ambiguous"] {
        let v = json!({"state": state});
        let back: Principal = serde_json::from_value(v.clone()).expect("decodes");
        assert_eq!(serde_json::to_value(back).unwrap(), v);
    }
}

impl Record {
    /// The record's `kind` tag, read from its serialized form so it cannot
    /// drift from the serde schema.
    pub fn kind(&self) -> String {
        serde_json::to_value(self).expect("schema types always serialize")["kind"]
            .as_str()
            .expect("every record carries a kind tag")
            .to_owned()
    }
}
