//! Tests for `BridgeLifecycle` (#177, #179, #180). Loaded via `#[path]`.

use super::*;
use std::time::Duration;

use BridgePhase::{Running, Starting, Stopped};

#[test]
fn a_start_is_claimed_once_and_carries_a_fresh_generation() {
    let lc = BridgeLifecycle::default();
    assert_eq!(lc.snapshot(), Stopped);
    let claim1 = lc.begin_start().expect("the first start claims");
    let gen1 = claim1.generation();
    assert_eq!(
        lc.snapshot(),
        Starting,
        "claimed, but no port until published — and not reported as running (#178)"
    );
    assert!(
        lc.begin_start().is_none(),
        "a second start finds it claimed"
    );
    claim1.commit(4321);
    assert_eq!(lc.snapshot(), Running(4321));
    lc.mark_stopped();
    assert_eq!(lc.snapshot(), Stopped);
    let gen2 = lc
        .begin_start()
        .expect("after a stop the bridge starts again")
        .generation();
    assert!(gen2 > gen1, "every start is a new generation");
}

/// #392 — the claim is released by DROPPING it, not by an explicit call on
/// the one path that returns `Err`.
///
/// A start that panicked, or whose command future was dropped, used to leave
/// `running: true` with no port: `Starting` for the life of the process, and
/// every later `mcp_bridge_start` returned that phase instead of starting.
#[test]
fn dropping_an_uncommitted_claim_releases_it() {
    let lc = BridgeLifecycle::default();
    drop(lc.begin_start().expect("claimed"));
    assert_eq!(lc.snapshot(), Stopped);
    assert!(lc.begin_start().is_some(), "the next start may claim");
}

#[test]
fn a_claim_dropped_during_a_panic_still_releases_it() {
    let lc = BridgeLifecycle::default();
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _claim = lc.begin_start().expect("claimed");
        assert_eq!(lc.snapshot(), Starting);
        panic!("a start that blew up mid-bind");
    }));
    assert!(outcome.is_err(), "the panic is real");
    assert_eq!(
        lc.snapshot(),
        Stopped,
        "the bridge must not be wedged in Starting"
    );
}

/// A claim dropped LATE — after a stop and a fresh start — must not clear the
/// new bridge's state, for the same reason `on_loop_exit` is generation-guarded.
#[test]
fn a_stale_claims_drop_leaves_a_newer_start_alone() {
    let lc = BridgeLifecycle::default();
    let stale = lc.begin_start().expect("first start");
    lc.mark_stopped();
    let fresh = lc.begin_start().expect("second start");
    fresh.commit(2000);

    drop(stale);
    assert_eq!(lc.snapshot(), Running(2000), "the new bridge is untouched");
}

#[test]
fn a_stale_loops_exit_touches_nothing_and_the_current_ones_clears_the_state() {
    // audit 20260612: a dying OLD accept loop must not clobber the NEW
    // bridge's state or delete its port file.
    let lc = BridgeLifecycle::default();
    let old_claim = lc.begin_start().expect("first start");
    let old = old_claim.generation();
    old_claim.commit(1000);
    lc.mark_stopped();
    let new_claim = lc.begin_start().expect("second start");
    let new = new_claim.generation();
    new_claim.commit(2000);

    assert!(!lc.on_loop_exit(old), "the old loop is stale");
    assert_eq!(lc.snapshot(), Running(2000), "the new bridge is untouched");

    assert!(lc.on_loop_exit(new), "the current loop's exit is real");
    assert_eq!(lc.snapshot(), Stopped);
}

#[test]
fn publishing_survives_a_poisoned_lock() {
    // #180: the port slot's lock used to be `?`-ed AFTER the listener was up;
    // a poison there reported a failure for a bridge that was running.
    use std::sync::Arc;
    let lc = Arc::new(BridgeLifecycle::default());
    let claim = lc.begin_start().expect("claimed");
    let poisoner = Arc::clone(&lc);
    let _ = std::thread::spawn(move || {
        let _guard = poisoner.inner.lock().unwrap();
        panic!("intentional poison");
    })
    .join();
    claim.commit(5555);
    assert_eq!(lc.snapshot(), Running(5555));
}

#[tokio::test]
async fn a_stop_cannot_interleave_with_a_start_that_is_still_binding() {
    // #179: with the serialization lock held by a "start", a "stop" cannot
    // even begin — it waits, then runs against the bridge the start produced.
    use std::sync::Arc;
    let lc = Arc::new(BridgeLifecycle::default());
    let held = lc.serialize().await;
    let claim = lc.begin_start().expect("start claims");
    let generation = claim.generation();

    let stopper = Arc::clone(&lc);
    let mut stop = tokio::spawn(async move {
        let _serial = stopper.serialize().await;
        stopper.mark_stopped();
    });

    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut stop)
            .await
            .is_err(),
        "the stop must wait while the start holds the lock"
    );
    // The start finishes its bind and publishes; nothing the stop did could
    // have reached the state in the meantime.
    claim.commit(7777);
    assert_eq!(lc.snapshot(), Running(7777));
    drop(held);

    stop.await
        .expect("the stop runs once the start has released the lock");
    assert_eq!(lc.snapshot(), Stopped);
    assert!(
        !lc.on_loop_exit(generation),
        "the stop superseded the start's generation, so its loop is now stale"
    );
}
