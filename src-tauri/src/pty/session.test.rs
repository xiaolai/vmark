//! Tests for `session.rs` — session-creation validation and the
//! close-before-start reap path: a session closed between `pty_spawn` and
//! `pty_start` must not leak an unreaped (zombie) child, because no reader
//! thread exists yet to `wait()` on it.

use super::*;

/// `Session` holds non-`Debug` boxed trait objects, so `unwrap_err()` is
/// unavailable — unwrap the error arm manually.
fn expect_create_err(result: Result<Session, String>) -> String {
    match result {
        Ok(_) => panic!("expected create_session to fail"),
        Err(e) => e,
    }
}

#[test]
fn create_session_rejects_relative_shell_path() {
    let err = expect_create_err(create_session(
        "sh".into(),
        vec![],
        80,
        24,
        None,
        BTreeMap::new(),
    ));
    assert!(err.contains("absolute"), "unexpected error: {err}");
}

#[test]
fn create_session_rejects_missing_shell() {
    // Platform-absolute: a Unix-style "/nonexistent/…" is NOT absolute on
    // Windows and would fail the absolute-path check before the existence
    // check this test targets.
    let missing = if cfg!(windows) {
        r"C:\nonexistent\vmark-test-shell"
    } else {
        "/nonexistent/vmark-test-shell"
    };
    let err = expect_create_err(create_session(
        missing.into(),
        vec![],
        80,
        24,
        None,
        BTreeMap::new(),
    ));
    assert!(err.contains("not found"), "unexpected error: {err}");
}

/// True while the OS still knows the pid (running OR zombie — a zombie is
/// exactly what an unreaped kill leaves behind).
#[cfg(unix)]
fn pid_alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

#[cfg(unix)]
fn sleeping_session() -> Session {
    create_session(
        "/bin/sleep".into(),
        vec!["30".into()],
        80,
        24,
        None,
        BTreeMap::new(),
    )
    .expect("create session")
}

#[cfg(unix)]
#[test]
fn kill_and_reap_unstarted_reaps_a_never_started_child() {
    let session = sleeping_session();
    let pid = session
        .child
        .blocking_lock()
        .as_ref()
        .and_then(|c| c.process_id())
        .expect("child pid");
    assert!(pid_alive(pid), "child should be running before close");

    kill_and_reap_unstarted(&session);

    assert!(
        session.child.blocking_lock().is_none(),
        "close must take ownership of the child"
    );
    assert!(
        !pid_alive(pid),
        "child {pid} must be killed AND reaped (a zombie still has a pid entry)"
    );
}

#[cfg(unix)]
#[test]
fn kill_and_reap_unstarted_is_noop_after_reader_took_the_child() {
    let session = sleeping_session();
    // Simulate pty_start: the reader thread takes ownership of the child.
    let mut child = session.child.blocking_lock().take().expect("child");

    kill_and_reap_unstarted(&session); // must not touch the moved child

    assert!(
        session.shutdown.load(Ordering::Acquire),
        "close still signals shutdown for the reader thread"
    );
    // The caller (standing in for the reader thread) still owns and reaps it.
    let _ = child.kill();
    let _ = child.wait();
}
