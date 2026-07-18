//! Tests for `quit.rs` (moved from the inline `#[cfg(test)]` module;
//! included via `#[path]`).

use super::*;

// Tests mutate shared statics, so they must run serially.
// Use a global mutex to prevent parallel test interference.
static TEST_LOCK: Mutex<()> = Mutex::new(());

/// Reset confirm-quit state. Must be called under TEST_LOCK.
fn reset_confirm_quit() {
    CONFIRM_QUIT_ENABLED.store(true, Ordering::SeqCst);
    *FIRST_QUIT_PRESS.lock().unwrap_or_else(|p| p.into_inner()) = None;
}

#[test]
fn test_is_document_window_label() {
    assert!(is_document_window_label("main"));
    assert!(is_document_window_label("doc-0"));
    assert!(is_document_window_label("doc-123"));
    assert!(!is_document_window_label("settings"));
}

#[test]
fn exit_request_allows_when_already_allowed() {
    assert_eq!(
        decide_exit_request_action(true, true, true),
        ExitRequestAction::AllowExit
    );
}

#[test]
fn exit_request_with_documents_starts_coordinated_quit() {
    assert_eq!(
        decide_exit_request_action(false, true, false),
        ExitRequestAction::PreventAndStartQuit
    );
}

#[test]
fn exit_request_without_documents_keeps_alive_only_when_requested() {
    assert_eq!(
        decide_exit_request_action(false, false, true),
        ExitRequestAction::PreventAndKeepAlive
    );
    assert_eq!(
        decide_exit_request_action(false, false, false),
        ExitRequestAction::AllowExit
    );
}

#[test]
fn gate_disabled_proceeds_immediately() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();
    CONFIRM_QUIT_ENABLED.store(false, Ordering::SeqCst);

    let now = Instant::now();
    assert_eq!(check_confirm_quit_gate(now), QuitGateResult::Proceed);
}

#[test]
fn gate_first_press_blocks() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    let now = Instant::now();
    assert_eq!(
        check_confirm_quit_gate(now),
        QuitGateResult::WaitForSecondPress
    );
    // Timestamp is recorded
    assert!(FIRST_QUIT_PRESS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .is_some());
}

#[test]
fn gate_second_press_within_window_proceeds() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    let now = Instant::now();
    assert_eq!(
        check_confirm_quit_gate(now),
        QuitGateResult::WaitForSecondPress
    );

    // Second press 500ms later — within 2s window
    let later = now + Duration::from_millis(500);
    assert_eq!(check_confirm_quit_gate(later), QuitGateResult::Proceed);

    // Timestamp cleared after proceed
    assert!(FIRST_QUIT_PRESS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .is_none());
}

#[test]
fn gate_expired_first_press_blocks_again() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    let now = Instant::now();
    assert_eq!(
        check_confirm_quit_gate(now),
        QuitGateResult::WaitForSecondPress
    );

    // Third second — expired, acts as new first press
    let expired = now + Duration::from_secs(3);
    assert_eq!(
        check_confirm_quit_gate(expired),
        QuitGateResult::WaitForSecondPress
    );

    // But a quick follow-up proceeds
    let follow_up = expired + Duration::from_millis(200);
    assert_eq!(check_confirm_quit_gate(follow_up), QuitGateResult::Proceed);
}

#[test]
fn gate_at_exact_boundary_blocks() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    let now = Instant::now();
    assert_eq!(
        check_confirm_quit_gate(now),
        QuitGateResult::WaitForSecondPress
    );

    // Exactly at 2s boundary — Duration comparison is strict `<`, so 2s is expired
    let at_boundary = now + Duration::from_secs(2);
    assert_eq!(
        check_confirm_quit_gate(at_boundary),
        QuitGateResult::WaitForSecondPress
    );
}

#[test]
fn set_confirm_quit_clears_first_press() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    // Record a first press
    *FIRST_QUIT_PRESS.lock().unwrap_or_else(|p| p.into_inner()) = Some(Instant::now());
    assert!(FIRST_QUIT_PRESS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .is_some());

    // Toggling the setting clears the pending press
    set_confirm_quit(false);
    assert!(FIRST_QUIT_PRESS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .is_none());
}

#[test]
fn cancel_quit_clears_first_press() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    // Record a first press then cancel quit
    *FIRST_QUIT_PRESS.lock().unwrap_or_else(|p| p.into_inner()) = Some(Instant::now());
    cancel_quit();
    assert!(FIRST_QUIT_PRESS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .is_none());
}

// --- Rapid double-quit ---

#[test]
fn rapid_double_quit_1ms_apart_proceeds() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    let now = Instant::now();
    assert_eq!(
        check_confirm_quit_gate(now),
        QuitGateResult::WaitForSecondPress
    );

    // Second press just 1ms later
    let very_soon = now + Duration::from_millis(1);
    assert_eq!(check_confirm_quit_gate(very_soon), QuitGateResult::Proceed);
}

#[test]
fn rapid_double_quit_0ms_apart_proceeds() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    let now = Instant::now();
    assert_eq!(
        check_confirm_quit_gate(now),
        QuitGateResult::WaitForSecondPress
    );

    // Second press at the exact same instant
    assert_eq!(check_confirm_quit_gate(now), QuitGateResult::Proceed);
}

// --- Quit after timeout resets ---

#[test]
fn quit_after_timeout_resets_first_press() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    let now = Instant::now();
    assert_eq!(
        check_confirm_quit_gate(now),
        QuitGateResult::WaitForSecondPress
    );

    // Wait well past the 2s window
    let expired = now + Duration::from_secs(5);
    // This should act as a fresh first press, not proceed
    assert_eq!(
        check_confirm_quit_gate(expired),
        QuitGateResult::WaitForSecondPress
    );

    // The new first press timestamp should be `expired`, not `now`
    let guard = FIRST_QUIT_PRESS.lock().unwrap_or_else(|p| p.into_inner());
    assert_eq!(*guard, Some(expired));
}

#[test]
fn quit_after_timeout_then_quick_second_proceeds() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    let t0 = Instant::now();
    assert_eq!(
        check_confirm_quit_gate(t0),
        QuitGateResult::WaitForSecondPress
    );

    // Expired first press
    let t1 = t0 + Duration::from_secs(3);
    assert_eq!(
        check_confirm_quit_gate(t1),
        QuitGateResult::WaitForSecondPress
    );

    // Quick second press after the reset
    let t2 = t1 + Duration::from_millis(100);
    assert_eq!(check_confirm_quit_gate(t2), QuitGateResult::Proceed);
}

// --- Cancel between quits ---

#[test]
fn cancel_between_quits_requires_fresh_double_press() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    let t0 = Instant::now();
    // First press
    assert_eq!(
        check_confirm_quit_gate(t0),
        QuitGateResult::WaitForSecondPress
    );

    // User cancels
    cancel_quit();

    // Next press should be treated as a new first press, not the second
    let t1 = t0 + Duration::from_millis(100);
    assert_eq!(
        check_confirm_quit_gate(t1),
        QuitGateResult::WaitForSecondPress
    );

    // The actual second press proceeds
    let t2 = t1 + Duration::from_millis(100);
    assert_eq!(check_confirm_quit_gate(t2), QuitGateResult::Proceed);
}

#[test]
fn cancel_clears_all_quit_state() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    // Set up quit-in-progress state
    QUIT_IN_PROGRESS.store(true, Ordering::SeqCst);
    EXIT_ALLOWED.store(true, Ordering::SeqCst);
    set_quit_targets(HashSet::from(["main".to_string(), "doc-0".to_string()]));
    *FIRST_QUIT_PRESS.lock().unwrap_or_else(|p| p.into_inner()) = Some(Instant::now());

    cancel_quit();

    // All state should be cleared
    assert!(!QUIT_IN_PROGRESS.load(Ordering::SeqCst));
    assert!(!EXIT_ALLOWED.load(Ordering::SeqCst));
    assert!(QUIT_TARGETS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .is_empty());
    assert!(FIRST_QUIT_PRESS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .is_none());
}

// --- Emit failure aborts the coordinated quit ---

#[test]
fn emit_failure_aborts_quit_and_resets_state() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    // A quit is in progress with two registered targets when the emit to one
    // window fails. Without the abort, 'doc-0' would sit in QUIT_TARGETS
    // forever with QUIT_IN_PROGRESS=true — a permanently stuck quit.
    QUIT_IN_PROGRESS.store(true, Ordering::SeqCst);
    set_exit_allowed(false);
    set_quit_targets(HashSet::from(["main".to_string(), "doc-0".to_string()]));

    abort_quit_on_emit_failure("doc-0", "event bus unavailable");

    // The coordinated quit is fully cancelled — nothing is left stuck.
    assert!(!QUIT_IN_PROGRESS.load(Ordering::SeqCst));
    assert!(!is_exit_allowed());
    assert!(QUIT_TARGETS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .is_empty());
}

// --- Exit allowed flag ---

#[test]
fn exit_allowed_initially_false() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    // Reset to default
    set_exit_allowed(false);

    assert!(!is_exit_allowed());
}

#[test]
fn exit_allowed_set_and_clear() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());

    set_exit_allowed(true);
    assert!(is_exit_allowed());

    set_exit_allowed(false);
    assert!(!is_exit_allowed());
}

#[test]
fn exit_allowed_toggled_multiple_times() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());

    for _ in 0..10 {
        set_exit_allowed(true);
        assert!(is_exit_allowed());
        set_exit_allowed(false);
        assert!(!is_exit_allowed());
    }
}

// --- Quit targets ---

#[test]
fn remove_quit_target_returns_true_when_last_removed() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());

    set_quit_targets(HashSet::from(["main".to_string()]));
    assert!(remove_quit_target("main"));
}

#[test]
fn remove_quit_target_returns_false_when_others_remain() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());

    set_quit_targets(HashSet::from(["main".to_string(), "doc-0".to_string()]));
    assert!(!remove_quit_target("main"));
}

#[test]
fn remove_nonexistent_target_checks_emptiness() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());

    set_quit_targets(HashSet::from(["main".to_string()]));
    // Removing a label that doesn't exist — set still has "main"
    assert!(!remove_quit_target("doc-999"));
}

#[test]
fn remove_all_targets_one_by_one() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());

    set_quit_targets(HashSet::from([
        "main".to_string(),
        "doc-0".to_string(),
        "doc-1".to_string(),
    ]));
    assert!(!remove_quit_target("doc-0"));
    assert!(!remove_quit_target("main"));
    assert!(remove_quit_target("doc-1"));
}

#[test]
fn empty_quit_targets_remove_returns_true() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());

    set_quit_targets(HashSet::new());
    // Removing from empty set — it's already empty, so returns true
    assert!(remove_quit_target("anything"));
}

// --- is_document_window_label edge cases ---

#[test]
fn is_document_window_label_empty_string() {
    assert!(!is_document_window_label(""));
}

#[test]
fn is_document_window_label_doc_prefix_only() {
    // "doc-" with no suffix is still a document window
    assert!(is_document_window_label("doc-"));
}

#[test]
fn is_document_window_label_main_substring() {
    // "main" embedded in a larger string should NOT match
    assert!(!is_document_window_label("main-window"));
    assert!(!is_document_window_label("not-main"));
    assert!(!is_document_window_label("mainsettings"));
}

#[test]
fn is_document_window_label_doc_variations() {
    assert!(!is_document_window_label("doc")); // no dash
    assert!(!is_document_window_label("docs-0")); // extra 's'
    assert!(!is_document_window_label("DOC-0")); // wrong case
    assert!(is_document_window_label("doc-abc")); // non-numeric suffix
}

// --- Gate enable/disable mid-sequence ---

#[test]
fn gate_disabled_after_first_press_proceeds() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    let now = Instant::now();
    // First press with gate enabled
    assert_eq!(
        check_confirm_quit_gate(now),
        QuitGateResult::WaitForSecondPress
    );

    // Disable gate
    CONFIRM_QUIT_ENABLED.store(false, Ordering::SeqCst);

    // Next press should proceed because gate is now disabled
    let later = now + Duration::from_millis(500);
    assert_eq!(check_confirm_quit_gate(later), QuitGateResult::Proceed);
}

#[test]
fn gate_reenabled_requires_fresh_double_press() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    // Disable gate, do a press
    CONFIRM_QUIT_ENABLED.store(false, Ordering::SeqCst);
    let now = Instant::now();
    assert_eq!(check_confirm_quit_gate(now), QuitGateResult::Proceed);

    // Re-enable gate via set_confirm_quit (which clears first press)
    set_confirm_quit(true);

    // Now requires double press
    let t1 = now + Duration::from_millis(100);
    assert_eq!(
        check_confirm_quit_gate(t1),
        QuitGateResult::WaitForSecondPress
    );

    let t2 = t1 + Duration::from_millis(100);
    assert_eq!(check_confirm_quit_gate(t2), QuitGateResult::Proceed);
}

// --- Triple press scenario ---

#[test]
fn triple_press_first_two_proceed_third_is_new_first() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    let t0 = Instant::now();
    assert_eq!(
        check_confirm_quit_gate(t0),
        QuitGateResult::WaitForSecondPress
    );

    let t1 = t0 + Duration::from_millis(100);
    assert_eq!(check_confirm_quit_gate(t1), QuitGateResult::Proceed);

    // Third press — state was cleared after Proceed, so this is a new first press
    let t2 = t1 + Duration::from_millis(100);
    assert_eq!(
        check_confirm_quit_gate(t2),
        QuitGateResult::WaitForSecondPress
    );
}

// --- Boundary timing ---

#[test]
fn gate_just_before_boundary_proceeds() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    let now = Instant::now();
    assert_eq!(
        check_confirm_quit_gate(now),
        QuitGateResult::WaitForSecondPress
    );

    // 1ms before the 2s boundary — should still be within window
    let just_before = now + Duration::from_millis(1999);
    assert_eq!(
        check_confirm_quit_gate(just_before),
        QuitGateResult::Proceed
    );
}

#[test]
fn gate_just_after_boundary_blocks() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    let now = Instant::now();
    assert_eq!(
        check_confirm_quit_gate(now),
        QuitGateResult::WaitForSecondPress
    );

    // 1ms after the 2s boundary — expired
    let just_after = now + Duration::from_millis(2001);
    assert_eq!(
        check_confirm_quit_gate(just_after),
        QuitGateResult::WaitForSecondPress
    );
}

// --- Thread safety ---

#[test]
fn concurrent_quit_gate_calls_do_not_panic() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();

    // Use a barrier so all threads call check_confirm_quit_gate simultaneously
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(10));
    let handles: Vec<_> = (0..10)
        .map(|_| {
            let b = barrier.clone();
            std::thread::spawn(move || {
                b.wait();
                let now = Instant::now();
                // Should not panic or deadlock
                let _result = check_confirm_quit_gate(now);
            })
        })
        .collect();

    for h in handles {
        h.join().expect("thread should not panic");
    }
}

#[test]
fn concurrent_cancel_and_gate_check_no_panic() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    reset_confirm_quit();
    QUIT_IN_PROGRESS.store(false, Ordering::SeqCst);
    set_exit_allowed(false);
    set_quit_targets(HashSet::new());

    let barrier = std::sync::Arc::new(std::sync::Barrier::new(6));
    let mut handles = Vec::new();

    // 3 threads calling check_confirm_quit_gate
    for _ in 0..3 {
        let b = barrier.clone();
        handles.push(std::thread::spawn(move || {
            b.wait();
            let now = Instant::now();
            let _result = check_confirm_quit_gate(now);
        }));
    }

    // 3 threads calling cancel_quit
    for _ in 0..3 {
        let b = barrier.clone();
        handles.push(std::thread::spawn(move || {
            b.wait();
            cancel_quit();
        }));
    }

    for h in handles {
        h.join().expect("thread should not panic");
    }
}

#[test]
fn concurrent_exit_allowed_toggle_no_panic() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    set_exit_allowed(false);

    let barrier = std::sync::Arc::new(std::sync::Barrier::new(10));
    let handles: Vec<_> = (0..10)
        .map(|i| {
            let b = barrier.clone();
            std::thread::spawn(move || {
                b.wait();
                if i % 2 == 0 {
                    set_exit_allowed(true);
                } else {
                    set_exit_allowed(false);
                }
                // Read should never panic
                let _val = is_exit_allowed();
            })
        })
        .collect();

    for h in handles {
        h.join().expect("thread should not panic");
    }
}
