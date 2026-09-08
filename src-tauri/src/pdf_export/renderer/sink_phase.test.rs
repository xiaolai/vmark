// #227, #224 — the claim/abandon word and the staging file the sink owns.
//
// The claim and the abandonment are one compare-and-swap on one word, so a
// platform about to present a dialog and a caller whose wait just ended
// cannot both win; and the staging file survives exactly one path — an `Ok`
// delivered to a caller still waiting — which is the path that publishes it.

use super::*;
use crate::pdf_export::renderer::progress::ProgressReporter;

fn temp_file(tag: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "vmark-sink-phase-{tag}-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::write(&path, b"x").expect("write temp");
    path
}

/// A render-shaped sink: reporter, temp document, staging file.
fn render_sink() -> (Arc<RenderSink>, PathBuf, oneshot::Receiver<Outcome<()>>) {
    let (tx, rx) = oneshot::channel();
    let staging = temp_file("staging.pdf");
    let reporter = ProgressReporter::with_sink(|_| {});
    (
        RenderSink::with_progress(tx, temp_file("doc.html"), staging.clone(), reporter),
        staging,
        rx,
    )
}

fn dialog_sink() -> (Arc<RenderSink<u8>>, oneshot::Receiver<Outcome<u8>>) {
    let (tx, rx) = oneshot::channel();
    let (shown_tx, _shown_rx) = oneshot::channel();
    (
        RenderSink::for_dialog(tx, shown_tx, temp_file("doc.html")),
        rx,
    )
}

// ---------------------------------------------------------------------------
// The claim word (#227)
// ---------------------------------------------------------------------------

#[test]
fn a_platform_claims_once_and_the_caller_then_learns_it_lost() {
    let (sink, _rx) = dialog_sink();
    assert!(sink.claim(), "the first claim wins");
    assert!(!sink.claim(), "a second claim is not a second dialog");
    assert_eq!(
        sink.abandon(),
        Abandoned::Claimed,
        "the caller's timeout must NOT report failure over a dialog that is on screen"
    );
}

#[test]
fn a_caller_that_abandons_first_makes_every_later_claim_fail() {
    let (sink, _rx) = dialog_sink();
    assert_eq!(sink.abandon(), Abandoned::Marked);
    assert!(
        !sink.claim(),
        "a platform that reaches its dialog after the caller gave up must tear down, not present"
    );
    assert_eq!(
        sink.abandon(),
        Abandoned::Marked,
        "abandoning twice is idempotent"
    );
}

#[test]
fn abandoning_after_the_outcome_was_delivered_says_so() {
    // The caller uses this to clean up a result it will never read.
    let (sink, _staging, _rx) = render_sink();
    sink.settle(Ok(()));
    assert_eq!(sink.abandon(), Abandoned::Settled);
    assert!(!sink.claim(), "nothing is pending to claim");
}

#[test]
fn the_claim_word_is_decided_exactly_once_under_contention() {
    // Many claimers and one abandoner race on one sink; exactly one party
    // wins, whichever thread it is on.
    for _ in 0..50 {
        let (sink, _rx) = dialog_sink();
        let claimers: Vec<_> = (0..4)
            .map(|_| {
                let sink = sink.clone();
                std::thread::spawn(move || sink.claim())
            })
            .collect();
        let abandoner = {
            let sink = sink.clone();
            std::thread::spawn(move || sink.abandon())
        };
        let claims = claimers
            .into_iter()
            .map(|h| h.join().expect("claimer"))
            .filter(|&claimed| claimed)
            .count();
        let abandoned = abandoner.join().expect("abandoner");
        match abandoned {
            Abandoned::Marked => assert_eq!(claims, 0, "abandoned first: no claim may succeed"),
            Abandoned::Claimed => assert_eq!(claims, 1, "claimed first: exactly one claim"),
            Abandoned::Settled => panic!("nothing settled this sink"),
        }
    }
}

// #443 / #444 — the settled check and the phase swap are ONE critical
// section. Separated, a `settle` landing between them let `claim` return true
// over an outcome that had already been delivered — the platform then
// presented a dialog, or printed into a staging file the settle had just
// discarded, for a command that was finished. A settler races a claimer and
// an abandoner: whatever each party is told has to agree with the others.
#[test]
fn a_settle_racing_a_claim_and_an_abandon_never_contradicts_either() {
    use std::sync::Barrier;

    for _ in 0..200 {
        let (sink, rx) = dialog_sink();
        let gate = Arc::new(Barrier::new(3));

        let settler = {
            let (sink, gate) = (sink.clone(), gate.clone());
            std::thread::spawn(move || {
                gate.wait();
                sink.settle(Ok(7u8));
            })
        };
        let claimer = {
            let (sink, gate) = (sink.clone(), gate.clone());
            std::thread::spawn(move || {
                gate.wait();
                sink.claim()
            })
        };
        gate.wait();
        let abandoned = sink.abandon();
        let claimed = claimer.join().expect("claimer");
        settler.join().expect("settler");

        // Exactly one outcome, whoever got there first.
        assert_eq!(rx.blocking_recv().expect("delivered"), Ok(7u8));
        // The word is one word: a claim that won means the abandon did not.
        if claimed {
            assert_ne!(
                abandoned,
                Abandoned::Marked,
                "claimed and abandoned cannot both win the word"
            );
        }
        // And the sink is closed to both afterwards — the state the platform
        // and the caller each read next.
        assert!(!sink.claim(), "a settled sink grants no claim");
        assert_eq!(sink.abandon(), Abandoned::Settled);
    }
}

// The deterministic half of the same rule, in the order the defect needed:
// once `settle` has returned, nothing may be claimed. Under the old
// check-then-swap this was only true when no settle overlapped the check.
#[test]
fn nothing_is_claimed_once_the_outcome_has_been_delivered() {
    let (sink, mut rx) = dialog_sink();
    sink.settle(Ok(3u8));
    assert!(!sink.claim());
    assert_eq!(sink.abandon(), Abandoned::Settled);
    assert_eq!(rx.try_recv().expect("delivered"), Ok(3u8));
}

// ---------------------------------------------------------------------------
// The staging file (#224)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_delivered_ok_leaves_the_staging_file_for_the_caller_to_publish() {
    let (sink, staging, rx) = render_sink();
    sink.settle(Ok(()));
    assert!(rx.await.expect("sender alive").is_ok());
    assert!(
        staging.exists(),
        "the caller publishes it; the sink must not remove it"
    );
    std::fs::remove_file(&staging).expect("cleanup");
}

#[tokio::test]
async fn an_err_outcome_removes_the_staging_file() {
    let (sink, staging, rx) = render_sink();
    sink.settle(Err(CommandError::io("print failed")));
    assert!(rx.await.expect("sender alive").is_err());
    assert!(
        !staging.exists(),
        "a failed render leaves no half-written sibling"
    );
}

#[test]
fn an_ok_nobody_receives_removes_the_staging_file() {
    // The caller timed out and dropped its receiver; the print then finished.
    // Before staging this wrote the caller's output path after the caller
    // had reported failure — and over whatever a retry had produced.
    let (sink, staging, rx) = render_sink();
    drop(rx);
    sink.settle(Ok(()));
    assert!(!staging.exists());
}

#[test]
fn an_abandoned_sink_removes_the_staging_file_even_on_ok() {
    let (sink, staging, _rx) = render_sink();
    assert_eq!(sink.abandon(), Abandoned::Marked);
    sink.settle(Ok(()));
    assert!(
        !staging.exists(),
        "the caller left; nothing will publish this"
    );
}

#[test]
fn dropping_an_unsettled_sink_removes_the_staging_file() {
    let (sink, staging, _rx) = render_sink();
    drop(sink);
    assert!(!staging.exists());
}

#[tokio::test]
async fn a_dialog_sink_has_no_staging_file_and_settling_is_unaffected() {
    let (sink, rx) = dialog_sink();
    sink.settle(Ok(7));
    assert_eq!(rx.await.expect("sender alive").expect("outcome"), 7);
}

// ---------------------------------------------------------------------------
// The teardown (#224, #227) — armed by the platform, owned by the sink
// ---------------------------------------------------------------------------

use std::sync::atomic::{AtomicUsize, Ordering};

fn armed<T>(sink: &RenderSink<T>) -> Arc<AtomicUsize> {
    let closes = Arc::new(AtomicUsize::new(0));
    let seen = closes.clone();
    sink.teardown.arm(move || {
        seen.fetch_add(1, Ordering::SeqCst);
    });
    closes
}

#[test]
fn settling_disarms_the_close_so_the_platform_keeps_its_window_decision() {
    // Windows leaves a shown print UI's window to the user; every other
    // settle path closes its own. Either way the sink must not close it.
    let (sink, _rx) = dialog_sink();
    let closes = armed(&sink);
    sink.settle(Ok(1));
    sink.teardown.run();
    drop(sink);
    assert_eq!(closes.load(Ordering::SeqCst), 0);
}

#[test]
fn dropping_an_unsettled_sink_runs_the_close_so_the_window_cannot_leak() {
    // A platform closure released without ever running: nothing else
    // would close the window it was handed.
    let (sink, _staging, _rx) = render_sink();
    let closes = armed(&sink);
    drop(sink);
    assert_eq!(closes.load(Ordering::SeqCst), 1);
}

#[test]
fn a_timeouts_close_runs_once_and_a_later_drop_does_not_repeat_it() {
    let (sink, _staging, _rx) = render_sink();
    let closes = armed(&sink);
    assert_eq!(sink.abandon(), Abandoned::Marked);
    sink.teardown.run();
    drop(sink);
    assert_eq!(closes.load(Ordering::SeqCst), 1);
}
