// WI-AL1.4 — observational capture of saves through the command side: journaled yes/pending/no, author (human) vs initiator, a save during a held prepare linearized as a concurrent_observation after the commit with observed_parent and observed_preimage kept, a pending_observation chain H → B1 → B2 surviving a crash and linearized in order at startup, observed_parent and observed_preimage as GC roots (pending and revision cases), and a capture failure answering journaled no until the drainer lands it
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::json;

use super::actor::Actor;
use super::capture::JournaledFlag;
use super::controlled::commit_controlled;
use super::controller::Controller;
use super::degraded_drain::{Backoff, DrainScheduler};
use super::faults::Faults;
use super::ids::{BlobHash, DocId, RevisionId, TxnId};
use super::pins::PinReason;
use super::projection::RevisionKind;
use super::record::ObservedRef;
use super::service::start;
use super::test_support::*;
use super::writer::Writer;

pub(super) fn controller_for(w: Arc<Writer>) -> Controller {
    let drains = DrainScheduler::new(Backoff {
        first: Duration::from_millis(1),
        max: Duration::from_millis(4),
    });
    Controller::new(w, Arc::default(), Arc::new(drains))
}

pub(super) fn setup() -> (tempfile::TempDir, Arc<Writer>, Controller, Arc<Faults>) {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let w = Arc::new(w);
    let c = controller_for(w.clone());
    (dir, w, c, faults)
}

pub(super) fn prepare(c: &Controller, key: &str, parent: Option<RevisionId>, pre: &str) -> TxnId {
    let payload = json!({
        "docKey": key,
        "parent": parent,
        "preimage": pre,
        "actor": agent(),
        "tool": "document.write",
    });
    c.prepare(&payload.to_string()).expect("prepare").txn
}

/// An agent write of `post` on `key`; returns the committed revision.
pub(super) fn agent_write(
    c: &Controller,
    key: &str,
    parent: Option<RevisionId>,
    pre: &str,
    post: &str,
) -> RevisionId {
    let txn = prepare(c, key, parent, pre);
    let out = c
        .commit(
            &txn.0.to_string(),
            &json!({ "postimage": post }).to_string(),
        )
        .expect("commit");
    out.revision
}

pub(super) fn capture_payload(
    key: &str,
    window: &str,
    observed: Option<ObservedRef>,
    post: &str,
    initiator: &Actor,
) -> String {
    json!({
        "docKey": key,
        "window": window,
        "observedParent": observed,
        "postimage": post,
        "initiator": initiator,
    })
    .to_string()
}

pub(super) fn rev(revision: RevisionId) -> Option<ObservedRef> {
    Some(ObservedRef::Revision { revision })
}

pub(super) fn eventually(mut f: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !f() {
        assert!(Instant::now() < deadline, "condition never held");
        std::thread::sleep(Duration::from_millis(2));
    }
}

pub(super) fn journal_code(e: &crate::command_error::CommandError) -> String {
    e.detail().expect("detail")["journalCode"]
        .as_str()
        .expect("journalCode")
        .to_owned()
}

#[test]
fn a_human_save_after_an_agent_write_is_journaled_yes_with_author_human_and_initiator_kept() {
    let (_dir, w, c, _) = setup();
    let h = agent_write(&c, "path:/a.md", None, "", "hello");
    // An agent's document.save persists the human's edit: author human, initiator the agent.
    let initiator = agent();
    let out = c
        .capture(&capture_payload(
            "path:/a.md",
            "main/t1",
            rev(h),
            "hello 世界 👋",
            &initiator,
        ))
        .unwrap();
    assert_eq!(out.journaled, JournaledFlag::Yes);
    let revision = out.revision.expect("linearized");
    let obs = out.observation.expect("observed");
    let s = w.snapshot().state;
    assert_eq!(s.observations[&obs].actor, Actor::Human, "author");
    assert_eq!(s.observations[&obs].initiator, initiator, "initiator");
    assert_eq!(s.observations[&obs].linearized, Some(revision));
    let meta = &s.revisions[&revision];
    assert_eq!((meta.kind, meta.parent), (RevisionKind::Observed, Some(h)));
    assert_eq!(meta.postimage, BlobHash::of_text("hello 世界 👋"));
    assert_eq!(s.docs[&meta.doc].head, Some(revision));
}

#[test]
fn a_save_with_no_observed_parent_is_based_on_the_head_or_genesis() {
    let (_dir, w, c, _) = setup();
    let out = c
        .capture(&capture_payload(
            "path:/new.md",
            "main/t1",
            None,
            "first",
            &Actor::Human,
        ))
        .unwrap();
    assert_eq!(out.journaled, JournaledFlag::Yes);
    let s = w.snapshot().state;
    let obs = out.observation.unwrap();
    assert_eq!(s.observations[&obs].observed_parent, ObservedRef::Genesis);
    let first = out.revision.unwrap();
    let next = c
        .capture(&capture_payload(
            "path:/new.md",
            "main/t1",
            None,
            "second",
            &Actor::Human,
        ))
        .unwrap();
    let s = w.snapshot().state;
    assert_eq!(
        s.observations[&next.observation.unwrap()].observed_parent,
        ObservedRef::Revision { revision: first }
    );
    assert_eq!(
        s.revisions[&next.revision.unwrap()].kind,
        RevisionKind::Observed
    );
}

#[test]
fn a_save_during_a_held_prepare_is_pending_then_a_concurrent_observation_after_the_commit() {
    let (_dir, w, c, _) = setup();
    let h = agent_write(&c, "path:/a.md", None, "", "base");
    // Window A holds the document; window B saves the same file meanwhile.
    let txn = prepare(&c, "path:/a.md", Some(h), "base");
    let out = c
        .capture(&capture_payload(
            "path:/a.md",
            "other/t9",
            rev(h),
            "base + B",
            &Actor::Human,
        ))
        .unwrap();
    assert_eq!(
        out.journaled,
        JournaledFlag::Pending,
        "queued behind the reservation"
    );
    assert_eq!(out.revision, None);
    let obs = out.observation.unwrap();
    // Pending case: observed_parent's text and the postimage are GC roots.
    let pins = w.pins();
    assert!(
        pins.blobs.contains(&BlobHash::of_text("base")),
        "observed_preimage pinned"
    );
    assert!(
        pins.blobs.contains(&BlobHash::of_text("base + B")),
        "pending postimage pinned"
    );
    let committed = c
        .commit(
            &txn.0.to_string(),
            &json!({ "postimage": "AGENT" }).to_string(),
        )
        .unwrap();
    // The commit settles the reservation, then the save linearizes.
    let s = w.snapshot().state;
    let lin = s.observations[&obs]
        .linearized
        .expect("linearized after the commit");
    let meta = &s.revisions[&lin];
    assert_eq!(meta.kind, RevisionKind::Concurrent);
    assert_eq!(meta.parent, Some(committed.revision), "linear parent");
    assert_eq!(
        meta.preimage,
        Some(BlobHash::of_text("base")),
        "observed before-text"
    );
    assert_eq!(
        s.observations[&obs].observed_parent,
        ObservedRef::Revision { revision: h }
    );
    // Revision case: the window's base resolves to the linearized revision,
    // which keeps its observed_preimage and its linear before-text.
    let pins = w.pins();
    assert!(pins.revisions[&lin].contains(&PinReason::WindowBase("other/t9".into())));
    assert!(pins.blobs.contains(&BlobHash::of_text("base")));
    assert!(pins.blobs.contains(&BlobHash::of_text("AGENT")));
}

#[test]
fn a_save_during_a_prepare_that_aborts_linearizes_as_an_ordinary_revision() {
    let (_dir, w, c, _) = setup();
    let h = agent_write(&c, "k", None, "", "base");
    let txn = prepare(&c, "k", Some(h), "base");
    let out = c
        .capture(&capture_payload(
            "k",
            "main/t1",
            rev(h),
            "base!",
            &Actor::Human,
        ))
        .unwrap();
    assert_eq!(out.journaled, JournaledFlag::Pending);
    c.abort(&txn.0.to_string(), "edited").unwrap();
    let s = w.snapshot().state;
    let lin = s.observations[&out.observation.unwrap()]
        .linearized
        .unwrap();
    assert_eq!(
        (s.revisions[&lin].kind, s.revisions[&lin].parent),
        (RevisionKind::Observed, Some(h))
    );
}

#[test]
fn a_pending_observation_chain_survives_a_crash_and_startup_linearizes_it_in_order() {
    let app = tmp();
    let (b1, b2, committed) = {
        let started = start(app.path()).unwrap();
        let c = controller_for(started.writer.clone());
        let h = agent_write(&c, "path:/a.md", None, "", "H");
        let txn = prepare(&c, "path:/a.md", Some(h), "H");
        let b1 = c
            .capture(&capture_payload(
                "path:/a.md",
                "w2/t",
                rev(h),
                "H1",
                &Actor::Human,
            ))
            .unwrap();
        let b2 = c
            .capture(&capture_payload(
                "path:/a.md",
                "w2/t",
                Some(ObservedRef::Pending {
                    observation: b1.observation.unwrap(),
                }),
                "H12",
                &Actor::Human,
            ))
            .unwrap();
        assert_eq!(
            (b1.journaled, b2.journaled),
            (JournaledFlag::Pending, JournaledFlag::Pending)
        );
        // The commit lands; the process dies before anything linearizes.
        let done = commit_controlled(&started.writer, txn, br#"{"postimage":"HC"}"#).unwrap();
        (
            b1.observation.unwrap(),
            b2.observation.unwrap(),
            done.revision,
        )
    };
    let restarted = start(app.path()).unwrap();
    let s = restarted.writer.snapshot().state;
    let l1 = s.observations[&b1]
        .linearized
        .expect("B1 linearized at startup");
    let l2 = s.observations[&b2]
        .linearized
        .expect("B2 linearized at startup");
    let (r1, r2) = (&s.revisions[&l1], &s.revisions[&l2]);
    assert_eq!(
        (r1.kind, r1.parent),
        (RevisionKind::Concurrent, Some(committed))
    );
    assert_eq!(r1.preimage, Some(BlobHash::of_text("H")));
    assert_eq!(
        (r2.kind, r2.parent),
        (RevisionKind::Observed, Some(l1)),
        "B2 after B1"
    );
    assert_eq!(
        r2.preimage,
        Some(BlobHash::of_text("H1")),
        "B2's before-text is B1"
    );
    assert!(s.docs.values().all(|d| d.pending.is_empty()));
}

#[test]
fn a_capture_append_failure_answers_journaled_no_and_the_drainer_lands_and_linearizes_it() {
    let (_dir, w, c, faults) = setup();
    let h = agent_write(&c, "k", None, "", "base");
    faults.fail_next_appends(1);
    let out = c
        .capture(&capture_payload(
            "k",
            "main/t1",
            rev(h),
            "base saved",
            &Actor::Human,
        ))
        .unwrap();
    assert_eq!(out.journaled, JournaledFlag::No);
    assert_eq!(out.revision, None);
    let obs = out.observation.expect("queued observation id");
    assert!(
        w.pins().blobs.contains(&BlobHash::of_text("base saved")),
        "queued capture is a root"
    );
    eventually(|| {
        w.snapshot()
            .state
            .observations
            .get(&obs)
            .is_some_and(|o| o.linearized.is_some())
    });
    assert!(!w.is_degraded(w.snapshot().state.observations[&obs].doc));
}

#[test]
fn a_capture_failure_refusal_carries_its_journal_code() {
    let (_dir, _w, c, _) = setup();
    // What JSON.stringify emits for a JS string holding an unpaired surrogate.
    let bad = capture_payload("k", "main/t1", None, "PLACEHOLDER", &Actor::Human)
        .replace("PLACEHOLDER", r"\ud800");
    assert_eq!(journal_code(&c.capture(&bad).unwrap_err()), "INVALID_TEXT");
    let legacy = capture_payload("k", "main/t1", None, "x", &Actor::Legacy);
    assert_eq!(
        journal_code(&c.capture(&legacy).unwrap_err()),
        "INVALID_REQUEST"
    );
    let no_window = capture_payload("k", "", None, "x", &Actor::Human);
    assert_eq!(
        journal_code(&c.capture(&no_window).unwrap_err()),
        "INVALID_REQUEST"
    );
    let unknown = capture_payload("k", "main/t1", rev(RevisionId::new()), "x", &Actor::Human);
    assert_eq!(
        journal_code(&c.capture(&unknown).unwrap_err()),
        "INVALID_REQUEST"
    );
    let extra = json!({"docKey": "k", "window": "w", "postimage": "x", "initiator": {"type": "human"}, "editor": "mcp"});
    assert_eq!(
        journal_code(&c.capture(&extra.to_string()).unwrap_err()),
        "INVALID_REQUEST"
    );
}

/// Before the `n`-th next writer lock, linearize one pending observation
/// behind the pass's back (moving the head under it), then re-arm `left`
/// more times, each `every` locks later.
fn race_every(w: Arc<Writer>, faults: Arc<Faults>, doc: DocId, n: u32, every: u32, left: u32) {
    let (w2, f2) = (w.clone(), faults.clone());
    faults.before_nth_lock(
        n,
        Some(Box::new(move || {
            linearize(&w2, doc);
            if left > 1 {
                race_every(w2.clone(), f2.clone(), doc, every, every, left - 1);
            }
        })),
    );
}

/// `STALE_RETRIES` bounds consecutive head races: a pass whose races are
/// each followed by a landed observation keeps going until nothing is left.
#[test]
fn head_races_separated_by_landed_observations_do_not_end_the_pass() {
    use super::capture::linearize_pending;
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let w = Arc::new(w);
    let doc = DocId::new();
    for i in 0..8 {
        observe(&w, doc, &format!("save {i}"), None);
    }
    // Each pass iteration reads the head (one lock), then linearizes (one
    // lock): a race before every other iteration's second lock.
    race_every(w.clone(), faults.clone(), doc, 2, 4, 4);
    let out = linearize_pending(&w, doc);
    faults.before_nth_lock(0, None);
    assert_eq!(w.snapshot().state.docs[&doc].pending.len(), 0, "{out:?}");
    assert_eq!((out.landed, out.retry), (4, false));
}

/// A save of `doc` by window `main/t1`, based on its head, optionally
/// claiming the revision `claims` holds the text already.
fn window_save(
    w: &Writer,
    doc: DocId,
    text: &str,
    claims: Option<RevisionId>,
) -> super::capture::CaptureReply {
    let req = super::capture::CaptureRequest {
        doc_key: format!("path:/{text}.md"),
        window: "main/t1".into(),
        observed_parent: None,
        postimage: text.into(),
        initiator: Actor::Human,
        author: None,
        claims_revision: claims,
        provenance: None,
        capture: None,
    };
    super::capture::capture_save(w, doc, req).expect("capture")
}

/// A window's base root moves with its append, in one critical section,
/// and only then: whichever writer lock a later save by the same window
/// lands on (here one of another document, elided at its head), the base
/// stays with the later save.
#[test]
fn a_window_base_follows_the_later_of_two_saves_whatever_lock_they_race_on() {
    for k in 1..16 {
        let dir = tmp();
        let (w, faults) = open_fast(dir.path());
        let (one, two) = (DocId::new(), DocId::new());
        let h2 = human_save(&w, two, "two");
        let appended = |doc| w.lock().proj.observations.values().any(|o| o.doc == doc);
        let (_, elided_after_one, _) = interleave(
            &faults,
            k,
            || window_save(&w, one, "one", None),
            || {
                let after = appended(one);
                let out = window_save(&w, two, "two", Some(h2));
                assert_eq!(out.observation, None, "lock {k}: elided");
                after
            },
        );
        let later = if elided_after_one { two } else { one };
        let held = w.lock().window_bases.get("main/t1").map(|(doc, _)| *doc);
        assert_eq!(held, Some(later), "lock {k}");
    }
}
