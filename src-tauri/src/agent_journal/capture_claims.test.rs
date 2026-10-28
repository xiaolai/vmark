// WI-AL1.4 — save capture: who wrote the saved text (author) vs who asked for the save (initiator), and when a save may be journaled at the head without an observation. Text equality alone never elides a save (a save is a snapshotOnly barrier for live hunks); only a claimed revision the writer verifies does, and validation of the initiator, author and observed_parent runs before that elision. A pending_observation whose linearization fails to append is retried in the background (and at startup) without another command.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};

use super::actor::Actor;
use super::capture::JournaledFlag;
use super::capture_tests::{agent_write, eventually, journal_code, rev, setup};
use super::ids::{DocId, RevisionId};
use super::projection::RevisionKind;
use super::record::{Envelope, ObservedRef, Record};
use super::service::{AgentJournalState, Started};
use super::test_support::*;
use super::writer::ObserveRequest;

/// A capture payload with every optional field spelled out.
fn payload(
    observed: Option<ObservedRef>,
    post: &str,
    initiator: &Actor,
    author: Option<&Actor>,
    claims: Option<RevisionId>,
) -> String {
    let mut v = json!({
        "docKey": "path:/a.md",
        "window": "main/t1",
        "observedParent": observed,
        "postimage": post,
        "initiator": initiator,
    });
    if let Some(a) = author {
        v["author"] = serde_json::to_value(a).unwrap();
    }
    if let Some(c) = claims {
        v["claimsRevision"] = serde_json::to_value(c).unwrap();
    }
    v.to_string()
}

#[test]
fn a_save_claiming_the_head_it_holds_is_journaled_yes_at_the_head_and_appends_nothing() {
    let (_dir, w, c, _) = setup();
    let h = agent_write(&c, "path:/a.md", None, "", "hello");
    let before = w.journal_len();
    let out = c
        .capture(&payload(rev(h), "hello", &agent(), Some(&agent()), Some(h)))
        .unwrap();
    assert_eq!(out.journaled, JournaledFlag::Yes);
    assert_eq!((out.revision, out.observation), (Some(h), None));
    assert_eq!(w.journal_len(), before, "nothing appended");
    let wire: Value = serde_json::to_value(out).unwrap();
    assert_eq!(wire["journaled"], "yes");
}

#[test]
fn a_save_equal_to_the_head_without_a_claim_is_still_observed() {
    let (_dir, w, c, _) = setup();
    let h = agent_write(&c, "path:/a.md", None, "", "hello");
    let out = c
        .capture(&payload(rev(h), "hello", &Actor::Human, None, None))
        .unwrap();
    let lin = out.revision.expect("linearized");
    assert_ne!(lin, h, "a new revision, not the head");
    let s = w.snapshot().state;
    assert_eq!(
        (s.revisions[&lin].kind, s.revisions[&lin].parent),
        (RevisionKind::Observed, Some(h))
    );
    assert!(out.observation.is_some());
}

#[test]
fn a_claim_the_writer_cannot_verify_is_ignored_and_the_save_observed() {
    let (_dir, w, c, _) = setup();
    let h1 = agent_write(&c, "path:/a.md", None, "", "one");
    let h2 = agent_write(&c, "path:/a.md", Some(h1), "one", "two");
    // Claims an older revision whose text matches: not the head.
    let stale = c
        .capture(&payload(rev(h1), "one", &Actor::Human, None, Some(h1)))
        .unwrap();
    assert!(stale.observation.is_some(), "not elided");
    // Claims the head with different text.
    let head = w.head(w.snapshot().state.revisions[&h2].doc).unwrap();
    let differs = c
        .capture(&payload(
            rev(head),
            "three",
            &Actor::Human,
            None,
            Some(head),
        ))
        .unwrap();
    assert!(differs.observation.is_some(), "not elided");
}

#[test]
fn validation_runs_before_elision() {
    let (_dir, _w, c, _) = setup();
    let h = agent_write(&c, "path:/a.md", None, "", "hello");
    let unknown = payload(
        rev(RevisionId::new()),
        "hello",
        &Actor::Human,
        None,
        Some(h),
    );
    assert_eq!(
        journal_code(&c.capture(&unknown).unwrap_err()),
        "INVALID_REQUEST"
    );
    let mut long = agent();
    if let Actor::Mcp { session_label, .. } = &mut long {
        *session_label = Some("长".repeat(50)); // 150 UTF-8 bytes
    }
    let too_long = payload(rev(h), "hello", &long, None, Some(h));
    assert_eq!(
        journal_code(&c.capture(&too_long).unwrap_err()),
        "INVALID_REQUEST"
    );
    let long_author = payload(rev(h), "hello", &Actor::Human, Some(&long), Some(h));
    assert_eq!(
        journal_code(&c.capture(&long_author).unwrap_err()),
        "INVALID_REQUEST"
    );
}

#[test]
fn the_author_is_recorded_apart_from_the_initiator_and_defaults_to_the_human() {
    let (_dir, w, c, _) = setup();
    let h = agent_write(&c, "path:/a.md", None, "", "base");
    // An agent's write whose commit was refused, persisted by its own save.
    let by_agent = c
        .capture(&payload(
            rev(h),
            "agent text 🙂",
            &agent(),
            Some(&agent()),
            Some(h),
        ))
        .unwrap();
    let s = w.snapshot().state;
    let o = &s.observations[&by_agent.observation.unwrap()];
    assert!(matches!(o.actor, Actor::Mcp { .. }), "author: the agent");
    assert!(matches!(o.initiator, Actor::Mcp { .. }));
    // A person's save: author defaults to the human.
    let by_human = c
        .capture(&payload(None, "人写的", &Actor::Human, None, None))
        .unwrap();
    let s = w.snapshot().state;
    assert_eq!(
        s.observations[&by_human.observation.unwrap()].actor,
        Actor::Human
    );
}

#[test]
fn a_legacy_or_system_author_is_refused() {
    let (_dir, _w, c, _) = setup();
    for author in [
        Actor::Legacy,
        Actor::System {
            reason: "autosave".into(),
        },
    ] {
        let p = payload(None, "x", &Actor::Human, Some(&author), None);
        assert_eq!(
            journal_code(&c.capture(&p).unwrap_err()),
            "INVALID_REQUEST",
            "{author:?}"
        );
    }
}

/// Fail every linearization append while `failing` holds.
fn fail_linearizations(faults: &Arc<super::faults::Faults>) -> Arc<AtomicBool> {
    let failing = Arc::new(AtomicBool::new(true));
    let (f, on) = (faults.clone(), failing.clone());
    faults.set_append_hook(Some(Arc::new(move |env: &Envelope| {
        let lin = matches!(
            env.record,
            Record::ObservedRevision { .. }
                | Record::ConcurrentObservation { .. }
                | Record::Gap { .. }
        );
        if lin && on.load(Ordering::SeqCst) {
            f.fail_next_appends(1);
        }
    })));
    failing
}

fn linearized(w: &super::writer::Writer, obs: super::ids::TxnId) -> bool {
    w.snapshot()
        .state
        .observations
        .get(&obs)
        .is_some_and(|o| o.linearized.is_some())
}

#[test]
fn a_linearization_that_fails_to_append_is_retried_without_another_command() {
    let (_dir, w, c, faults) = setup();
    let h = agent_write(&c, "path:/a.md", None, "", "base");
    let failing = fail_linearizations(&faults);
    let out = c
        .capture(&payload(rev(h), "base 改", &Actor::Human, None, None))
        .unwrap();
    assert_eq!(
        out.journaled,
        JournaledFlag::Pending,
        "durable, not linearized"
    );
    let obs = out.observation.unwrap();
    failing.store(false, Ordering::SeqCst);
    eventually(|| linearized(&w, obs));
}

#[test]
fn startup_hands_documents_still_holding_pending_saves_to_the_retry() {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let w = Arc::new(w);
    let doc = DocId::new();
    let failing = fail_linearizations(&faults);
    let obs = w
        .observe(ObserveRequest {
            doc,
            actor: Actor::Human,
            initiator: Actor::Human,
            postimage: "saved before the crash".into(),
            observed_parent: ObservedRef::Genesis,
            provenance: None,
        })
        .unwrap()
        .observation;
    assert!(!linearized(&w, obs));
    failing.store(false, Ordering::SeqCst);
    let state = AgentJournalState::default();
    state.finish(Ok(Started {
        writer: w.clone(),
        journal_dir: dir.path().to_path_buf(),
        open: Default::default(),
        legacy: Ok(Default::default()),
        retirement: super::service::LegacyRetirement::Absent,
        gc: Default::default(),
    }));
    eventually(|| linearized(&w, obs));
}

/// A claimed head the writer verifies becomes the window's base root in the
/// same critical section: a commit and a collection landing between the
/// check and the registration must not collect the revision the reply names.
#[test]
fn a_verified_claim_pins_its_head_before_a_racing_commit_and_collection() {
    use super::capture::{capture_save, CaptureRequest};
    use super::gc_policy::GcPolicy;
    for k in 1..=4 {
        let dir = tmp();
        let (w, faults) = open_fast(dir.path());
        let doc = DocId::new();
        let h1 = human_save(&w, doc, "one");
        let req = CaptureRequest {
            doc_key: "path:/a.md".into(),
            window: "main/t1".into(),
            observed_parent: rev(h1),
            postimage: "one".into(),
            initiator: Actor::Human,
            author: None,
            claims_revision: Some(h1),
            provenance: None,
            capture: None,
        };
        let policy = GcPolicy {
            max_revisions: 1,
            ..GcPolicy::default()
        };
        let (out, _, _) = interleave(
            &faults,
            k,
            // A refusal (the observed parent already collected) is fine.
            || capture_save(&w, doc, req).ok(),
            || {
                human_save(&w, doc, "two");
                w.collect(&policy).expect("collect");
            },
        );
        let Some(out) = out else { continue };
        if let (JournaledFlag::Yes, Some(r), None) = (out.journaled, out.revision, out.observation)
        {
            let s = w.snapshot().state;
            assert!(
                !s.revisions[&r].collected,
                "lock {k}: the elided save's revision {r:?} was collected"
            );
        }
    }
}
