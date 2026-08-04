// WI-20 — the managed hot-exit state: rounds, completion, and the timeout's
// stand-down rule (which replaced the `generation: u64` counter).
//
//! Every test here builds its own `HotExitState`. There is no serialization
//! mutex and no `clear()` preamble, because there is nothing shared to
//! serialize against — that is what the migration bought.

use super::*;
use std::sync::{Arc, Barrier};

fn window(label: &str) -> WindowState {
    WindowState {
        window_label: label.to_string(),
        is_main_window: label == "main",
        active_tab_id: None,
        tabs: Vec::new(),
        ui_state: super::super::session::UiState {
            sidebar_visible: true,
            sidebar_width: 260,
            outline_visible: false,
            sidebar_view_mode: "files".to_string(),
            status_bar_visible: true,
            source_mode_enabled: false,
            focus_mode_enabled: false,
            typewriter_mode_enabled: false,
            terminal_visible: false,
            terminal_height: 250,
        },
        geometry: None,
        workspace_instance_ids: Vec::new(),
        active_workspace_instance_id: None,
        workspace_instances: Vec::new(),
        ui_state_by_instance: None,
        closed_tab_scopes: None,
        browser_session: None,
    }
}

fn labels(names: &[&str]) -> HashSet<String> {
    names.iter().map(|n| n.to_string()).collect()
}

// -- PendingRestore ---------------------------------------------------------

#[test]
fn no_expected_windows_is_not_vacuously_complete() {
    // Guard against vacuous truth: an empty round must not report "done", or
    // a restore that stored nothing would look like a successful one.
    assert!(!PendingRestore::default().all_complete());
}

#[test]
fn all_complete_needs_every_expected_label() {
    let mut pending = PendingRestore {
        expected_labels: labels(&["main", "doc-1"]),
        completed_windows: labels(&["main"]),
        ..Default::default()
    };
    assert!(!pending.all_complete());
    pending.completed_windows.insert("doc-1".to_string());
    assert!(pending.all_complete());
}

#[test]
fn clear_drops_every_collection() {
    let mut pending = PendingRestore {
        expected_labels: labels(&["main"]),
        completed_windows: labels(&["main"]),
        ..Default::default()
    };
    pending
        .window_states
        .insert("main".to_string(), window("main"));

    pending.clear();

    assert!(pending.expected_labels.is_empty());
    assert!(pending.completed_windows.is_empty());
    assert!(pending.window_states.is_empty());
}

// -- Rounds -----------------------------------------------------------------

#[test]
fn a_fresh_round_is_live_and_a_new_restore_stands_it_down() {
    let state = HotExitState::default();

    let first = state.store(
        std::iter::once(("main".to_string(), window("main"))),
        labels(&["main"]),
    );
    assert!(!first.is_cancelled(), "the round just started");

    let second = state.store(
        std::iter::once(("main".to_string(), window("main"))),
        labels(&["main"]),
    );

    assert!(
        first.is_cancelled(),
        "starting restore B must stand restore A's round down"
    );
    assert!(!second.is_cancelled());
}

#[test]
fn a_new_restore_replaces_the_previous_rounds_windows() {
    let state = HotExitState::default();
    state.store(
        std::iter::once(("doc-old".to_string(), window("doc-old"))),
        labels(&["doc-old"]),
    );

    state.store(
        std::iter::once(("doc-new".to_string(), window("doc-new"))),
        labels(&["doc-new"]),
    );

    assert!(
        state.window_state("doc-old").is_none(),
        "the previous round's windows must not linger into the new one"
    );
    assert!(state.window_state("doc-new").is_some());
}

// -- The timeout's stand-down rule (replaces the generation counter) ---------

#[test]
fn a_stale_rounds_timeout_leaves_the_new_rounds_state_alone() {
    // THE regression the `generation: u64` counter existed for: restore A's
    // 60s timeout fires after restore B has taken over, and must not clear
    // B's windows out from under it.
    let state = HotExitState::default();
    let round_a = state.store(
        std::iter::once(("main".to_string(), window("main"))),
        labels(&["main"]),
    );
    state.store(
        [
            ("main".to_string(), window("main")),
            ("doc-1".to_string(), window("doc-1")),
        ],
        labels(&["main", "doc-1"]),
    );

    assert!(
        state.expire_round(&round_a).is_none(),
        "a superseded round must expire nothing"
    );
    assert!(state.window_state("main").is_some());
    assert!(state.window_state("doc-1").is_some());
}

#[test]
fn a_live_rounds_timeout_clears_it_and_names_the_windows_that_never_arrived() {
    let state = HotExitState::default();
    let round = state.store(
        [
            ("main".to_string(), window("main")),
            ("doc-1".to_string(), window("doc-1")),
        ],
        labels(&["main", "doc-1"]),
    );
    state.mark_complete("main");

    let incomplete = state
        .expire_round(&round)
        .expect("a live round with outstanding windows must expire");

    assert_eq!(incomplete, vec!["doc-1".to_string()]);
    assert!(state.window_state("main").is_none());
    assert!(state.window_state("doc-1").is_none());
}

#[test]
fn a_completed_rounds_timeout_is_a_no_op() {
    let state = HotExitState::default();
    let round = state.store(
        std::iter::once(("main".to_string(), window("main"))),
        labels(&["main"]),
    );
    assert!(state.mark_complete("main"), "the round completed");

    assert!(
        state.expire_round(&round).is_none(),
        "nothing is outstanding, so the timeout has nothing to report"
    );
}

#[test]
fn clearing_a_round_does_not_cancel_it_but_does_disarm_its_timeout() {
    // `clear()` is the "this restore is finished" path. It deliberately does
    // NOT end the round — the timeout is disarmed by there being nothing left
    // to expire, which is also what makes a late completion harmless.
    let state = HotExitState::default();
    let round = state.store(
        std::iter::once(("main".to_string(), window("main"))),
        labels(&["main"]),
    );

    state.clear();

    assert!(!round.is_cancelled());
    assert!(state.expire_round(&round).is_none());
}

// -- The stand-down check must happen UNDER the lock (audit 20260803 §2) ----

#[test]
fn a_timeout_that_woke_before_the_takeover_still_sees_the_stand_down() {
    // THE finding. `expire_round` read `is_cancelled()` BEFORE reaching for the
    // pending lock, so an obsolete timeout could pass the check, lose the lock
    // to the restore that was taking over, and then clear the NEW round's map.
    //
    // The lock is the interleaving point, so the test holds it: the worker
    // below is frozen at exactly the instant restore B is mid-`store()`.
    let state = Arc::new(HotExitState::default());
    let round_a = state.store(
        std::iter::once(("doc-a".to_string(), window("doc-a"))),
        labels(&["doc-a"]),
    );

    let guard = state
        .pending
        .lock()
        .expect("uncontended in the test thread");

    let ready = Arc::new(Barrier::new(2));
    let worker = std::thread::spawn({
        let state = Arc::clone(&state);
        let ready = Arc::clone(&ready);
        let round_a = round_a.clone();
        move || {
            ready.wait();
            state.expire_round(&round_a)
        }
    });
    ready.wait();
    // Round A's timeout is now inside `expire_round`; let it reach the lock.
    std::thread::sleep(std::time::Duration::from_millis(50));

    // …and restore B takes over. Standing the previous round down is the first
    // thing `begin_round` does, and it does it while holding this very lock.
    // (The map still holds A's window, standing in for the one B installs —
    // what matters is that the timeout must not clear whatever is there.)
    round_a.cancel();
    drop(guard);

    assert!(
        worker
            .join()
            .expect("expire_round must not panic")
            .is_none(),
        "a superseded timeout expired the round anyway — it read the \
         cancellation flag outside the lock, before the takeover set it"
    );
    assert!(
        state.window_state("doc-a").is_some(),
        "the incoming round's pending state was cleared out from under it"
    );
}

// -- Timeout-task retention (audit 20260803 §9) -----------------------------

/// Spawn a task that parks for the restore timeout's full duration, holding a
/// clone of `held` — the stand-in for the `AppHandle` the real body captures.
fn park_timeout_task(held: &Arc<()>) -> tauri::async_runtime::JoinHandle<()> {
    let held = Arc::clone(held);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        drop(held);
    })
}

/// Wait (bounded) for the spawned task's captures to be released.
async fn settle_until_released(held: &Arc<()>) {
    for _ in 0..200 {
        if Arc::strong_count(held) == 1 {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
}

#[tokio::test]
async fn a_new_round_aborts_the_superseded_rounds_timeout_task() {
    // A superseded round's task used to sleep out its full 60s holding an
    // AppHandle clone, doing nothing at the end. Rapid restores stacked one
    // such task each.
    let state = HotExitState::default();
    let held = Arc::new(());
    state.set_restore_timeout(park_timeout_task(&held));

    state.begin_round();

    settle_until_released(&held).await;
    assert_eq!(
        Arc::strong_count(&held),
        1,
        "the superseded round's timeout task still holds its captures"
    );
}

#[tokio::test]
async fn a_completed_round_aborts_its_own_timeout_task() {
    let state = HotExitState::default();
    state.store(
        std::iter::once(("main".to_string(), window("main"))),
        labels(&["main"]),
    );
    let held = Arc::new(());
    state.set_restore_timeout(park_timeout_task(&held));

    assert!(state.mark_complete("main"), "the round completed");

    settle_until_released(&held).await;
    assert_eq!(
        Arc::strong_count(&held),
        1,
        "a finished restore left its 60s safety net parked"
    );
}

#[tokio::test]
async fn successive_restores_never_stack_more_than_one_timeout_task() {
    // The accumulation property itself: five restores in a row leave exactly
    // one live task, not five.
    let state = HotExitState::default();
    let superseded = Arc::new(());
    for _ in 0..4 {
        state.set_restore_timeout(park_timeout_task(&superseded));
    }
    let current = Arc::new(());
    state.set_restore_timeout(park_timeout_task(&current));

    settle_until_released(&superseded).await;
    assert_eq!(
        Arc::strong_count(&superseded),
        1,
        "an earlier restore's timeout task survived a later one"
    );
    assert_eq!(
        Arc::strong_count(&current),
        2,
        "the CURRENT round's safety net must still be armed"
    );
}

#[test]
fn aborting_a_restore_ends_its_round_and_empties_the_map() {
    // `begin_round` is what the multi-window restore calls when window
    // creation or the start signal fails: the half-built restore must not be
    // pullable, and its timeout must not fire against whatever comes next.
    let state = HotExitState::default();
    let round = state.store(
        std::iter::once(("doc-1".to_string(), window("doc-1"))),
        labels(&["doc-1"]),
    );

    state.begin_round();

    assert!(round.is_cancelled());
    assert!(state.window_state("doc-1").is_none());
}
