// WI-AL2.2a — `Projection::apply` folds an admission's items through the one reducer and indexes a receipt from either carrier (a top-level `prepared`, or an admission's last item); a receipt bound to another document, transaction or revision, a request id already indexed, or a linearization of another document is refused before anything reduces, so the projection is unchanged
//! The projection side of R50 rule 2 and R103's preflight.

use crate::agent_journal::admission::admission_shape_tests::{
    env, observation, prepared, receipt, valid_admission, REQUEST,
};
use crate::agent_journal::ids::{DocId, RevisionId, TxnId};
use crate::agent_journal::projection::{Projection, TxnStatus};
use crate::agent_journal::record::{Envelope, Record};

fn items(a: &mut Envelope) -> &mut Vec<Envelope> {
    match &mut a.record {
        Record::Admission { items } => items,
        _ => unreachable!(),
    }
}

#[track_caller]
fn refused_unchanged(p: &mut Projection, e: &Envelope, why: &str) {
    let before = p.clone();
    let err = p.apply(e).expect_err(why);
    assert_eq!(err.code(), "JOURNAL_CORRUPT", "{why}: {err}");
    assert_eq!(*p, before, "{why}: the projection changed");
}

#[test]
fn an_admission_reduces_every_item_and_indexes_its_receipt() {
    let (a, doc) = valid_admission();
    let mut p = Projection::default();
    p.apply(&a).expect("a valid admission applies");

    assert_eq!(p.generation, 12);
    let Record::Admission { items } = &a.record else {
        unreachable!()
    };
    let (
        Record::ObservedRevision { revision: b, .. },
        Record::Prepared {
            revision: t_rev, ..
        },
    ) = (&items[1].record, &items[2].record)
    else {
        unreachable!()
    };
    assert_eq!(p.docs[&doc].head, Some(*b), "the linearization applied");
    assert!(p.docs[&doc].pending.is_empty());
    assert!(matches!(p.txns[&a.txn].status, TxnStatus::Prepared));
    assert_eq!(p.txns[&a.txn].revision, *t_rev);
    let stored = &p.requests[&REQUEST.parse().unwrap()];
    assert_eq!(Some(stored), items[2].receipt.as_ref());
    assert_eq!(stored.txn(), Some(a.txn));
    assert_eq!(p.requests.len(), 1);
}

#[test]
fn a_top_level_prepared_indexes_its_receipt() {
    let doc = DocId::new();
    let (t, rev) = (TxnId::new(), RevisionId::new());
    let mut e = env(1, t, prepared(doc, None, rev, ""));
    e.receipt = Some(receipt(doc, t, rev, 1));
    let mut p = Projection::default();
    p.apply(&e).unwrap();
    assert_eq!(p.requests[&REQUEST.parse().unwrap()], e.receipt.unwrap());
}

#[test]
fn a_receipt_bound_elsewhere_fails_before_any_item_reduces() {
    for which in ["doc", "txn", "revision"] {
        let (mut a, doc) = valid_admission();
        let last = items(&mut a).last_mut().unwrap();
        let Record::Prepared { revision, .. } = last.record else {
            unreachable!()
        };
        let (d, t, r) = match which {
            "doc" => (DocId::new(), last.txn, revision),
            "txn" => (doc, TxnId::new(), revision),
            _ => (doc, last.txn, RevisionId::new()),
        };
        last.receipt = Some(receipt(d, t, r, 12));
        refused_unchanged(
            &mut Projection::default(),
            &a,
            &format!("child, other {which}"),
        );

        let mut top = env(1, a.txn, prepared(doc, None, revision, ""));
        top.receipt = Some(receipt(d, t, r, 1));
        refused_unchanged(
            &mut Projection::default(),
            &top,
            &format!("top, other {which}"),
        );
    }
}

#[test]
fn a_request_id_already_indexed_is_refused_with_the_projection_unchanged() {
    let (a, doc) = valid_admission();
    let mut p = Projection::default();
    p.apply(&a).unwrap();

    let (t, rev) = (TxnId::new(), RevisionId::new());
    let other_doc = DocId::new();
    let mut top = env(13, t, prepared(other_doc, None, rev, ""));
    top.receipt = Some(receipt(other_doc, t, rev, 13));
    refused_unchanged(&mut p, &top, "a second top-level prepared under the id");

    let o = TxnId::new();
    let mut last = env(15, t, prepared(doc, None, rev, "y"));
    last.receipt = Some(receipt(doc, t, rev, 15));
    let second = env(
        14,
        t,
        Record::Admission {
            items: vec![env(14, o, observation(doc, "y")), last],
        },
    );
    refused_unchanged(&mut p, &second, "an admission whose receipt reuses the id");
}

#[test]
fn a_linearization_of_another_documents_observation_is_refused_unchanged() {
    let mut p = Projection::default();
    let elsewhere = DocId::new();
    let o = TxnId::new();
    p.apply(&env(1, o, observation(elsewhere, "z"))).unwrap();

    let doc = DocId::new();
    let (t, rev, b) = (TxnId::new(), RevisionId::new(), RevisionId::new());
    let frame = env(
        2,
        t,
        Record::Admission {
            items: vec![
                env(
                    2,
                    o,
                    crate::agent_journal::admission::admission_shape_tests::linearized(b),
                ),
                env(3, t, prepared(doc, None, rev, "")),
            ],
        },
    );
    refused_unchanged(&mut p, &frame, "a linearization of another document");
}

#[test]
fn a_nested_or_misshapen_frame_built_in_memory_is_refused_unchanged() {
    let (a, _) = valid_admission();
    let mut nested = a.clone();
    items(&mut nested)[0] = a.clone();
    refused_unchanged(&mut Projection::default(), &nested, "nested");

    let mut v2 = a;
    v2.schema_version = crate::agent_journal::record::SCHEMA_V2;
    refused_unchanged(&mut Projection::default(), &v2, "labelled v2");
}
