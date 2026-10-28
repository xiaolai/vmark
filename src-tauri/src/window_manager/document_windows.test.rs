//! Tests for `document_windows.rs` (included via `#[path]`; split from the
//! former single window_manager test file).

use super::*;

// -- get_cascaded_position ------------------------------------------------

#[test]
fn cascade_first_window() {
    let (x, y) = get_cascaded_position(0);
    assert_eq!(x, BASE_X);
    assert_eq!(y, BASE_Y);
}

#[test]
fn cascade_third_window() {
    let (x, y) = get_cascaded_position(3);
    assert_eq!(x, BASE_X + 3.0 * CASCADE_OFFSET);
    assert_eq!(y, BASE_Y + 3.0 * CASCADE_OFFSET);
}

#[test]
fn cascade_wraps_after_max() {
    // Position at MAX_CASCADE should wrap to 0
    let (x, y) = get_cascaded_position(MAX_CASCADE);
    assert_eq!(x, BASE_X);
    assert_eq!(y, BASE_Y);
}

#[test]
fn cascade_wraps_correctly() {
    // Position at MAX_CASCADE + 2 should be same as position 2
    let (x1, y1) = get_cascaded_position(2);
    let (x2, y2) = get_cascaded_position(MAX_CASCADE + 2);
    assert_eq!(x1, x2);
    assert_eq!(y1, y2);
}

// -- allocate_window_label ------------------------------------------------

/// The label spells the counter value the cascade parses back out.
///
/// This is the allocator's stated contract (`next_window_label`: "the
/// `doc-{n}` spelling is the allocator's contract with
/// `create_document_window_with_label_and_url`, which parses the number back
/// out for the cascade"), and it is deterministic because
/// `next_window_label` hands back the very count it used — no second
/// observation of the shared counter is involved.
#[test]
fn a_label_spells_the_counter_value_it_was_allocated_from() {
    let (count, label) = next_window_label();
    assert_eq!(label, format!("doc-{count}"));
    assert_eq!(
        label.strip_prefix("doc-").and_then(|n| n.parse().ok()),
        Some(count)
    );
}

/// What the allocator actually promises: every label is DISTINCT, and the
/// numbers only ever go up.
///
/// This used to assert `n2 == n1 + 1`, which is not a property of
/// `WINDOW_COUNTER`: it is a process-global `AtomicU32`, and five other sites
/// in this same test binary allocate from it (`tab_transfer.test.rs` twice,
/// the sibling test below, plus `hot_exit`/`workspace::transfer` paths reached
/// from tests). Two allocations are adjacent only when nothing else allocates
/// in between, which no test can arrange and none should have to — observed
/// failing on 2026-09-09 with `left: 13, right: 12`, one interleaved
/// allocation. Uniqueness is what `allocate_window_label`'s own doc promises
/// ("Allocate a UNIQUE window label"), and it is what a window label is FOR:
/// two windows sharing one label is the defect. Monotonicity is what makes
/// uniqueness hold for the life of the process.
///
/// Asserting it over a batch rather than a pair is deliberate — a swap or a
/// repeat anywhere in a run of allocations fails here, where two samples
/// could not see it.
#[test]
fn labels_are_unique_and_strictly_increasing() {
    let numbers: Vec<u32> = (0..8)
        .map(|_| {
            let label = allocate_window_label();
            let n = label
                .strip_prefix("doc-")
                .unwrap_or_else(|| panic!("label must be doc-prefixed, got {label:?}"));
            n.parse()
                .unwrap_or_else(|_| panic!("label must carry a u32, got {label:?}"))
        })
        .collect();

    for pair in numbers.windows(2) {
        assert!(
            pair[1] > pair[0],
            "labels must strictly increase, got {numbers:?}"
        );
    }
    let mut sorted = numbers.clone();
    sorted.dedup();
    assert_eq!(sorted.len(), numbers.len(), "labels must be distinct");
}

// -- pick_reopen_workspace_root_with --------------------------------------

#[test]
fn pick_reopen_returns_what_the_resolver_judged() {
    // Not the remembered NAME (#490): the resolver's answer is the value that
    // travels on, so a recent entry that resolves elsewhere scopes the window
    // to what it resolves to, and can no longer be re-pointed afterwards.
    let pick = pick_reopen_workspace_root_with(Some("/some/link".to_string()), |_| {
        Some("/some/real/workspace".to_string())
    });
    assert_eq!(pick, Some("/some/real/workspace".to_string()));
}

#[test]
fn pick_reopen_returns_none_when_path_missing() {
    // Path was the user's last workspace but the folder has been deleted
    // or moved — fall back to no-workspace so the new window opens fresh.
    let pick = pick_reopen_workspace_root_with(Some("/deleted/path".to_string()), |_| None);
    assert_eq!(pick, None);
}

#[test]
fn pick_reopen_returns_none_when_snapshot_empty() {
    // Fresh install or all recents cleared — never opened a workspace.
    let pick = pick_reopen_workspace_root_with(None, |p| Some(p.to_string()));
    assert_eq!(pick, None);
}

/// The real resolver: canonicalize, require a directory, hand on the CANONICAL
/// path. A symlinked recent entry must reopen the target it names today, and
/// the value the window is scoped to must be that target — not the link, which
/// resolves again every time anything touches it (#250, #490).
#[test]
fn pick_reopen_resolves_a_symlinked_recent_entry_to_its_target() {
    let dir = tempfile::tempdir().expect("create tempdir");
    let real = dir.path().join("workspace");
    std::fs::create_dir(&real).expect("mkdir");
    // Built through the SAME helper the shipped resolver ends in, so the two
    // cannot disagree about spelling. A bare `canonicalize()` keeps Windows's
    // `\\?\` verbatim prefix, which `canonical_string` strips on purpose (#250)
    // — the expectation, not production, was the wrong one there.
    let canonical = crate::canonical_path::canonical_string(
        &real.canonicalize().expect("canonical"),
        "the test workspace",
    )
    .expect("a UTF-8 canonical path");

    assert_eq!(
        pick_reopen_workspace_root_with(Some(real.to_string_lossy().into_owned()), resolver),
        Some(canonical.clone()),
    );

    #[cfg(unix)]
    {
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&real, &link).expect("symlink");
        assert_eq!(
            pick_reopen_workspace_root_with(Some(link.to_string_lossy().into_owned()), resolver),
            Some(canonical.clone()),
            "the TARGET is what the window is scoped to, never the link name"
        );
    }
}

#[test]
fn pick_reopen_rejects_a_missing_path_and_a_regular_file() {
    // A regression to a weaker predicate — `exists()` instead of `is_dir()` —
    // would silently route the dock-reopen URL at a file path.
    let dir = tempfile::tempdir().expect("create tempdir");
    let missing = dir
        .path()
        .join("does-not-exist")
        .to_string_lossy()
        .into_owned();
    let file = dir.path().join("not-a-workspace.md");
    std::fs::write(&file, b"hi").expect("write");

    assert_eq!(
        pick_reopen_workspace_root_with(Some(missing), resolver),
        None
    );
    assert_eq!(
        pick_reopen_workspace_root_with(Some(file.to_string_lossy().into_owned()), resolver),
        None,
    );
}

/// The exact closure `pick_reopen_workspace_root` passes, so these tests
/// exercise the shipped resolution rather than a restatement of it.
fn resolver(p: &str) -> Option<String> {
    let canonical = std::path::Path::new(p).canonicalize().ok()?;
    if !canonical.is_dir() {
        return None;
    }
    crate::canonical_path::canonical_string(&canonical, "the recent workspace").ok()
}

// -- initial_window_title -------------------------------------------------
//
// Issue #1296. The title was unconditionally empty because the builder assumes
// macOS's overlay title bar, where the native title text is hidden and an empty
// string is the only correct value. Off macOS the OS draws a REAL title bar, so
// an empty string is a blank strip until the frontend's first title update —
// and a blank one is what the reporter saw. Both legs are asserted per target,
// which the 3-OS CI matrix exercises.

#[cfg(target_os = "macos")]
#[test]
fn initial_title_is_empty_where_the_native_title_is_hidden() {
    // TitleBarStyle::Overlay + hidden_title(true): the app draws its own strip,
    // so a non-empty title would only ever surface in the Window menu.
    assert_eq!(initial_window_title("VMark"), "");
}

#[cfg(not(target_os = "macos"))]
#[test]
fn initial_title_names_the_app_where_the_title_bar_is_visible() {
    // Whatever the app is called — the point is that the visible title bar gets
    // that name and not a blank strip.
    assert_eq!(initial_window_title("VMark"), "VMark");
    assert_eq!(initial_window_title("Renamed"), "Renamed");
}

/// #487/#489 — the allocator's spelling and the cascade parser's grammar are
/// ONE contract.
///
/// `create_document_window_with_label_and_url` parses the counter back out of
/// the label to place the window, and falls back to position zero when it
/// cannot. While the `doc-{n}` format was written out in three places, nothing
/// checked that the thing produced is the thing parsed — so a change to the
/// spelling would have silently cascaded every restored window to one corner.
#[test]
fn every_allocated_label_parses_back_to_the_counter_that_made_it() {
    for _ in 0..3 {
        let (count, label) = next_window_label();
        assert_eq!(
            label
                .strip_prefix("doc-")
                .and_then(|n| n.parse::<u32>().ok()),
            Some(count),
            "the allocator produced {label:?}, which the cascade parser reads as position 0"
        );
    }
}

/// The public allocator and the internal one are the same allocation — a
/// second counter would hand two windows the same label.
#[test]
fn allocate_window_label_is_the_same_allocation_as_the_creation_path() {
    let a = allocate_window_label();
    let (_, b) = next_window_label();
    assert_ne!(a, b, "two allocations must never collide");
}

// -- ensure_main_window (WI-RA7.1) -------------------------------------------
//
// `main` is asked for by the Dock icon, a Finder open, a re-queued open and a
// second launch, on different threads. Each used to check for it and then
// build it, and Tauri registers a label unconditionally after the check, so
// two of them arriving together built two windows named `main`.

// `tauri::test` does not exist on Windows (see Cargo.toml's target-specific
// dev-dependency); every mock-runtime test in this crate is gated to match.
#[cfg(not(target_os = "windows"))]
mod main_window {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier};

    use tauri::{Listener, Manager};

    use super::super::{ensure_main_window, MAIN_LABEL};
    use crate::window_manager::Ensured;

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app")
    }

    #[test]
    fn the_first_call_builds_main_and_the_next_finds_it() {
        let app = mock_app();

        let first = ensure_main_window(app.handle(), Some("/repo 文档")).expect("first");
        let Ensured::Created(window) = first else {
            panic!("no main window existed, so this call builds it");
        };
        assert_eq!(window.label(), MAIN_LABEL);
        let url = window.url().expect("url");
        assert!(
            url.query().is_some_and(|q| q.contains("workspaceRoot=")),
            "the new main is scoped to the workspace it was asked for: {url}"
        );

        let second = ensure_main_window(app.handle(), None).expect("second");
        assert!(matches!(second, Ensured::Existing(_)));
        assert_eq!(app.webview_windows().len(), 1);
    }

    #[test]
    fn callers_racing_for_main_build_it_once() {
        const CALLERS: usize = 12;
        for round in 0..40 {
            let app = mock_app();
            let built = Arc::new(AtomicUsize::new(0));
            let seen = Arc::clone(&built);
            app.listen_any("tauri://window-created", move |event| {
                let payload: serde_json::Value =
                    serde_json::from_str(event.payload()).expect("a JSON payload");
                if payload["label"] == MAIN_LABEL {
                    seen.fetch_add(1, Ordering::SeqCst);
                }
            });
            let start = Arc::new(Barrier::new(CALLERS));

            let callers: Vec<_> = (0..CALLERS)
                .map(|_| {
                    let handle = app.handle().clone();
                    let start = Arc::clone(&start);
                    std::thread::spawn(move || {
                        start.wait();
                        matches!(ensure_main_window(&handle, None), Ok(Ensured::Created(_)))
                    })
                })
                .collect();
            let created = callers
                .into_iter()
                .map(|caller| caller.join().expect("no caller panics"))
                .filter(|created| *created)
                .count();

            assert_eq!(created, 1, "round {round}: one caller builds main");
            assert_eq!(built.load(Ordering::SeqCst), 1, "round {round}");
        }
    }

    /// The destroyed `main`'s release tombstones its bare label in the
    /// journal writer; the rebuild must reopen it, or no capture of the new
    /// `main` ever pins its base. The mock runtime drops a destroyed window
    /// from the app only inside a running event loop, so the old `main` is
    /// modelled by its release alone: no window holds the label when the
    /// release runs, exactly as after the app's `Destroyed` handler.
    #[test]
    fn rebuilding_main_after_its_release_reopens_the_label_in_the_journal() {
        use crate::agent_journal::service::{self, start, AgentJournalState};
        let app = mock_app();
        let data = tempfile::tempdir().expect("tempdir");
        let state = AgentJournalState::default();
        state.finish(Ok(start(data.path()).expect("the journal starts")));
        app.manage(state);
        let writer = app
            .state::<AgentJournalState>()
            .writer()
            .expect("the journal is ready");
        let remembered = || writer.lock().released.iter().any(|r| r == MAIN_LABEL);

        service::release_window_label(app.handle(), MAIN_LABEL);
        assert!(remembered(), "the release tombstones the bare label");

        let rebuilt = ensure_main_window(app.handle(), None).expect("rebuild");
        assert!(matches!(rebuilt, Ensured::Created(_)), "main was rebuilt");
        assert!(!remembered(), "the rebuild reopened the label");
    }

    /// The reversed order: the new `main` is built first and the old one's
    /// release lands after it. Tauri has already dropped the old window from
    /// the app when its `Destroyed` handler runs, so the `main` the release
    /// finds is the new one, and the release must not leave its label
    /// tombstoned: a refused base is not pinned and the collector takes it.
    #[test]
    fn a_release_landing_after_main_was_rebuilt_leaves_the_label_open() {
        use crate::agent_journal::ids::DocId;
        use crate::agent_journal::record::ObservedRef;
        use crate::agent_journal::service::{self, start, AgentJournalState};
        let app = mock_app();
        let data = tempfile::tempdir().expect("tempdir");
        let state = AgentJournalState::default();
        state.finish(Ok(start(data.path()).expect("the journal starts")));
        app.manage(state);
        let writer = app
            .state::<AgentJournalState>()
            .writer()
            .expect("the journal is ready");

        let built = ensure_main_window(app.handle(), None).expect("build");
        assert!(matches!(built, Ensured::Created(_)));
        service::release_window_label(app.handle(), MAIN_LABEL);

        assert!(
            !writer.lock().released.iter().any(|r| r == MAIN_LABEL),
            "the live main's label is not tombstoned"
        );
        writer.register_window_base("main/t1@new", DocId::new(), ObservedRef::Genesis);
        assert!(writer.lock().window_bases.contains_key("main/t1@new"));
    }
}
