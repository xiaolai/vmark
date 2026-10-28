// WI-AL1.2 — journal schema v2: round trip of every record kind, golden wire shapes, versioned decoder, legacy line migration
//! WI-AL0.1 — journal schema v2: round trip of every record variant, golden
//! wire shapes, versioned decoder, legacy checkpoint migration, bounds.
//! v1 upgrade and old-writer refusal live in `provenance_schema.test.rs`.

use crate::agent_journal::actor::{Actor, Principal, SESSION_LABEL_MAX_BYTES};
use crate::agent_journal::codec::{decode, encode, migrate_legacy_line, Decoded};
use crate::agent_journal::ids::{BlobHash, ConnectionId, DocId, HunkId, RevisionId, TxnId};
use crate::agent_journal::provenance::{
    Block, BreakReason, Provenance, ProvenancePayload, Section, PROVENANCE_CAP,
};
use crate::agent_journal::record::{
    Envelope, GapReason, LegacyAnchor, ObservedRef, Record, SCHEMA_VERSION,
};
use crate::agent_journal::review::*;

fn h(s: &str) -> BlobHash {
    BlobHash::of_text(s)
}

fn effects() -> ReviewEffects {
    let target = RevisionId::new();
    let hunk = super::test_support::hunk(
        None,
        target,
        "ab",
        "aXb",
        super::test_support::r(1, 1),
        super::test_support::r(1, 2),
        HunkKind::Change,
    );
    ReviewEffects {
        new_hunks: vec![hunk.clone()],
        transitions: vec![HunkTransition {
            hunk_id: hunk.id.clone(),
            expected_review_gen: 3,
            to: HunkState::Superseded,
        }],
        spans: vec![MappedSpan {
            hunk_id: hunk.id,
            range: super::test_support::r(0, 4),
            edited_since: true,
            growing: false,
            block: Some(Block::new(BreakReason::UncertifiedRange, "user").unwrap()),
            last_certified: Some(LastCertified {
                at: target,
                range: super::test_support::r(1, 3),
            }),
        }],
        algorithm: "spike-1".into(),
    }
}

/// A certified payload "ab" → "aXb" (one insertion).
fn payload() -> ProvenancePayload {
    let mut p = Provenance::new(2, PROVENANCE_CAP).unwrap();
    p.compose(&[Section {
        from_a: 1,
        to_a: 1,
        from_b: 1,
        to_b: 2,
    }])
    .unwrap();
    ProvenancePayload::encode(&DocId::new().to_string(), "3", "genesis", "ab", "aXb", &p).unwrap()
}

fn all_review_ops() -> Vec<ReviewOp> {
    vec![
        ReviewOp::Review,
        ReviewOp::None,
        ReviewOp::HunkRevert {
            hunk_id: HunkId("h-1".into()),
            expected_review_gen: u64::MAX,
        },
        ReviewOp::Restore {
            source: RestoreSource::Revision {
                revision: RevisionId::new(),
            },
        },
        ReviewOp::Restore {
            source: RestoreSource::UncommittedPreimage { txn: TxnId::new() },
        },
        ReviewOp::Restore {
            source: RestoreSource::LegacyCheckpoint {
                legacy_id: "ck-1".into(),
            },
        },
    ]
}

fn all_actors() -> Vec<Actor> {
    let mcp = |principal| Actor::Mcp {
        principal,
        connection_id: ConnectionId::new(),
        session_label: None,
        display_name: None,
    };
    vec![
        Actor::Human,
        Actor::System {
            reason: "retention".into(),
        },
        Actor::Legacy,
        mcp(Principal::Anonymous),
        mcp(Principal::Unrecognized),
        mcp(Principal::Ambiguous),
        super::test_support::agent(),
    ]
}

fn all_records() -> Vec<Record> {
    let doc = DocId::new();
    let mut out = vec![
        Record::JournalHeader {
            generation_floor: 42,
        },
        Record::Aborted {
            reason: "user typed".into(),
        },
        Record::Committed {
            postimage: h("b"),
            resolves: Some(TxnId::new()),
            provenance: Some(payload()),
            effects: effects(),
            addresses: vec![],
        },
        Record::Committed {
            postimage: h("b"),
            resolves: None,
            provenance: Some(payload()),
            effects: ReviewEffects::default(),
            addresses: vec![],
        },
        Record::EpochArmed {
            doc,
            epoch: u64::MAX,
        },
        Record::EpochClosed { doc, epoch: 1 },
        Record::EpochUnclosed { doc, epoch: 2 },
        Record::Uncommitted,
        Record::Discarded {
            resolves: TxnId::new(),
        },
        Record::ObservedRevision {
            revision: RevisionId::new(),
            parent: Some(RevisionId::new()),
            effects: effects(),
        },
        Record::Gap {
            revision: RevisionId::new(),
            parent: None,
            observed_preimage: h("p"),
            reason: GapReason::UnjournaledBase,
            effects: effects(),
        },
        Record::Tombstone {
            doc,
            revision: RevisionId::new(),
            parent: Some(RevisionId::new()),
            actor: Actor::Human,
            preimage: Some(h("a")),
            postimage: h("b"),
            review_op: ReviewOp::None,
            hunks: effects().new_hunks,
            transitions: vec![],
            attached_to: Some(HunkId("h-2".into())),
            addresses: vec![],
        },
        Record::LegacyCheckpoint {
            legacy_id: "ck".into(),
            preimage: h("before"),
            postimage: None,
            anchor: LegacyAnchor::FilePath {
                path: "/tmp/中文.md".into(),
            },
            tool: "document.write".into(),
            description: "d".into(),
            timestamp: 1,
        },
        Record::LegacyCheckpoint {
            legacy_id: "ck2".into(),
            preimage: h("before"),
            postimage: Some(h("after")),
            anchor: LegacyAnchor::Tab {
                tab_id: "tab-7".into(),
            },
            tool: "selection.set".into(),
            description: String::new(),
            timestamp: 2,
        },
    ];
    for op in all_review_ops() {
        out.push(Record::Prepared {
            doc,
            parent: Some(RevisionId::new()),
            revision: RevisionId::new(),
            preimage: h("a"),
            actor: super::test_support::agent(),
            initiator: Actor::Human,
            tool: "document.write".into(),
            review_op: op,
            certificate: None,
        });
    }
    for actor in all_actors() {
        out.push(Record::PendingObservation {
            doc,
            actor,
            initiator: super::test_support::agent(),
            postimage: h("b"),
            observed_parent: ObservedRef::Genesis,
            observed_preimage: h(""),
            provenance: Some(payload()),
        });
    }
    out.push(Record::PendingObservation {
        doc,
        actor: Actor::Human,
        initiator: Actor::Human,
        postimage: h("b"),
        observed_parent: ObservedRef::Genesis,
        observed_preimage: h(""),
        provenance: None,
    });
    let refs = [
        ObservedRef::Revision {
            revision: RevisionId::new(),
        },
        ObservedRef::Pending {
            observation: TxnId::new(),
        },
        ObservedRef::Unjournaled {
            revision: RevisionId::new(),
        },
        ObservedRef::Genesis,
    ];
    for observed_parent in refs {
        out.push(Record::ConcurrentObservation {
            revision: RevisionId::new(),
            parent: Some(RevisionId::new()),
            observed_parent,
            observed_preimage: h("p"),
            effects: effects(),
        });
    }
    for action in [
        ReviewAction::Keep,
        ReviewAction::Unkeep,
        ReviewAction::MarkHandled,
        ReviewAction::Conflicted,
        ReviewAction::ClearReviewed,
    ] {
        out.push(Record::ReviewDecision {
            doc,
            expected_head: None,
            action,
            items: vec![ReviewItem {
                hunk_id: HunkId("h-9".into()),
                expected_review_gen: u64::MAX - 2,
            }],
        });
    }
    out
}

fn env(record: Record) -> Envelope {
    Envelope {
        schema_version: SCHEMA_VERSION,
        seq: 7,
        txn: TxnId::new(),
        at: 1_760_000_000_000,
        record,
        receipt: None,
    }
}

#[test]
fn every_record_variant_round_trips() {
    let records = all_records();
    let kinds: std::collections::BTreeSet<_> = records.iter().map(Record::kind).collect();
    assert_eq!(kinds.len(), 16, "all 16 kinds covered: {kinds:?}");
    for rec in records {
        let e = env(rec);
        match decode(&encode(&e)).expect("decode") {
            Decoded::Known(back) => assert_eq!(*back, e),
            other => panic!("unexpected {other:?}"),
        }
    }
}

#[test]
fn review_op_is_a_closed_tagged_union_with_four_variants() {
    let tags: std::collections::BTreeSet<String> = all_review_ops()
        .iter()
        .map(|op| {
            serde_json::to_value(op).unwrap()["op"]
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();
    assert_eq!(
        tags,
        ["hunkRevert", "none", "restore", "review"]
            .map(String::from)
            .into()
    );
    let unknown = serde_json::json!({"op": "autoAccept"});
    assert!(
        serde_json::from_value::<ReviewOp>(unknown).is_err(),
        "unknown op is refused, not defaulted"
    );
}

#[test]
fn golden_wire_shapes() {
    let op = ReviewOp::HunkRevert {
        hunk_id: HunkId("h-1".into()),
        expected_review_gen: 18_446_744_073_709_551_615,
    };
    assert_eq!(
        serde_json::to_string(&op).unwrap(),
        r#"{"op":"hunkRevert","hunkId":"h-1","expectedReviewGen":"18446744073709551615"}"#,
        "R15: u64::MAX travels as an exact decimal string (a JS number would round it)"
    );
    let number = r#"{"op":"hunkRevert","hunkId":"h-1","expectedReviewGen":3}"#;
    assert!(
        serde_json::from_str::<ReviewOp>(number).is_err(),
        "a JSON number is refused, not coerced"
    );
    let header = Envelope {
        schema_version: SCHEMA_VERSION,
        seq: u64::MAX,
        txn: TxnId(uuid::Uuid::nil()),
        at: 0,
        record: Record::JournalHeader {
            generation_floor: u64::MAX - 1,
        },
        receipt: None,
    };
    let json = serde_json::to_value(&header).unwrap();
    assert_eq!(json["seq"], "18446744073709551615");
    assert_eq!(json["record"]["generationFloor"], "18446744073709551614");
    assert_eq!(
        serde_json::from_value::<Envelope>(json).unwrap(),
        header,
        "the journal reads back what it wrote"
    );
    let range = serde_json::to_string(&super::test_support::r(1, 2)).unwrap();
    assert_eq!(
        range, r#"{"from":1,"to":2}"#,
        "ranges use the worker shape: from and to"
    );
    let rec = Record::Discarded {
        resolves: TxnId(uuid::Uuid::nil()),
    };
    assert_eq!(
        serde_json::to_string(&rec).unwrap(),
        r#"{"kind":"discarded","resolves":"00000000-0000-0000-0000-000000000000"}"#
    );
    let actor = Actor::Mcp {
        principal: Principal::Ambiguous,
        connection_id: ConnectionId(uuid::Uuid::nil()),
        session_label: None,
        display_name: None,
    };
    assert_eq!(
        serde_json::to_string(&actor).unwrap(),
        r#"{"type":"mcp","principal":{"state":"ambiguous"},"connectionId":"00000000-0000-0000-0000-000000000000"}"#
    );
}

#[test]
fn decoder_reports_future_versions_instead_of_dropping_them() {
    let mut v = serde_json::to_value(env(Record::Uncommitted)).unwrap();
    let next = crate::agent_journal::record::MAX_SUPPORTED_SCHEMA + 1;
    v["schemaVersion"] = next.into();
    v["record"] = serde_json::json!({"kind": "somethingNew", "x": 1});
    match decode(serde_json::to_vec(&v).unwrap().as_slice()).unwrap() {
        Decoded::Future { version, seq } => assert_eq!((version, seq), (next, 7)),
        other => panic!("{other:?}"),
    }
}

#[test]
fn decoder_refuses_missing_zero_or_malformed_versions_and_unknown_kinds() {
    let base = serde_json::to_value(env(Record::Uncommitted)).unwrap();
    for bad in [
        serde_json::json!({"seq": 1}),
        {
            let mut v = base.clone();
            v["schemaVersion"] = 0.into();
            v
        },
        {
            let mut v = base.clone();
            v["schemaVersion"] = "1".into();
            v
        },
        {
            let mut v = base.clone();
            v["record"] = serde_json::json!({"kind": "resolved"});
            v
        },
        {
            let mut v = serde_json::to_value(env(Record::Committed {
                postimage: h("b"),
                resolves: None,
                provenance: Some(payload()),
                effects: ReviewEffects::default(),
                addresses: vec![],
            }))
            .unwrap();
            v["record"].as_object_mut().unwrap().remove("provenance");
            v
        },
    ] {
        let err = decode(serde_json::to_vec(&bad).unwrap().as_slice()).unwrap_err();
        assert_eq!(err.code(), "JOURNAL_CORRUPT", "{bad}");
    }
    assert_eq!(decode(b"not json").unwrap_err().code(), "JOURNAL_CORRUPT");
    assert_eq!(decode(b"").unwrap_err().code(), "JOURNAL_CORRUPT");
}

#[test]
fn blob_hash_rejects_malformed_addresses() {
    for bad in [
        "",
        "sha256-",
        "sha256-XYZ",
        "md5-00",
        &format!("sha256-{}", "A".repeat(64)),
    ] {
        assert!(
            serde_json::from_value::<BlobHash>(serde_json::json!(bad)).is_err(),
            "{bad}"
        );
    }
    let ok = h("中文🙂");
    assert_eq!(
        serde_json::from_value::<BlobHash>(serde_json::json!(ok.as_str())).unwrap(),
        ok
    );
}

#[test]
fn hunk_id_is_content_derived_and_excludes_algorithm() {
    let t = RevisionId::new();
    let a = super::test_support::hunk(
        None,
        t,
        "ab",
        "aXb",
        super::test_support::r(1, 1),
        super::test_support::r(1, 2),
        HunkKind::Change,
    );
    assert!(a.id_is_consistent());
    let b = super::test_support::hunk(
        None,
        t,
        "ab",
        "aYb",
        super::test_support::r(1, 1),
        super::test_support::r(1, 2),
        HunkKind::Change,
    );
    assert_ne!(a.id, b.id, "target text is an input");
    let mut tampered = a.clone();
    tampered.target_range.end = 3;
    assert!(!tampered.id_is_consistent());
    assert_eq!(
        a.id.0.len(),
        64,
        "R15: the full lowercase hex SHA-256, no prefix"
    );
    let too_far = super::test_support::r(0, (1 << 53) + 1);
    let err = Hunk::compute_id(None, t, too_far, too_far, &h(""), &h("")).unwrap_err();
    assert!(err.contains("2^53"), "{err}");
}

#[test]
fn session_label_bound_is_bytes_not_chars() {
    let label = |s: String| Actor::Mcp {
        principal: Principal::Anonymous,
        connection_id: ConnectionId::new(),
        session_label: Some(s),
        display_name: None,
    };
    assert!(label("a".repeat(SESSION_LABEL_MAX_BYTES))
        .validate()
        .is_ok());
    // 43 CJK chars = 129 UTF-8 bytes: over the limit though only 43 chars.
    assert!(label("中".repeat(43)).validate().is_err());
    assert!(label("中".repeat(42)).validate().is_ok());
}

#[test]
fn session_label_rejects_blank_and_control_characters() {
    let label = |s: &str| Actor::Mcp {
        principal: Principal::Anonymous,
        connection_id: ConnectionId::new(),
        session_label: Some(s.to_string()),
        display_name: None,
    };
    // The bridge normalises blank labels to `None`; a blank `Some` never
    // reaches the journal legitimately.
    assert!(label("").validate().is_err());
    assert!(label(" \u{3000} ").validate().is_err());
    assert!(label("a\nb").validate().is_err());
    assert!(label("a\u{0}b").validate().is_err());
    assert!(label("a\u{7f}").validate().is_err());
    assert!(label("ok 中文 🎉 مرحبا").validate().is_ok());
}

/// The bridge refuses a label carrying bidirectional formatting characters
/// (`mcp_bridge::attribution::validate_session_label`), so the journal does
/// too: each reorders how the label, and the text after it, renders.
#[test]
fn session_label_rejects_bidi_formatting_characters() {
    let label = |s: String| Actor::Mcp {
        principal: Principal::Anonymous,
        connection_id: ConnectionId::new(),
        session_label: Some(s),
        display_name: None,
    };
    for c in [
        '\u{061C}', '\u{200E}', '\u{200F}', '\u{202A}', '\u{202B}', '\u{202C}', '\u{202D}',
        '\u{202E}', '\u{2066}', '\u{2067}', '\u{2068}', '\u{2069}',
    ] {
        assert!(
            label(format!("review{c}gpj.md")).validate().is_err(),
            "U+{:04X}",
            c as u32
        );
    }
    // Right-to-left text itself is an ordinary label.
    assert!(label("مراجعة עברית".to_string()).validate().is_ok());
}

#[test]
fn legacy_checkpoint_lines_migrate_without_loss() {
    let file = r#"{"id":"ck-1","tabId":"tab-3","filePath":"/notes/a.md","timestamp":1700000000000,"tool":"document.write","description":"rewrite","contentBefore":"old 中文","revisionBefore":"r1","revisionAfter":"r2","byteSize":6}"#;
    let m = migrate_legacy_line(file).expect("migrate");
    assert_eq!(m.preimage_text, "old 中文");
    match &m.record {
        Record::LegacyCheckpoint {
            legacy_id,
            preimage,
            postimage,
            anchor,
            tool,
            description,
            timestamp,
        } => {
            assert_eq!(legacy_id, "ck-1");
            assert_eq!(preimage, &h("old 中文"));
            assert_eq!(postimage, &None);
            assert_eq!(
                anchor,
                &LegacyAnchor::FilePath {
                    path: "/notes/a.md".into()
                }
            );
            assert_eq!(
                (tool.as_str(), description.as_str(), *timestamp),
                ("document.write", "rewrite", 1_700_000_000_000)
            );
        }
        other => panic!("{other:?}"),
    }
    let untitled = r#"{"id":"ck-2","tabId":"tab-9","filePath":null,"timestamp":1,"tool":"selection.set","description":"","contentBefore":"","revisionBefore":"a","revisionAfter":"b","byteSize":0}"#;
    match migrate_legacy_line(untitled).unwrap().record {
        Record::LegacyCheckpoint { anchor, .. } => assert_eq!(
            anchor,
            LegacyAnchor::Tab {
                tab_id: "tab-9".into()
            }
        ),
        other => panic!("{other:?}"),
    }
    assert!(
        migrate_legacy_line(r#"{"id":"x"}"#).is_err(),
        "a malformed line is reported, not skipped silently"
    );
}

/// Inject `key` into the object at `path` of an encoded envelope and decode.
fn decode_with_extra(
    env: &Envelope,
    path: &[&str],
) -> Result<Decoded, crate::agent_journal::errors::TxnError> {
    let mut value: serde_json::Value = serde_json::from_slice(&encode(env)).unwrap();
    let mut at = &mut value;
    for p in path {
        at = at.get_mut(*p).expect("path exists");
    }
    at.as_object_mut()
        .expect("an object")
        .insert("futureField".into(), serde_json::json!(1));
    decode(&serde_json::to_vec(&value).unwrap())
}

#[test]
fn an_unknown_field_in_a_current_version_record_is_corruption_not_dropped() {
    for record in all_records() {
        let e = env(record);
        assert!(
            matches!(decode(&encode(&e)), Ok(Decoded::Known(_))),
            "the clean record decodes: {e:?}"
        );
        for path in [&[][..], &["record"][..]] {
            let got = decode_with_extra(&e, path);
            assert!(
                matches!(got, Err(crate::agent_journal::errors::TxnError::Corrupt(_))),
                "an extra field at {path:?} must be refused, got {got:?} for {e:?}"
            );
        }
    }
}

#[test]
fn an_unknown_field_inside_a_nested_union_is_corruption() {
    let observed = env(Record::ConcurrentObservation {
        revision: RevisionId::new(),
        parent: None,
        observed_parent: ObservedRef::Revision {
            revision: RevisionId::new(),
        },
        observed_preimage: h("p"),
        effects: effects(),
    });
    let legacy = env(Record::LegacyCheckpoint {
        legacy_id: "l".into(),
        preimage: h("a"),
        postimage: None,
        anchor: LegacyAnchor::Tab { tab_id: "t".into() },
        tool: "document.write".into(),
        description: String::new(),
        timestamp: 2,
    });
    for (e, path) in [
        (&observed, &["record", "observedParent"][..]),
        (&legacy, &["record", "anchor"][..]),
    ] {
        let got = decode_with_extra(e, path);
        assert!(
            matches!(got, Err(crate::agent_journal::errors::TxnError::Corrupt(_))),
            "an extra field at {path:?} must be refused, got {got:?}"
        );
    }
}

#[test]
fn the_last_generation_is_reserved_so_the_next_one_cannot_wrap() {
    use crate::agent_journal::projection::Projection;
    let header = |seq: u64, floor: u64| Envelope {
        seq,
        ..env(Record::JournalHeader {
            generation_floor: floor,
        })
    };
    let mut p = Projection::default();
    p.apply(&header(1, u64::MAX - 1))
        .expect("below the reserve");
    assert_eq!(p.generation, u64::MAX - 1);
    for (seq, floor) in [(2, u64::MAX), (u64::MAX, 1)] {
        let got = Projection::default().apply(&header(seq, floor));
        assert!(
            matches!(got, Err(crate::agent_journal::errors::TxnError::Corrupt(_))),
            "seq {seq}, floor {floor}: {got:?}"
        );
    }
}

#[test]
fn a_refused_first_record_of_a_document_creates_no_document() {
    use crate::agent_journal::projection::Projection;
    let doc = DocId::new();
    let unknown = Record::Tombstone {
        doc,
        revision: RevisionId::new(),
        parent: None,
        actor: Actor::Human,
        preimage: None,
        postimage: h("b"),
        review_op: ReviewOp::None,
        hunks: vec![],
        transitions: vec![HunkTransition {
            hunk_id: HunkId("h-unknown".into()),
            expected_review_gen: 0,
            to: HunkState::Superseded,
        }],
        attached_to: None,
        addresses: vec![],
    };
    for record in [unknown, Record::EpochArmed { doc, epoch: 2 }] {
        let mut p = Projection::default();
        assert!(p.apply(&env(record.clone())).is_err(), "{record:?}");
        assert_eq!(p, Projection::default(), "{record:?}");
    }
}
