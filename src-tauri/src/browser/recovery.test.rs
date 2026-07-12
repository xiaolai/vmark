//! Unit tests for the crash-recovery policy (WI-1.8).

use super::*;

#[test]
fn first_crash_auto_reloads_and_counts_one() {
    let mut t = CrashTracker::new();
    assert_eq!(t.on_crash(), RecoveryAction::AutoReload);
    assert_eq!(t.consecutive(), 1);
}

#[test]
fn crashes_up_to_the_budget_all_auto_reload() {
    let mut t = CrashTracker::new();
    for _ in 0..MAX_AUTO_RELOADS {
        assert_eq!(t.on_crash(), RecoveryAction::AutoReload);
    }
    assert_eq!(t.consecutive(), MAX_AUTO_RELOADS);
}

#[test]
fn a_crash_past_the_budget_switches_to_manual_only() {
    let mut t = CrashTracker::new();
    for _ in 0..MAX_AUTO_RELOADS {
        t.on_crash();
    }
    // One crash beyond the budget: a reload-crash loop — stop auto-reloading.
    assert_eq!(t.on_crash(), RecoveryAction::ManualOnly);
}

#[test]
fn a_successful_load_resets_the_crash_streak() {
    let mut t = CrashTracker::new();
    for _ in 0..MAX_AUTO_RELOADS {
        t.on_crash();
    }
    assert_eq!(t.on_crash(), RecoveryAction::ManualOnly);
    // The user reloaded and the page loaded cleanly — the streak is forgiven.
    t.on_load_success();
    assert_eq!(t.consecutive(), 0);
    assert_eq!(t.on_crash(), RecoveryAction::AutoReload);
}

#[test]
fn a_zero_budget_never_auto_reloads() {
    let mut t = CrashTracker::new();
    // Budget 0 = every crash requires a manual reload.
    assert_eq!(t.on_crash_with_budget(0), RecoveryAction::ManualOnly);
}

#[test]
fn custom_budget_is_honored() {
    let mut t = CrashTracker::new();
    assert_eq!(t.on_crash_with_budget(1), RecoveryAction::AutoReload); // 1 <= 1
    assert_eq!(t.on_crash_with_budget(1), RecoveryAction::ManualOnly); // 2 > 1
}

#[test]
fn crash_count_saturates_without_overflow() {
    let mut t = CrashTracker::new();
    t.force_consecutive(u32::MAX);
    // saturating_add must not panic/wrap at the ceiling.
    assert_eq!(t.on_crash(), RecoveryAction::ManualOnly);
    assert_eq!(t.consecutive(), u32::MAX);
}
