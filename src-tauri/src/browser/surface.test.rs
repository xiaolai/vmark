//! Unit tests for the `BrowserSurface` state container (WI-1.2 / WI-1.8).
//!
//! `BrowserSurface` is plain `Send` state (mutexes + a per-window grant map) — no
//! AppHandle, no native handles — so its teardown contract is testable here.

use super::*;
use crate::browser::recovery::{RecoveryAction, MAX_AUTO_RELOADS};

fn surface_with_tab(tab_id: &str) -> BrowserSurface {
    let s = BrowserSurface::default();
    s.registry.lock().unwrap().create(tab_id, "main").unwrap();
    s
}

#[test]
fn forget_tab_drops_the_registry_entry_and_the_crash_budget_together() {
    let s = surface_with_tab("t1");
    s.crash_trackers
        .lock()
        .unwrap()
        .entry("t1".into())
        .or_default()
        .on_crash();

    s.forget_tab("t1").unwrap();

    assert!(!s.registry.lock().unwrap().contains("t1"));
    assert!(!s.crash_trackers.lock().unwrap().contains_key("t1"));
}

#[test]
fn a_reused_tab_id_does_not_inherit_the_previous_tab_s_crash_budget() {
    // The bug this pins: destroy removed the registry entry but left the crash
    // tracker behind. A tab id reused later started life with an EXHAUSTED budget,
    // so its very first crash refused to auto-reload — and every unique tab ever
    // opened leaked one map entry for the life of the process.
    let s = surface_with_tab("t1");
    {
        let mut trackers = s.crash_trackers.lock().unwrap();
        let t = trackers.entry("t1".into()).or_default();
        for _ in 0..=MAX_AUTO_RELOADS {
            t.on_crash(); // burn the whole budget, then one past it
        }
        assert_eq!(t.on_crash(), RecoveryAction::ManualOnly);
    }

    s.forget_tab("t1").unwrap();
    s.registry.lock().unwrap().create("t1", "main").unwrap();

    let mut trackers = s.crash_trackers.lock().unwrap();
    let fresh = trackers.entry("t1".into()).or_default();
    assert_eq!(fresh.consecutive(), 0);
    assert_eq!(fresh.on_crash(), RecoveryAction::AutoReload);
}

#[test]
fn forget_tab_is_idempotent_for_an_unknown_tab() {
    let s = BrowserSurface::default();
    s.forget_tab("never-existed").unwrap();
    assert!(s.registry.lock().unwrap().is_empty());
}

/// Advance `tab_id` to `generation` (a fresh tab starts at 0).
fn navigate_to_generation(s: &BrowserSurface, tab_id: &str, generation: u64) {
    let mut reg = s.registry.lock().unwrap();
    while reg.generation(tab_id).unwrap() < generation {
        reg.bump_generation(tab_id).unwrap();
    }
}

#[test]
fn human_attachment_is_bound_to_generation_and_once_mode_is_consumed() {
    let s = surface_with_tab("t1");
    navigate_to_generation(&s, "t1", 3);
    s.attach_tab("t1".into(), 3, true).unwrap();
    assert!(s.is_tab_attached("t1", 3));
    assert!(!s.is_tab_attached("t1", 4));
    // The consumption logic lives in the free `consume_attachment_in` (so the auth
    // gate can hold the attachments lock across a one-shot spend, authorize.rs).
    assert!(super::consume_attachment_in(
        &mut s.attachments.lock().unwrap(),
        "t1",
        3
    ));
    assert!(!s.is_tab_attached("t1", 3));

    navigate_to_generation(&s, "t1", 5);
    s.attach_tab("t1".into(), 5, false).unwrap();
    assert!(super::consume_attachment_in(
        &mut s.attachments.lock().unwrap(),
        "t1",
        5
    ));
    assert!(s.is_tab_attached("t1", 5));
}

// Audit 20260903 round 3, #35 — attachments are written only for a tab the
// registry knows at that generation, under the registry guard; and a forget clears
// every piece of tab-scoped state under that same guard.

#[test]
fn attach_tab_refuses_an_unknown_tab_and_a_generation_the_tab_is_not_at() {
    let s = surface_with_tab("t1");
    assert_eq!(
        s.attach_tab("ghost".into(), 0, false),
        Err("STALE_NAVIGATION".into())
    );
    assert_eq!(
        s.attach_tab("t1".into(), 1, false),
        Err("STALE_NAVIGATION".into()),
        "a generation the tab has not reached"
    );
    navigate_to_generation(&s, "t1", 1);
    assert_eq!(
        s.attach_tab("t1".into(), 0, false),
        Err("STALE_NAVIGATION".into()),
        "a generation the tab has left"
    );
    assert!(!s.is_tab_attached("ghost", 0));
    assert!(!s.is_tab_attached("t1", 0));
    assert!(!s.is_tab_attached("t1", 1), "a refusal writes nothing");
    s.registry
        .lock()
        .unwrap()
        .transition("t1", crate::browser::registry::Lifecycle::Destroyed)
        .unwrap();
    assert_eq!(
        s.attach_tab("t1".into(), 1, false),
        Err("STALE_NAVIGATION".into()),
        "a tab in teardown binds nothing"
    );
}

#[test]
fn a_forgotten_tabs_attachment_never_reaches_the_ids_next_tenant() {
    let s = surface_with_tab("t1");
    s.attach_tab("t1".into(), 0, false).unwrap();
    s.forget_tab("t1").unwrap();
    // The attachment went with the entry, so an attach for the dead id is refused…
    assert_eq!(
        s.attach_tab("t1".into(), 0, false),
        Err("STALE_NAVIGATION".into())
    );
    // …and the id's next tenant starts unattached at generation 0.
    s.registry.lock().unwrap().create("t1", "main").unwrap();
    assert!(!s.is_tab_attached("t1", 0));
    s.attach_tab("t1".into(), 0, false).unwrap();
    assert!(
        s.is_tab_attached("t1", 0),
        "the new tenant attaches on its own"
    );
}

use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

#[test]
fn attach_tab_takes_the_registry_guard_so_it_cannot_interleave_with_a_forget() {
    // The check ("alive at this generation") and the write are one step against
    // the registry: while another thread holds the registry, the attach waits.
    let s = Arc::new(surface_with_tab("t1"));
    let held = s.registry.lock().unwrap();
    let (done_tx, done_rx) = mpsc::channel::<Result<(), String>>();
    let worker = {
        let s = Arc::clone(&s);
        thread::spawn(move || done_tx.send(s.attach_tab("t1".into(), 0, false)).unwrap())
    };
    assert!(
        done_rx.recv_timeout(Duration::from_millis(200)).is_err(),
        "attach_tab wrote while another thread held the registry guard"
    );
    assert!(!s.is_tab_attached("t1", 0));
    drop(held);
    assert_eq!(
        done_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("attach completes once the guard is free"),
        Ok(())
    );
    worker.join().unwrap();
    assert!(s.is_tab_attached("t1", 0));
}

#[test]
fn forget_tab_holds_the_registry_guard_across_the_attachment_cleanup() {
    // The bug: the entry was removed, the registry guard released, and the
    // attachment cleared afterwards — a window in which the id could be re-created
    // and re-attached, and this cleanup would then erase the NEW tab's attachment.
    let s = Arc::new(surface_with_tab("t1"));
    s.attach_tab("t1".into(), 0, false).unwrap();
    // Hold the ATTACHMENTS lock so forget_tab blocks at its last step.
    let attachments = s.attachments.lock().unwrap();
    let (done_tx, done_rx) = mpsc::channel::<Result<(), String>>();
    let worker = {
        let s = Arc::clone(&s);
        thread::spawn(move || done_tx.send(s.forget_tab("t1")).unwrap())
    };
    // Wait until the worker holds the registry: it has removed the entry and is
    // blocked on the attachments we hold.
    let deadline = Instant::now() + Duration::from_secs(5);
    while s.registry.try_lock().is_ok() {
        assert!(
            Instant::now() < deadline,
            "forget_tab never took the registry guard"
        );
        thread::sleep(Duration::from_millis(5));
    }
    assert!(
        done_rx.try_recv().is_err(),
        "forget_tab finished without the attachments lock"
    );
    // The property under test: blocked on the attachments, forget_tab is STILL
    // holding the registry, so no create or attach for this id can run in the gap.
    assert!(
        s.registry.try_lock().is_err(),
        "the registry guard was released before the attachment cleanup"
    );
    drop(attachments);
    assert_eq!(
        done_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("forget completes once the attachments lock is free"),
        Ok(())
    );
    worker.join().unwrap();
    assert!(!s.is_tab_attached("t1", 0));
    assert!(s.registry.lock().unwrap().is_empty());
    assert!(s.registry.try_lock().is_ok(), "every guard released");
}

// WI-1.9 — the non-macOS stub. A green macOS suite says NOTHING about Windows or
// Linux, where every native entry point is an explicit "unsupported" stub. This
// asserts the stub is actually wired, so the failure mode there stays an honest
// refusal rather than a silent no-op that looks like success to the caller.
//
// Compiled only off macOS (there is no stub to test on macOS), so on the primary
// platform it is inert by design — its value is in CI's Windows/Linux legs.
#[cfg(not(target_os = "macos"))]
mod unsupported_platform {
    #[test]
    fn every_native_entry_point_refuses_rather_than_silently_succeeding() {
        // Compile-time proof the stubs exist with the expected signatures; each
        // returns Err, so no caller can mistake "not implemented" for "done".
        // (Constructing an AppHandle needs a running Tauri app, so this asserts the
        // shape of the surface rather than invoking it.)
        fn _assert_signatures() {
            use crate::browser::native_failure::NativeSurfaceError;
            let _: fn(&tauri::AppHandle, String, String, String) -> Result<(), NativeSurfaceError> =
                super::super::create;
            // `navigate` and `create_with_mode` are typed too (round 4, #31): their
            // callers' closures in `ai_transactions.rs` take `NativeSurfaceError`.
            let _: fn(&tauri::AppHandle, String, String) -> Result<(), NativeSurfaceError> =
                super::super::navigate;
            let _: fn(&tauri::AppHandle, String) -> Result<(), NativeSurfaceError> =
                super::super::destroy;
            // 4 args: eval gained `expected_generation` in WI-2.1, and a typed
            // error in audit 20260903 E-03. A stale signature here compiles fine
            // on macOS (where this module is cfg'd out) and breaks the
            // Windows/Linux build — the one thing this test exists to protect.
            let _: fn(
                &tauri::AppHandle,
                String,
                String,
                u64,
            ) -> Result<String, crate::browser::eval_outcome::EvalError> = super::super::eval;
            // The 7-argument creation signature (mode, profile, and the loopback
            // posture the content rule list is compiled for — audit 20260903 P-01).
            type CreateWithMode = fn(
                &tauri::AppHandle,
                String,
                String,
                String,
                crate::browser::registry::AutomationMode,
                Option<String>,
                bool,
            ) -> Result<(), NativeSurfaceError>;
            let _: CreateWithMode = super::super::create_with_mode;
            let _: fn(&tauri::AppHandle, u64, bool, String) -> Result<(), NativeSurfaceError> =
                super::super::dialog_respond;
            let _: fn(&tauri::AppHandle, String) -> Result<String, NativeSurfaceError> =
                super::super::screenshot;
        }
    }
}

// Audit 20260903 A-03 — grants are per window, read by the tab's owner.
#[test]
fn grants_of_reads_one_windows_slice_and_denies_everything_else() {
    use crate::browser::origin_guard::StandingGrant;
    let mut by_window: HashMap<String, Vec<StandingGrant>> = HashMap::new();
    by_window.insert(
        "a".into(),
        vec![StandingGrant {
            origin_pattern: "https://ex.com".into(),
            operations: vec!["click".into()],
        }],
    );
    assert_eq!(grants_of(&by_window, Some("a")).len(), 1);
    assert!(
        grants_of(&by_window, Some("b")).is_empty(),
        "a window that never synced"
    );
    assert!(
        grants_of(&by_window, None).is_empty(),
        "an unknown tab has no window"
    );

    let s = BrowserSurface::default();
    *s.grants.lock().unwrap() = by_window;
    assert!(s.is_granted_in_window(Some("a"), "https://ex.com/p", "click"));
    assert!(!s.is_granted_in_window(Some("a"), "https://ex.com/p", "type"));
    assert!(!s.is_granted_in_window(Some("b"), "https://ex.com/p", "click"));
    assert!(!s.is_granted_in_window(None, "https://ex.com/p", "click"));
}

#[test]
fn clear_tab_authority_in_drops_one_shots_and_the_attachment_under_the_callers_guard() {
    use crate::browser::one_shot::OneShot;
    let s = surface_with_tab("t");
    navigate_to_generation(&s, "t", 1);
    s.one_shots.lock().unwrap().push(OneShot {
        tab_id: "t".into(),
        generation: 1,
        origin_pattern: "https://a.example".into(),
        operation: "click".into(),
        target: None,
        payload_hash: None,
    });
    s.attach_tab("t".into(), 1, true).unwrap();
    assert!(
        s.is_tab_attached("t", 1),
        "the attachment exists before the clear"
    );
    assert_eq!(s.one_shots.lock().unwrap().len(), 1);
    // The guard is the caller's: taken here, handed in by `&mut`, released after.
    let mut reg = s.registry.lock().unwrap();
    s.clear_tab_authority_in(&mut reg, "t");
    drop(reg);
    assert!(!s.is_tab_attached("t", 1));
    assert!(s.one_shots.lock().unwrap().is_empty());
}
