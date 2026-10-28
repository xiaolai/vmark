// WI-AL3.1b — comment admission: a create on unsaved text is one schema-5 admission whose items are all schema 5 and end with the commentCreated, and the whole projection equals replay; with persisted text A at the head and an unsaved edit B, a comment on text only in B is created on B's new revision, observed after A; a startup rewrite that prunes a deleted thread keeps every surviving record and admission item at its seq, its threads unchanged, and replays to the projection it left; a create whose baseline is refused appends nothing; and every real schema-5 carrier relabelled 1 to 4 is corrupt
//! R107 rules 1 and 2 and R57, through the comment handles.

use serde_json::{json, Value};

use crate::agent_journal::admission::request_support::{Page, Rig};

use crate::agent_journal::codec;
use crate::agent_journal::comment::comment_support::*;
use crate::agent_journal::comment::ids::{CommentCaller, CommentId};
use crate::agent_journal::comment::rules::Action;
use crate::agent_journal::gc_policy::GcPolicy;
use crate::agent_journal::ids::BlobHash;
use crate::agent_journal::record::{MAX_SUPPORTED_SCHEMA, SCHEMA_V5, SCHEMA_VERSION};
use crate::agent_journal::writer::Writer;

#[test]
fn this_build_writes_and_reads_schema_5() {
    assert_eq!((SCHEMA_VERSION, MAX_SUPPORTED_SCHEMA, SCHEMA_V5), (5, 5, 5));
}

#[test]
fn a_create_on_unsaved_text_is_one_schema_5_admission() {
    let (r, page) = rig();
    assert_eq!(head(&r), None, "nothing is saved yet");
    let c = comment_of(&create(&r, &page, "on unsaved text").expect("create"));
    let records = v5_records(&r);
    assert_eq!(records.len(), 1, "one frame: {records:?}");
    let frame = &records[0];
    assert_eq!(frame["record"]["kind"], "admission");
    let items = frame["record"]["items"].as_array().expect("items");
    assert!(items.len() >= 2, "a baseline and the create: {items:?}");
    assert!(
        items.iter().all(|i| i["schemaVersion"] == json!(SCHEMA_V5)),
        "{items:?}"
    );
    let last = items.last().expect("an item");
    assert_eq!(last["record"]["kind"], "commentCreated");
    assert_eq!(last["record"]["comment"], json!(c));
    assert_eq!(
        thread(&r, c).revision,
        head(&r).expect("the baseline is the head")
    );

    let live = r.c.writer.lock().proj.clone();
    let (dir, _) = close(r);
    let (w, _) = Writer::open(fast_config(dir.path())).expect("replay");
    assert_eq!(w.lock().proj, live, "live equals replay");
}

/// Persisted text A (the head), then an unsaved edit B that adds a line.
const B: &str = "# Title\n\nhello world\n\nonly in b\n";
const B_SEL: (u64, u64) = (22, 31);

/// A thread on A, then one on text only in B.
fn on_a_then_b(r: &Rig, page: &Page) -> (CommentId, CommentId) {
    let a = comment_of(&create(r, page, "on A").expect("create on A"));
    assert_eq!(&B[22..31], "only in b");
    let p = r.frame(page, create_body(r, B, B_SEL, "on B"));
    let b = comment_of(&create_as(r, page, CommentCaller::User, &p).expect("create on B"));
    (a, b)
}

#[test]
fn a_comment_on_text_only_in_an_unsaved_edit_is_created_on_its_new_revision() {
    let (r, page) = rig();
    let (a, b) = on_a_then_b(&r, &page);
    let (rev_a, rev_b) = (thread(&r, a).revision, thread(&r, b).revision);
    assert_ne!(rev_a, rev_b, "B is observed as a revision of its own");
    assert_eq!(head(&r), Some(rev_b), "B's revision is the head");
    let g = r.c.writer.lock();
    let meta = &g.proj.revisions[&rev_b];
    assert_eq!(meta.parent, Some(rev_a), "B's baseline follows A");
    assert_eq!(meta.postimage, BlobHash::of_text(B));
    drop(g);
    let frames = v5_records(&r);
    assert_eq!(frames.len(), 2, "two creates, two frames: {frames:?}");
    let last = frames[1]["record"]["items"]
        .as_array()
        .and_then(|i| i.last())
        .expect("B's create is an admission");
    assert_eq!(last["record"]["comment"], json!(b));
}

/// Every record of the journal but its header (a rewrite writes one for
/// the generation floor), admission items as their own entries:
/// (seq, kind, comment) in journal order.
fn flat(dir: &std::path::Path) -> Vec<(String, String, Value)> {
    let (w, _) = Writer::open(fast_config(dir)).expect("open");
    let raw = w.lock().journal.read_all().expect("journal");
    let mut out = Vec::new();
    for v in raw
        .iter()
        .map(|p| serde_json::from_slice::<Value>(p).expect("record"))
    {
        let items = v["record"]["items"].as_array().cloned();
        for e in items.unwrap_or_else(|| vec![v.clone()]) {
            let kind = e["record"]["kind"].as_str().unwrap_or("").to_string();
            let seq = e["seq"].as_str().unwrap_or("").to_string();
            if kind != "journalHeader" {
                out.push((seq, kind, e["record"]["comment"].clone()));
            }
        }
    }
    out
}

#[test]
fn a_startup_rewrite_that_prunes_a_thread_keeps_every_survivor_unchanged() {
    let (r, page) = rig();
    let (a, b) = on_a_then_b(&r, &page);
    reply(&r, &page, b, 0, "a reply on B").expect("reply");
    let gone = comment_of(&create(&r, &page, "deleted").expect("create"));
    user(&r, Action::Resolve, gone, 0).expect("resolve");
    user(&r, Action::Delete, gone, 1).expect("delete");
    let live = r.c.writer.lock().proj.clone();
    let (dir, pages) = close(r);
    let before = flat(dir.path());
    let survivors: Vec<_> = before
        .iter()
        .filter(|(_, _, c)| *c != json!(gone))
        .cloned()
        .collect();
    assert!(
        survivors.len() < before.len(),
        "the deleted thread has records"
    );

    let rewritten = {
        let (w, _) = Writer::open(fast_config(dir.path())).expect("replay");
        assert_eq!(w.lock().proj, live, "live equals replay");
        w.collect_startup(&GcPolicy::default())
            .expect("startup rewrite");
        let p = w.lock().proj.clone();
        p
    };
    assert!(!rewritten.comments.threads.contains_key(&gone), "pruned");
    for c in [a, b] {
        assert_eq!(rewritten.comments.threads[&c], live.comments.threads[&c]);
    }
    let after = flat(dir.path());
    assert_eq!(
        after, survivors,
        "every surviving record and item keeps its seq"
    );
    let (r, page) = rig_at(dir, pages);
    assert_eq!(r.c.writer.lock().proj, rewritten, "replay of the rewrite");
    let next = comment_of(&create(&r, &page, "after the rewrite").expect("create"));
    assert!(next.seq() > gone.seq(), "ids are never reused");
}

#[test]
fn a_create_whose_baseline_is_refused_appends_nothing() {
    let (r, page) = rig();
    let len = r.journal_len();
    let mut b = create_body(&r, TEXT, SEL, "on a forged observation");
    b["observedParent"] = json!({ "ref": "pending", "observation": uuid::Uuid::new_v4() });
    let p = r.frame(&page, b);
    let e = create_as(&r, &page, CommentCaller::User, &p).unwrap_err();
    assert_eq!(
        code(&e),
        "INVALID_REQUEST",
        "the observed parent is unknown: {e:?}"
    );
    let mut b = create_body(&r, TEXT, SEL, "on a revision never journaled");
    b["parent"] = json!(uuid::Uuid::new_v4());
    let p = r.frame(&page, b);
    assert_eq!(
        code(&create_as(&r, &page, CommentCaller::User, &p).unwrap_err()),
        "STALE_PARENT"
    );
    assert_eq!(r.journal_len(), len, "a refused create appends nothing");
    assert!(r.c.writer.lock().proj.comments.threads.is_empty());
    assert_eq!(head(&r), None, "no baseline was recorded");
}

/// Whether `message` refuses a record for its `version` label: the v1
/// decoder names the version it read, later ones the label they refused.
fn labelled(message: &str, version: u32) -> bool {
    message.contains(&format!("labelled schemaVersion {version}"))
        || message.contains(&format!("is not a v{version} record kind"))
}

#[test]
fn every_real_schema_5_carrier_labelled_1_to_4_is_corrupt() {
    let (r, _) = carrier_journal();
    let carriers = v5_records(&r);
    assert_eq!(carriers.len(), 5);
    for v in &carriers {
        assert!(
            codec::decode(&serde_json::to_vec(v).unwrap()).is_ok(),
            "{v}"
        );
        for version in 1..=4 {
            let kind = &v["record"]["kind"];
            let err = codec::decode(&serde_json::to_vec(&relabel(v, version)).unwrap())
                .err()
                .unwrap_or_else(|| panic!("{kind} labelled {version} decoded"));
            assert_eq!(
                err.code(),
                "JOURNAL_CORRUPT",
                "{kind} labelled {version}: {err}"
            );
            assert!(
                labelled(&err.to_string(), version),
                "{kind} labelled {version} is refused for its label, not another defect: {err}"
            );
        }
    }
}
