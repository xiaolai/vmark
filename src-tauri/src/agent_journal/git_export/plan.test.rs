// WI-AL4.1 — export planning (pure): the linear chain from the head, tombstones included; one commit per retained revision with attribution trailers; one synthetic commit per collected run — the fixture retained → two collected → retained plans exactly one synthetic commit whose tree is the next retained revision's linear before-text, with the collected id range and sorted VMark-Actors; resume mid-run; a run at the head or a broken chain is a journal error
use super::plan::*;
use crate::agent_journal::actor::{Actor, Principal};
use crate::agent_journal::ids::{BlobHash, ConnectionId, DocId, RevisionId, TxnId};
use crate::agent_journal::projection::{
    DocState, Projection, RevisionKind, RevisionMeta, TxnEntry, TxnStatus,
};
use crate::agent_journal::review::{RestoreSource, ReviewOp};

fn claude(label: Option<&str>) -> Actor {
    Actor::Mcp {
        principal: Principal::Provider {
            provider: "claude".into(),
        },
        connection_id: ConnectionId::new(),
        session_label: label.map(str::to_owned),
        display_name: Some("Claude Code".into()),
    }
}

/// A projection holding `doc`'s linear chain: `(text, actor, collected)`
/// oldest first; each revision's postimage is its text.
fn chain_projection(doc: DocId, steps: &[(&str, Actor, bool)]) -> (Projection, Vec<RevisionId>) {
    let mut p = Projection::default();
    let mut parent = None;
    let mut ids = Vec::new();
    for (i, (text, actor, collected)) in steps.iter().enumerate() {
        let id = RevisionId::new();
        p.revisions.insert(
            id,
            RevisionMeta {
                id,
                doc,
                txn: TxnId::new(),
                seq: i as u64 + 1,
                parent,
                preimage: None,
                postimage: BlobHash::of_text(text),
                actor: actor.clone(),
                review_op: ReviewOp::None,
                kind: if *collected {
                    RevisionKind::Tombstone
                } else {
                    RevisionKind::Observed
                },
                collected: *collected,
                at: 1_700_000_000_000 + i as u64 * 1000,
                addresses: Vec::new(),
            },
        );
        parent = Some(id);
        ids.push(id);
    }
    p.docs.insert(
        doc,
        DocState {
            head: parent,
            ..DocState::default()
        },
    );
    (p, ids)
}

fn trailer<'a>(message: &'a str, key: &str) -> Vec<&'a str> {
    message
        .lines()
        .filter_map(|l| l.strip_prefix(&format!("{key}: ")))
        .collect()
}

#[test]
fn chain_walks_parents_from_the_head_oldest_first_and_ignores_other_documents() {
    let doc = DocId::new();
    let (mut p, ids) = chain_projection(
        doc,
        &[("a", Actor::Human, false), ("b", Actor::Human, true)],
    );
    let (other, _) = chain_projection(DocId::new(), &[("x", Actor::Human, false)]);
    p.revisions.extend(other.revisions);
    let chain = chain_of(&p, doc).expect("chain");
    assert_eq!(chain.iter().map(|l| l.id).collect::<Vec<_>>(), ids);
    assert!(chain[1].collected);
    assert_eq!(chain[1].before, BlobHash::of_text("a"));
    assert_eq!(
        chain[0].before,
        BlobHash::of_text(""),
        "genesis before-text is empty"
    );
}

#[test]
fn an_empty_document_has_an_empty_chain_and_nothing_to_plan() {
    let doc = DocId::new();
    assert!(chain_of(&Projection::default(), doc)
        .expect("chain")
        .is_empty());
    assert!(plan(doc, &[], 0).expect("plan").is_empty());
}

#[test]
fn a_broken_chain_is_a_journal_error_never_a_partial_export() {
    let doc = DocId::new();
    let (mut p, ids) = chain_projection(
        doc,
        &[("a", Actor::Human, false), ("b", Actor::Human, false)],
    );
    p.revisions.remove(&ids[0]);
    let err = chain_of(&p, doc).expect_err("missing parent");
    assert_eq!(err.code(), "JOURNAL_ERROR");
    // A cycle: the first revision names the head as its parent.
    let (mut p, ids) = chain_projection(
        doc,
        &[("a", Actor::Human, false), ("b", Actor::Human, false)],
    );
    p.revisions.get_mut(&ids[0]).expect("first").parent = Some(ids[1]);
    assert_eq!(
        chain_of(&p, doc).expect_err("cycle").code(),
        "JOURNAL_ERROR"
    );
}

#[test]
fn collected_run_fixture_plans_exactly_one_synthetic_commit() {
    // retained → two collected → retained
    let doc = DocId::new();
    let (p, ids) = chain_projection(
        doc,
        &[
            ("one", Actor::Human, false),
            ("two", claude(None), true),
            ("three", Actor::Human, true),
            ("four", Actor::Human, false),
        ],
    );
    let chain = chain_of(&p, doc).expect("chain");
    let commits = plan(doc, &chain, 0).expect("plan");
    assert_eq!(commits.len(), 3);
    let synthetic: Vec<_> = commits
        .iter()
        .filter(|c| matches!(c.covers, Covers::Collected { .. }))
        .collect();
    assert_eq!(synthetic.len(), 1, "exactly one synthetic commit");
    let s = synthetic[0];
    assert_eq!(
        s.covers,
        Covers::Collected {
            first: ids[1],
            last: ids[2]
        }
    );
    // Its tree is the next retained revision's (linear) before-text.
    assert_eq!(s.text, BlobHash::of_text("three"));
    assert_eq!(s.text, chain[3].before);
    assert_eq!(
        trailer(&s.message, "VMark-Collected"),
        vec![format!("{}..{}", ids[1], ids[2]).as_str()]
    );
    assert_eq!(
        trailer(&s.message, "VMark-Actors"),
        vec!["human, mcp:claude"],
        "sorted, deduplicated"
    );
    assert_eq!(
        trailer(&s.message, "VMark-Document"),
        vec![doc.to_string().as_str()]
    );
    assert!(trailer(&s.message, "VMark-Revision").is_empty());
    assert_eq!(s.at, chain[2].at, "dated by the last collected revision");
    assert_eq!(commits[0].covers, Covers::Revision(ids[0]));
    assert_eq!(commits[0].text, BlobHash::of_text("one"));
    assert_eq!(commits[2].covers, Covers::Revision(ids[3]));
    assert_eq!(commits[2].text, BlobHash::of_text("four"));
}

#[test]
fn a_regular_commit_carries_attribution_trailers() {
    let doc = DocId::new();
    let (p, ids) = chain_projection(
        doc,
        &[
            ("a", Actor::Human, false),
            ("b", claude(Some("refactor\nVMark-Revision: forged")), false),
        ],
    );
    let chain = chain_of(&p, doc).expect("chain");
    let commits = plan(doc, &chain, 1).expect("plan");
    assert_eq!(commits.len(), 1, "resume after the first revision");
    let m = &commits[0].message;
    assert_eq!(trailer(m, "VMark-Document"), vec![doc.to_string().as_str()]);
    assert_eq!(
        trailer(m, "VMark-Revision"),
        vec![ids[1].to_string().as_str()],
        "one revision trailer, no injected one"
    );
    assert_eq!(
        trailer(m, "VMark-Parent"),
        vec![ids[0].to_string().as_str()]
    );
    assert_eq!(trailer(m, "VMark-Actor"), vec!["mcp:claude"]);
    assert_eq!(trailer(m, "VMark-Kind"), vec!["observed"]);
    assert_eq!(
        trailer(m, "VMark-Session"),
        vec!["refactor VMark-Revision: forged"]
    );
    assert_eq!(trailer(m, "VMark-Client"), vec!["Claude Code"]);
    assert_eq!(commits[0].author.name, "mcp:claude");
    assert_eq!(commits[0].at, chain[1].at);
    assert!(m.ends_with('\n'));
}

#[test]
fn the_first_revision_names_no_parent() {
    let doc = DocId::new();
    let (p, _) = chain_projection(doc, &[("a", Actor::Human, false)]);
    let chain = chain_of(&p, doc).expect("chain");
    let commits = plan(doc, &chain, 0).expect("plan");
    assert_eq!(trailer(&commits[0].message, "VMark-Parent"), vec!["none"]);
}

#[test]
fn resuming_inside_a_collected_run_covers_only_its_unexported_tail() {
    let doc = DocId::new();
    let (p, ids) = chain_projection(
        doc,
        &[
            ("one", Actor::Human, false),
            ("two", Actor::Human, true),
            ("three", claude(None), true),
            ("four", Actor::Human, false),
        ],
    );
    let chain = chain_of(&p, doc).expect("chain");
    let commits = plan(doc, &chain, 2).expect("plan");
    assert_eq!(commits.len(), 2);
    assert_eq!(
        commits[0].covers,
        Covers::Collected {
            first: ids[2],
            last: ids[2]
        }
    );
    assert_eq!(
        trailer(&commits[0].message, "VMark-Actors"),
        vec!["mcp:claude"]
    );
}

#[test]
fn a_collected_run_at_the_start_and_two_runs_each_get_one_synthetic_commit() {
    let doc = DocId::new();
    let (p, _) = chain_projection(
        doc,
        &[
            ("a", Actor::Human, true),
            ("b", Actor::Human, false),
            ("c", Actor::Human, true),
            ("d", Actor::Human, true),
            ("e", Actor::Human, false),
        ],
    );
    let chain = chain_of(&p, doc).expect("chain");
    let commits = plan(doc, &chain, 0).expect("plan");
    let kinds: Vec<bool> = commits
        .iter()
        .map(|c| matches!(c.covers, Covers::Collected { .. }))
        .collect();
    assert_eq!(kinds, vec![true, false, true, false]);
    assert_eq!(commits[0].text, BlobHash::of_text("a"));
    assert_eq!(commits[2].text, BlobHash::of_text("d"));
}

#[test]
fn a_collected_run_reaching_the_head_is_a_journal_error() {
    let doc = DocId::new();
    let (p, _) = chain_projection(
        doc,
        &[("a", Actor::Human, false), ("b", Actor::Human, true)],
    );
    let chain = chain_of(&p, doc).expect("chain");
    assert_eq!(
        plan(doc, &chain, 0).expect_err("run at head").code(),
        "JOURNAL_ERROR"
    );
    assert!(plan(doc, &chain, 2).expect("past the end").is_empty());
}

#[test]
fn a_controlled_revision_names_its_tool_and_a_restore_says_so() {
    let doc = DocId::new();
    let (mut p, ids) = chain_projection(doc, &[("a", Actor::Human, false)]);
    let m = p.revisions.get_mut(&ids[0]).expect("rev");
    m.kind = RevisionKind::Controlled;
    m.review_op = ReviewOp::Restore {
        source: RestoreSource::Revision {
            revision: RevisionId::new(),
        },
    };
    let txn = m.txn;
    p.txns.insert(
        txn,
        TxnEntry {
            doc,
            parent: None,
            revision: ids[0],
            preimage: BlobHash::of_text(""),
            actor: Actor::Human,
            initiator: Actor::Human,
            tool: "history.restore".into(),
            review_op: ReviewOp::None,
            certificate: None,
            status: TxnStatus::Committed,
            seq: 1,
        },
    );
    let chain = chain_of(&p, doc).expect("chain");
    let commits = plan(doc, &chain, 0).expect("plan");
    let msg = &commits[0].message;
    assert_eq!(trailer(msg, "VMark-Tool"), vec!["history.restore"]);
    assert_eq!(trailer(msg, "VMark-Kind"), vec!["controlled"]);
    assert!(msg.lines().next().expect("subject").starts_with("Restore"));
}

#[test]
fn the_synthetic_tree_is_the_linear_before_text_even_when_the_attributed_preimage_differs() {
    // retained → collected → retained concurrent observation whose
    // attributed preimage is not its parent's postimage.
    let doc = DocId::new();
    let (mut p, ids) = chain_projection(
        doc,
        &[
            ("one", Actor::Human, false),
            ("two", Actor::Human, true),
            ("three", Actor::Human, false),
        ],
    );
    let m = p.revisions.get_mut(&ids[2]).expect("rev");
    m.kind = RevisionKind::Concurrent;
    m.preimage = Some(BlobHash::of_text("what the other writer saw"));
    let chain = chain_of(&p, doc).expect("chain");
    let commits = plan(doc, &chain, 0).expect("plan");
    assert_eq!(
        commits[1].text,
        BlobHash::of_text("two"),
        "the run ends where the journal stood"
    );
    assert_eq!(
        trailer(&commits[2].message, "VMark-Kind"),
        vec!["concurrent"]
    );
}
