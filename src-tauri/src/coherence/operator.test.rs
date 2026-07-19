// WI-3.2 — operator runtime: Candidate construction (content-addressed,
// base-as-parent) and a deterministic single-object revision operator.

use super::*;
use crate::coherence::types::{InputRole, ObjectId};

fn oid() -> ObjectId {
    ObjectId(uuid::Uuid::from_u128(7))
}
fn base_rev() -> RevisionId {
    RevisionId::parse(&format!("rev1:{}", "ab".repeat(32))).unwrap()
}

#[test]
fn candidate_is_content_addressed_and_deterministic() {
    let a = Candidate::new(oid(), "hello".into(), base_rev(), vec![], "tidy", "s");
    let b = Candidate::new(oid(), "hello".into(), base_rev(), vec![], "tidy", "s");
    assert_eq!(a.revision, b.revision, "same content+base → same revision");
    assert_eq!(a.content_hash, b.content_hash);

    let c = Candidate::new(oid(), "world".into(), base_rev(), vec![], "tidy", "s");
    assert_ne!(
        a.revision, c.revision,
        "different content → different revision"
    );
}

#[test]
fn base_is_a_parent_never_an_input() {
    let c = Candidate::new(oid(), "x".into(), base_rev(), vec![], "tidy", "s");
    assert_eq!(c.parents, vec![base_rev()]);
    assert!(
        c.inputs.is_empty(),
        "base must not be recorded as an input (N2)"
    );
}

#[test]
fn revision_matches_recomputation() {
    let c = Candidate::new(oid(), "abc".into(), base_rev(), vec![], "tidy", "s");
    // The revision is exactly RevisionId::compute(content_hash, [base]).
    assert_eq!(
        c.revision,
        RevisionId::compute(&c.content_hash, &[base_rev()])
    );
}

#[test]
fn to_transformation_is_single_output_with_operator_intent() {
    let c = Candidate::new(oid(), "x".into(), base_rev(), vec![], "revise", "tighten");
    let agent = crate::coherence::types::Agent {
        kind: crate::coherence::types::AgentType::Human,
        id: None,
    };
    let t = c.to_transformation(agent);
    assert_eq!(t.outputs.len(), 1, "single output (Increment-1)");
    assert_eq!(t.intent.kind, "operator:revise");
    assert_eq!(t.outputs[0].revision, c.revision);
    assert_eq!(t.outputs[0].parents, vec![base_rev()]);
}

#[test]
fn candidate_may_carry_declared_inputs() {
    let input = InputRef {
        object: ObjectId(uuid::Uuid::from_u128(9)),
        revision: base_rev(),
        role: InputRole::Direct,
    };
    let c = Candidate::new(
        oid(),
        "x".into(),
        base_rev(),
        vec![input.clone()],
        "op",
        "s",
    );
    assert_eq!(c.inputs, vec![input]);
}

// ---- the tidy_revise operator -----------------------------------------------

#[test]
fn tidy_trims_trailing_whitespace() {
    let cands = tidy_revise(oid(), base_rev(), "line one   \nline two\t\n");
    assert!(!cands.is_empty());
    assert_eq!(cands[0].content, "line one\nline two\n");
    assert_eq!(cands[0].operator, "tidy");
}

#[test]
fn tidy_second_candidate_collapses_blank_lines() {
    let cands = tidy_revise(oid(), base_rev(), "a  \n\n\n\nb\n");
    // Two distinct candidates: trim-only, and trim+collapse.
    assert_eq!(cands.len(), 2);
    assert_eq!(cands[0].content, "a\n\n\n\nb\n");
    assert_eq!(cands[1].content, "a\n\nb\n");
    assert_ne!(cands[0].revision, cands[1].revision);
}

#[test]
fn tidy_produces_nothing_for_already_clean_text() {
    let cands = tidy_revise(oid(), base_rev(), "clean\ntext\n");
    assert!(
        cands.is_empty(),
        "no candidate when there is nothing to tidy"
    );
}

#[test]
fn tidy_is_deterministic() {
    let text = "x   \n\n\ny\n";
    let a = tidy_revise(oid(), base_rev(), text);
    let b = tidy_revise(oid(), base_rev(), text);
    assert_eq!(a, b);
}
