//! Tests for `window_sessions.rs` — a destroyed window's PTY sessions are
//! removed from the map and their children killed, and no other window's
//! sessions are touched.

use super::*;
use crate::pty::session::create_session;

/// True while the OS still knows the pid (running OR zombie — a zombie is
/// exactly what an unreaped kill leaves behind).
fn pid_alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

fn sleeping_session_owned_by(owner: &str) -> Session {
    create_session(
        owner.into(),
        "/bin/sleep".into(),
        vec!["30".into()],
        80,
        24,
        None,
        BTreeMap::new(),
    )
    .expect("create session")
}

fn child_pid(session: &Session) -> u32 {
    session
        .child
        .blocking_lock()
        .as_ref()
        .and_then(|c| c.process_id())
        .expect("child pid")
}

fn state_with(sessions: Vec<Session>) -> PtyState {
    let state = PtyState::default();
    {
        let mut map = state.sessions.blocking_write();
        for (i, session) in sessions.into_iter().enumerate() {
            map.insert(i as u32 + 1, Arc::new(session));
        }
    }
    state
}

#[test]
fn take_window_sessions_removes_only_the_destroyed_windows_sessions() {
    let state = state_with(vec![
        sleeping_session_owned_by("doc-1"),
        sleeping_session_owned_by("doc-2"),
        sleeping_session_owned_by("doc-1"),
    ]);

    let taken = take_window_sessions(&state, "doc-1");

    let mut taken_pids: Vec<u32> = taken.iter().map(|(pid, _)| *pid).collect();
    taken_pids.sort_unstable();
    assert_eq!(taken_pids, vec![1, 3]);
    let remaining: Vec<u32> = state.sessions.blocking_read().keys().copied().collect();
    assert_eq!(remaining, vec![2], "another window's session must survive");

    for (_, session) in taken {
        terminate(&session);
    }
    for session in state.sessions.blocking_read().values() {
        terminate(session);
    }
}

#[test]
fn take_window_sessions_is_a_noop_for_a_window_without_terminals() {
    let state = state_with(vec![sleeping_session_owned_by("doc-1")]);
    assert!(take_window_sessions(&state, "settings").is_empty());
    assert_eq!(state.sessions.blocking_read().len(), 1);
    for session in state.sessions.blocking_read().values() {
        terminate(session);
    }
}

#[test]
fn terminate_kills_and_reaps_a_never_started_session() {
    let session = sleeping_session_owned_by("doc-1");
    let pid = child_pid(&session);

    terminate(&session);

    assert!(session.shutdown.load(Ordering::Acquire));
    assert!(!pid_alive(pid), "child {pid} must be killed AND reaped");
}

#[test]
fn terminate_kills_a_started_session_so_its_reader_can_reap_it() {
    let session = sleeping_session_owned_by("doc-1");
    // Simulate pty_start: the reader thread owns the child from here on.
    let mut child = session.child.blocking_lock().take().expect("child");

    terminate(&session);

    // Standing in for the reader thread: the child must now exit on its own
    // (it would sleep 30 s otherwise), so its wait() returns promptly.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if child.try_wait().expect("try_wait").is_some() {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "terminate() must signal a started child"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}
