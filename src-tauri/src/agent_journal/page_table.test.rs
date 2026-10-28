// WI-AL2.2f — the page table: a writer's incarnation is readable without the writer lock and reported in the status; page generations come from one process counter that never resets or wraps; registration is live only for its label and identity, replaced atomically with `replaces`, revoked by `started` and `destroy`, and capped per label
//! R86, R90, R92, R99 and R100 through the `PageTable` core methods.

use std::sync::mpsc;
use std::time::Duration;

use serde_json::json;

use crate::agent_journal::admission::admission_support::{controller, journal_code};
use crate::agent_journal::admission::identity::PageIdentity;
use crate::agent_journal::admission::owned::OwnedEnd;
use crate::agent_journal::admission::page_table::{Liveness, PageTable, Registration};
use crate::agent_journal::admission::request_support::{rig, state, txn_of, Page};
use crate::agent_journal::ids::RevisionId;
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::service::{AgentJournalState, Started};
use crate::agent_journal::writer::Writer;
use crate::command_error::CommandError;

const L: &str = "doc-1";

/// Page identity `n` (32 hex digits).
pub(crate) fn ident(n: u32) -> String {
    format!("{n:032x}")
}

fn reg(t: &PageTable, w: &Writer, label: &str, id: u32) -> Result<Registration, CommandError> {
    t.register(Some(w), label, &ident(id), None)
}

fn live(t: &PageTable, label: &str, r: &Registration) -> Liveness {
    t.liveness(label, r.webview_generation, &r.page_identity)
}

fn pid(n: u32) -> PageIdentity {
    PageIdentity::parse(&ident(n)).unwrap()
}

fn is_hex32(s: &str) -> bool {
    s.len() == 32
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[test]
fn incarnation_is_readable_without_the_writer_lock() {
    let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (ca, _) = controller(a.path());
    let (cb, _) = controller(b.path());
    let w = ca.writer.clone();
    let inc = w.incarnation().to_string();
    assert!(is_hex32(&inc), "{inc}");
    assert_ne!(inc, cb.writer.incarnation().to_string());

    let held = w.lock();
    let (tx, rx) = mpsc::channel();
    let reader = w.clone();
    std::thread::spawn(move || tx.send(reader.incarnation().to_string()).unwrap());
    let read = rx.recv_timeout(Duration::from_secs(5));
    drop(held);
    assert_eq!(
        read.as_deref(),
        Ok(inc.as_str()),
        "read while the lock was held"
    );

    let state = AgentJournalState::default();
    state.finish(Ok(Started {
        writer: w.clone(),
        journal_dir: a.path().to_path_buf(),
        open: Default::default(),
        legacy: Ok(Default::default()),
        retirement: crate::agent_journal::service::LegacyRetirement::Absent,
        gc: Default::default(),
    }));
    let status = serde_json::to_value(state.status()).unwrap();
    assert_eq!(status["incarnation"], serde_json::json!(inc));
    assert_eq!(status["registrationCapRefusals"], serde_json::json!(0));
}

#[test]
fn the_generation_counter_is_not_reset_by_a_new_writer() {
    let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let ((ca, _), (cb, _)) = (controller(a.path()), controller(b.path()));
    let t = PageTable::default();
    t.started(L);
    let first = reg(&t, &ca.writer, L, 1).unwrap();
    assert_eq!(first.webview_generation, 1, "the counter starts at 1");
    assert_eq!(&first.incarnation, ca.writer.incarnation());
    t.started(L);
    let second = reg(&t, &cb.writer, L, 2).unwrap();
    assert_eq!(
        second.webview_generation, 2,
        "a new writer does not reset it"
    );
    assert_eq!(&second.incarnation, cb.writer.incarnation());
    assert_eq!(
        second.wire(),
        json!({
            "bind": { "pageIdentity": ident(2) },
            "reply": { "incarnation": cb.writer.incarnation().to_string(),
                       "webviewGeneration": "2", "pageIdentity": ident(2) },
        })
    );
}

#[test]
fn the_same_identity_twice_in_one_epoch_returns_the_same_generation() {
    let d = tempfile::tempdir().unwrap();
    let (c, _) = controller(d.path());
    let t = PageTable::default();
    t.started(L);
    let one = reg(&t, &c.writer, L, 1).unwrap();
    let again = reg(&t, &c.writer, L, 1).unwrap();
    assert_eq!(one.webview_generation, again.webview_generation);
    assert_eq!(t.registrations(L), 1);
    assert_eq!(
        reg(&t, &c.writer, L, 2).unwrap().webview_generation,
        2,
        "nothing minted twice"
    );
}

#[test]
fn a_registration_for_an_unknown_or_destroyed_label_creates_nothing() {
    let d = tempfile::tempdir().unwrap();
    let (c, _) = controller(d.path());
    let t = PageTable::default();
    let stale = |e: CommandError| {
        assert_eq!(journal_code(&e), "STALE_REQUEST");
        let detail = e.detail().unwrap();
        assert_eq!(
            (detail["uncertain"].clone(), detail["state"].clone()),
            (json!(true), json!("staleGeneration"))
        );
    };
    stale(reg(&t, &c.writer, "never-opened", 1).unwrap_err());
    t.started(L);
    let g = reg(&t, &c.writer, L, 1).unwrap();
    t.destroy(L);
    assert_eq!(live(&t, L, &g), Liveness::Dead);
    stale(reg(&t, &c.writer, L, 2).unwrap_err());
    assert_eq!(t.registrations(L), 0);
    t.started(L);
    assert_eq!(
        reg(&t, &c.writer, L, 3).unwrap().webview_generation,
        2,
        "nothing was minted"
    );
}

#[test]
fn registration_before_the_writer_opens_is_unavailable_and_mints_nothing() {
    let d = tempfile::tempdir().unwrap();
    let (c, _) = controller(d.path());
    let t = PageTable::default();
    t.started(L);
    let e = t.register(None, L, &ident(1), None).unwrap_err();
    assert_eq!(journal_code(&e), "JOURNAL_UNAVAILABLE");
    assert_eq!(t.registrations(L), 0);
    assert_eq!(reg(&t, &c.writer, L, 1).unwrap().webview_generation, 1);
}

#[test]
fn a_malformed_identity_or_replaces_is_invalid_and_mints_nothing() {
    let d = tempfile::tempdir().unwrap();
    let (c, _) = controller(d.path());
    let t = PageTable::default();
    t.started(L);
    let x = ident(1);
    for (id, replaces) in [
        ("ABCDEF0123456789abcdef0123456789", None),
        (&x[..31], None),
        (x.as_str(), Some(("nothex", "1"))),
        (x.as_str(), Some((x.as_str(), "01"))),
        (x.as_str(), Some((x.as_str(), "18446744073709551616"))),
    ] {
        let e = t.register(Some(&c.writer), L, id, replaces).unwrap_err();
        assert_eq!(journal_code(&e), "INVALID_REQUEST", "{id} {replaces:?}");
    }
    assert_eq!(t.registrations(L), 0);
    assert_eq!(reg(&t, &c.writer, L, 1).unwrap().webview_generation, 1);
}

#[test]
fn replace_of_the_callers_live_unsealed_pair_is_atomic() {
    let d = tempfile::tempdir().unwrap();
    let (c, _) = controller(d.path());
    let t = PageTable::default();
    t.started(L);
    let old = reg(&t, &c.writer, L, 1).unwrap();
    let g1 = old.webview_generation.to_string();
    let replace = || t.register(Some(&c.writer), L, &ident(2), Some((&ident(1), &g1)));
    let new = replace().unwrap();
    assert_eq!(new.webview_generation, 2);
    assert_eq!(
        t.registrations(L),
        1,
        "the new registration took the old one's slot"
    );
    assert_eq!(live(&t, L, &old), Liveness::Dead);
    assert_eq!(live(&t, L, &new), Liveness::Own);
    let again = replace().unwrap();
    assert_eq!(
        again.webview_generation, 2,
        "a re-executed replace is idempotent"
    );
    assert_eq!(t.registrations(L), 1);
}

#[test]
fn replace_naming_a_dead_generation_registers_normally() {
    let d = tempfile::tempdir().unwrap();
    let (c, _) = controller(d.path());
    let t = PageTable::default();
    t.started(L);
    let old = reg(&t, &c.writer, L, 1).unwrap();
    t.started(L);
    let g1 = old.webview_generation.to_string();
    let new = t
        .register(Some(&c.writer), L, &ident(2), Some((&ident(1), &g1)))
        .unwrap();
    assert_eq!((new.webview_generation, t.registrations(L)), (2, 1));
    assert_eq!(live(&t, L, &old), Liveness::Dead);
    let never = t
        .register(Some(&c.writer), L, &ident(3), Some((&ident(9), "77")))
        .unwrap();
    assert_eq!(
        (never.webview_generation, t.registrations(L)),
        (3, 2),
        "a never-minted pair is dead too"
    );
}

#[test]
fn replace_of_a_foreign_pair_or_wrong_identity_is_invalid() {
    let d = tempfile::tempdir().unwrap();
    let (c, _) = controller(d.path());
    let t = PageTable::default();
    t.started(L);
    t.started("doc-2");
    let theirs = reg(&t, &c.writer, "doc-2", 1).unwrap();
    let mine = reg(&t, &c.writer, L, 2).unwrap();
    let (g_theirs, g_mine) = (
        theirs.webview_generation.to_string(),
        mine.webview_generation.to_string(),
    );
    for replaces in [
        (ident(1), g_theirs.clone()),
        (ident(1), g_mine.clone()),
        (ident(2), g_theirs),
    ] {
        let e = t
            .register(
                Some(&c.writer),
                L,
                &ident(3),
                Some((&replaces.0, &replaces.1)),
            )
            .unwrap_err();
        assert_eq!(journal_code(&e), "INVALID_REQUEST", "{replaces:?}");
    }
    assert_eq!((t.registrations(L), t.registrations("doc-2")), (1, 1));
    assert_eq!(live(&t, L, &mine), Liveness::Own);
    assert_eq!(live(&t, "doc-2", &theirs), Liveness::Own);
    assert_eq!(
        reg(&t, &c.writer, L, 3).unwrap().webview_generation,
        3,
        "nothing was minted"
    );
}

#[test]
fn liveness_names_the_label_and_identity_that_hold_a_generation() {
    let d = tempfile::tempdir().unwrap();
    let (c, _) = controller(d.path());
    let t = PageTable::default();
    t.started(L);
    t.started("doc-2");
    let r = reg(&t, &c.writer, L, 1).unwrap();
    assert_eq!(live(&t, L, &r), Liveness::Own);
    assert_eq!(
        t.liveness(L, r.webview_generation, &pid(2)),
        Liveness::OtherIdentity
    );
    assert_eq!(live(&t, "doc-2", &r), Liveness::OtherLabel);
    assert_eq!(t.liveness(L, 99, &pid(1)), Liveness::Dead);
    assert!(t.is_live(r.webview_generation) && !t.is_live(99));
}

#[test]
fn registration_cap_refuses_the_ninth_and_keeps_the_eight() {
    let d = tempfile::tempdir().unwrap();
    let (c, _) = controller(d.path());
    let t = PageTable::default();
    t.started(L);
    let eight: Vec<Registration> = (1..=8).map(|i| reg(&t, &c.writer, L, i).unwrap()).collect();
    let e = reg(&t, &c.writer, L, 9).unwrap_err();
    assert_eq!(journal_code(&e), "JOURNAL_BUSY");
    assert_eq!((t.registrations(L), t.registration_cap_refusals()), (8, 1));
    assert!(eight.iter().all(|r| live(&t, L, r) == Liveness::Own));
    assert_eq!(
        reg(&t, &c.writer, L, 3).unwrap().webview_generation,
        3,
        "a held identity is still answered"
    );
}

#[test]
fn seven_strays_then_the_live_page_registers_at_the_cap() {
    let d = tempfile::tempdir().unwrap();
    let (c, _) = controller(d.path());
    let t = PageTable::default();
    // Seven registers from earlier lifetimes are held, the live page's
    // `Started` fires, then the seven run.
    t.started(L);
    for i in 1..=7 {
        reg(&t, &c.writer, L, i).unwrap();
    }
    let page = reg(&t, &c.writer, L, 100).unwrap();
    assert_eq!(t.registrations(L), 8);
    assert_eq!(
        journal_code(&reg(&t, &c.writer, L, 8).unwrap_err()),
        "JOURNAL_BUSY"
    );
    t.started(L);
    assert_eq!(live(&t, L, &page), Liveness::Dead);
    let again = reg(&t, &c.writer, L, 101).unwrap();
    assert_eq!(
        (live(&t, L, &again), t.registrations(L)),
        (Liveness::Own, 1)
    );
}

#[test]
fn counter_at_max_refuses_without_wrap() {
    let d = tempfile::tempdir().unwrap();
    let (c, _) = controller(d.path());
    let t = PageTable::default();
    t.started(L);
    t.set_next(u64::MAX - 1);
    let last = reg(&t, &c.writer, L, 1).unwrap();
    assert_eq!(
        last.wire()["reply"]["webviewGeneration"],
        json!("18446744073709551614")
    );
    for id in [2, 3] {
        assert_eq!(
            journal_code(&reg(&t, &c.writer, L, id).unwrap_err()),
            "JOURNAL_BUSY"
        );
    }
    let g = last.webview_generation.to_string();
    let e = t
        .register(Some(&c.writer), L, &ident(4), Some((&ident(1), &g)))
        .unwrap_err();
    assert_eq!(journal_code(&e), "JOURNAL_BUSY", "a replace mints too");
    assert_eq!((t.registrations(L), live(&t, L, &last)), (1, Liveness::Own));
    assert_eq!(t.registration_cap_refusals(), 0, "not a cap refusal");
}

#[test]
fn repeated_restore_without_started_keeps_one_registration() {
    let d = tempfile::tempdir().unwrap();
    let (c, _) = controller(d.path());
    let t = PageTable::default();
    t.started(L);
    let mut pair = reg(&t, &c.writer, L, 1).unwrap();
    for i in 2..=21 {
        let g = pair.webview_generation.to_string();
        let prev = pair.page_identity.to_string();
        pair = t
            .register(Some(&c.writer), L, &ident(i), Some((&prev, &g)))
            .unwrap();
        assert_eq!(t.registrations(L), 1, "cycle {i}");
    }
}

#[test]
fn eight_strays_before_the_live_registration_lock_it_out_until_a_delivered_started() {
    let d = tempfile::tempdir().unwrap();
    let (c, _) = controller(d.path());
    let state = AgentJournalState::default();
    let t = state.pages();
    t.started(L);
    for i in 1..=8 {
        reg(t, &c.writer, L, i).unwrap();
    }
    for _ in 0..3 {
        assert_eq!(
            journal_code(&reg(t, &c.writer, L, 100).unwrap_err()),
            "JOURNAL_BUSY"
        );
    }
    assert_eq!(t.registration_cap_refusals(), 3);
    assert_eq!(state.status().registration_cap_refusals, 3);
    t.destroy(L);
    t.started(L);
    assert!(
        reg(t, &c.writer, L, 100).is_ok(),
        "a label recreate clears it"
    );
    for i in 1..=7 {
        reg(t, &c.writer, L, i).unwrap();
    }
    assert_eq!(
        journal_code(&reg(t, &c.writer, L, 101).unwrap_err()),
        "JOURNAL_BUSY"
    );
    t.started(L);
    assert!(
        reg(t, &c.writer, L, 101).is_ok(),
        "a delivered Started clears it"
    );
}

#[test]
fn a_registration_before_its_own_started_is_revoked_and_its_commit_refused() {
    // The late-own-Started race: X registers and prepares, then the
    // Started of its own document arrives.
    let r = rig();
    let x = r.page(L, 1);
    let txn = txn_of(&r.prepare(&x, &r.p(&x, None, "text")).expect("prepare"));
    r.pages.started(L);
    let len = r.journal_len();
    let e = r
        .commit(&x, txn, "text!")
        .expect_err("revoked by its own Started");
    assert_eq!(journal_code(&e), "STALE_PAGE");
    assert_eq!(r.journal_len(), len, "no committed record");
    assert_eq!(r.c.sweep(&r.pages), vec![(txn, OwnedEnd::Recorded)]);
    assert_eq!(r.status(txn), Some(TxnStatus::Uncommitted));
}

#[test]
fn a_reexecuted_registration_after_started_mints_a_new_generation() {
    let r = rig();
    let g1 = r.page(L, 1);
    let refused = r.p(&g1, Some(RevisionId::new()), "text");
    assert_eq!(
        state(&r.prepare(&g1, &refused).unwrap_err()),
        "notAdmitted",
        "fenced under G1"
    );
    r.pages.started(L);
    let g2 = r.register(L, 1);
    assert_eq!(g2.identity, g1.identity);
    assert_ne!(g2.generation, g1.generation);
    let e = r.prepare(&g1, &refused).expect_err("the replay under G1");
    assert_eq!(state(&e), "staleGeneration");
    assert_eq!(r.sizes().3, 0, "never admitted");
}

#[test]
fn replace_of_a_sealed_generation_is_atomic_and_takes_no_slot() {
    let r = rig();
    let a = r.page(L, 1);
    r.c.writer.lock().requests.set_limits(64, 2);
    for _ in 0..2 {
        assert_eq!(
            r.abandon(L, &r.p(&a, None, "text")).unwrap()["state"],
            "fenced"
        );
    }
    let sealed = a.generation.parse::<u64>().unwrap();
    assert!(r.c.writer.lock().requests.is_sealed(sealed));
    let stale = r.p(&a, None, "text");
    assert_eq!(
        state(&r.prepare(&a, &stale).unwrap_err()),
        "staleGeneration"
    );
    for i in 2..=8 {
        r.register(L, i);
    }
    assert_eq!(r.pages.registrations(L), 8, "the label is at its cap");

    let new = r
        .pages
        .register(
            Some(&r.c.writer),
            L,
            &ident(20),
            Some((&a.identity, &a.generation)),
        )
        .expect("a replace takes the sealed generation's slot");
    assert_eq!(
        (
            r.pages.registrations(L),
            r.pages.registration_cap_refusals()
        ),
        (8, 0)
    );
    assert_eq!(t_live(&r.pages, &a), Liveness::Dead);
    assert_eq!(live(&r.pages, L, &new), Liveness::Own);
    let b = Page {
        label: L.into(),
        identity: new.page_identity.to_string(),
        generation: new.webview_generation.to_string(),
    };
    r.prepare(&b, &r.p(&b, None, "text"))
        .expect("the successor admits");
    assert_eq!(
        state(&r.prepare(&a, &stale).unwrap_err()),
        "staleGeneration",
        "the old payload stays stale"
    );
}

fn t_live(t: &PageTable, p: &Page) -> Liveness {
    t.liveness(
        &p.label,
        p.generation.parse().unwrap(),
        &PageIdentity::parse(&p.identity).unwrap(),
    )
}

#[test]
fn eight_completed_registrations_across_dropped_started_block_ninth() {
    for clear_by_recreate in [false, true] {
        let d = tempfile::tempdir().unwrap();
        let (c, _) = controller(d.path());
        let t = PageTable::default();
        // One delivered Started; eight documents then load in the label and
        // each registers, their own Starteds dropped.
        t.started(L);
        for i in 1..=8 {
            reg(&t, &c.writer, L, i).unwrap();
        }
        for attempt in ["the ninth", "a retry"] {
            assert_eq!(
                journal_code(&reg(&t, &c.writer, L, 9).unwrap_err()),
                "JOURNAL_BUSY",
                "{attempt}"
            );
        }
        c.sweep(&t);
        assert_eq!(
            journal_code(&reg(&t, &c.writer, L, 9).unwrap_err()),
            "JOURNAL_BUSY",
            "after a sweep"
        );
        assert_eq!(t.registration_cap_refusals(), 3);
        if clear_by_recreate {
            t.destroy(L);
        }
        t.started(L);
        let ninth = reg(&t, &c.writer, L, 9).expect("cleared");
        assert_eq!(
            (live(&t, L, &ninth), t.registrations(L)),
            (Liveness::Own, 1)
        );
    }
}
