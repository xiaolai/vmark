//! Tests for `cleanup.rs` — teardown of a detached content-server child.
//! Loaded via `#[path] mod tests;` so `super::*` is the cleanup module.

use super::*;
use std::io;
use std::process::ExitStatus;

/// A child that stays alive until killed (see `manager.test.rs` for why the
/// Windows spelling differs).
fn spawn_sleeping() -> Child {
    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("powershell");
        c.args(["-NoProfile", "-Command", "Start-Sleep -Seconds 30"]);
        c
    } else {
        let mut c = std::process::Command::new("sleep");
        c.arg("30");
        c
    };
    cmd.spawn().expect("spawn sleeping child")
}

/// A child that has already exited (and been reaped) by the time it is
/// handed in — the state a poll loop leaves behind.
fn spawn_exited() -> Child {
    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "exit", "0"]);
        c
    } else {
        std::process::Command::new("true")
    };
    let mut child = cmd.spawn().expect("spawn exiting child");
    let _ = child.wait();
    child
}

#[cfg(unix)]
fn pid_alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

#[test]
fn cleanup_kills_reaps_and_removes_the_port_file() {
    let child = spawn_sleeping();
    #[cfg(unix)]
    let pid = child.id();
    let dir = tempfile::tempdir().expect("tempdir");
    let port_file = dir.path().join("port.json");
    std::fs::write(&port_file, b"{}").expect("write port file");

    let outcome = Detached {
        child: Some(child),
        port_file: Some(port_file.clone()),
    }
    .cleanup("/ws");

    #[cfg(unix)]
    assert!(!pid_alive(pid), "child {pid} must be killed and reaped");
    assert!(!port_file.exists(), "port file must be removed");
    assert!(outcome.is_clean(), "{outcome}");
    assert!(
        outcome.orphan.is_none(),
        "a reaped child leaves no handle behind"
    );
}

#[test]
fn a_child_that_already_exited_is_reaped_without_panicking() {
    // `kill()` on a reaped child is answered by std from the cached status,
    // without a signal; the reap is what matters and it must neither panic
    // nor skip the port file — nor count as a failure.
    let dir = tempfile::tempdir().expect("tempdir");
    let port_file = dir.path().join("port.json");
    std::fs::write(&port_file, b"{}").expect("write port file");
    let outcome = Detached {
        child: Some(spawn_exited()),
        port_file: Some(port_file.clone()),
    }
    .cleanup("/ws");
    assert!(!port_file.exists());
    assert!(outcome.is_clean(), "{outcome}");
}

#[test]
fn an_absent_port_file_and_no_child_are_the_quiet_steady_state() {
    let dir = tempfile::tempdir().expect("tempdir");
    let outcome = Detached::port_file_only(dir.path().join("never-written.json")).cleanup("/ws");
    assert!(outcome.is_clean(), "{outcome}");
    let outcome = Detached {
        child: None,
        port_file: None,
    }
    .cleanup("/ws");
    assert!(outcome.is_clean(), "{outcome}");
}

// #123 — a registration loser has no port file of its own (it belongs to the
// winner), and the constructor says so instead of a hand-built literal.
#[test]
fn a_child_only_teardown_kills_and_reaps_without_touching_any_file() {
    let child = spawn_sleeping();
    #[cfg(unix)]
    let pid = child.id();
    let outcome = Detached::child_only(child).cleanup("/ws");
    #[cfg(unix)]
    assert!(!pid_alive(pid), "child {pid} must be killed and reaped");
    assert!(outcome.is_clean(), "{outcome}");
}

// #114 / #123 — a step that failed is reported back, not only logged, so the
// explicit stop can refuse to report success over it. The port file has to
// still be there for the caller to know the next start will read it.
#[test]
fn a_port_file_that_cannot_be_removed_is_reported_not_swallowed() {
    // A directory cannot be removed with `remove_file` on any OS, and the
    // refusal is not `NotFound` — the one error cleanup treats as clean.
    let dir = tempfile::tempdir().expect("tempdir");
    let port_file = dir.path().join("port.json");
    std::fs::create_dir(&port_file).expect("dir standing in for the port file");

    let outcome = Detached::port_file_only(port_file.clone()).cleanup("/ws");

    assert!(!outcome.is_clean());
    assert_eq!(outcome.child, None, "no child was handed in");
    let reported = outcome.port_file.as_deref().expect("the port file failure");
    assert!(
        reported.starts_with(&port_file.display().to_string()),
        "the report names the file: {reported}"
    );
    assert!(port_file.exists(), "nothing was removed");
    assert!(
        outcome
            .to_string()
            .starts_with("port file could not be removed: "),
        "{outcome}"
    );
}

#[test]
fn the_outcome_names_every_step_it_could_not_finish() {
    let both = CleanupOutcome {
        child: Some(ChildFailure::Lost("wait failed (kill: sent)".into())),
        port_file: Some("/pf.json: denied".into()),
        orphan: None,
    };
    assert_eq!(
        both.to_string(),
        "child could not be reaped and is no longer this process's: wait failed (kill: sent); port file could not be removed: /pf.json: denied"
    );
    let child_only = CleanupOutcome {
        child: Some(ChildFailure::NotReaped {
            pid: 7,
            detail: "wait failed".into(),
        }),
        port_file: None,
        orphan: None,
    };
    assert_eq!(
        child_only.to_string(),
        "child could not be reaped (pid 7): wait failed"
    );
    assert!(!child_only.is_clean());
    assert_eq!(CleanupOutcome::default().to_string(), "clean");
    let still_running = CleanupOutcome {
        child: Some(ChildFailure::StillRunning {
            pid: 7,
            reason: "refused".into(),
        }),
        port_file: Some("/pf.json: denied".into()),
        orphan: None,
    };
    assert_eq!(
        still_running.to_string(),
        "child is still running (pid 7; kill refused: refused); port file could not be removed: /pf.json: denied"
    );
}

// -- #122: a refused kill is never followed by a blocking wait ---------------
//
// `Child::kill` on a child this process spawned and has not reaped is
// `libc::kill(pid, SIGKILL)` / `TerminateProcess`; std answers `Ok` itself for
// a child that already exited. A refusal therefore means the signal was NOT
// delivered, and `Child::wait` after it would last as long as the child
// chooses to run. A real same-uid child never refuses, so the decision is
// pinned with a scripted one that counts its `wait` calls.

enum Answer {
    Running,
    Exited,
    /// The poll failed without the OS saying whose the pid is.
    Unpollable,
    /// `waitpid` answered ECHILD: reaped elsewhere, not ours any more. Unix
    /// only: Windows has no such answer, an open handle pins the process.
    #[cfg(unix)]
    NotOurs,
}

struct Scripted {
    refuse_kill: bool,
    poll: Answer,
    /// What a `wait` after a DELIVERED kill answers; `None` is a reap.
    wait_error: Option<io::Error>,
    waits: u32,
}

impl Scripted {
    fn refusing(poll: Answer) -> Self {
        Self {
            refuse_kill: true,
            poll,
            wait_error: None,
            waits: 0,
        }
    }
}

/// The error `waitpid` returns for a pid that is not this process's child.
#[cfg(unix)]
fn echild() -> io::Error {
    io::Error::from_raw_os_error(libc::ECHILD)
}

/// A child that has exited and been reaped answers `wait` from its cache.
fn cached_exit_status() -> ExitStatus {
    spawn_exited().wait().expect("cached status")
}

impl Terminable for Scripted {
    fn id(&self) -> u32 {
        4242
    }
    fn kill(&mut self) -> io::Result<()> {
        if self.refuse_kill {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "operation not permitted",
            ))
        } else {
            Ok(())
        }
    }
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        match self.poll {
            Answer::Running => Ok(None),
            Answer::Exited => Ok(Some(cached_exit_status())),
            Answer::Unpollable => Err(io::Error::other("poll failed")),
            #[cfg(unix)]
            Answer::NotOurs => Err(echild()),
        }
    }
    fn wait(&mut self) -> io::Result<ExitStatus> {
        self.waits += 1;
        match self.wait_error.take() {
            Some(e) => Err(e),
            None => Ok(cached_exit_status()),
        }
    }
}

#[test]
fn a_refused_kill_on_a_live_child_is_reported_without_a_blocking_wait() {
    let mut child = Scripted::refusing(Answer::Running);
    let err = terminate("/ws", &mut child).expect_err("nothing has stopped it");
    assert_eq!(
        err,
        ChildFailure::StillRunning {
            pid: 4242,
            reason: "operation not permitted".into(),
        }
    );
    assert_eq!(
        child.waits, 0,
        "a wait here would last as long as the child runs"
    );
    assert_eq!(
        err.to_string(),
        "child is still running (pid 4242; kill refused: operation not permitted)"
    );
}

#[test]
fn a_refused_kill_on_a_child_that_has_exited_is_reaped_all_the_same() {
    let mut child = Scripted::refusing(Answer::Exited);
    assert_eq!(terminate("/ws", &mut child), Ok(()));
    assert_eq!(child.waits, 0);
}

#[test]
fn a_refused_kill_on_a_child_that_cannot_be_polled_keeps_the_handle_and_names_both_refusals() {
    // The verifier's residual on #122: an unpollable child used to become
    // `NotReaped` and lose its handle — a process this app spawned, still
    // ours as far as the OS has said, forgotten. Now it stays an orphan.
    let mut child = Scripted::refusing(Answer::Unpollable);
    let err = terminate("/ws", &mut child).expect_err("unknown state");
    assert_eq!(
        err,
        ChildFailure::NotReaped {
            pid: 4242,
            detail: "poll failed (kill: operation not permitted)".into(),
        }
    );
    assert!(
        err.retains_handle(),
        "still ours: kept for the retry at quit"
    );
    assert_eq!(child.waits, 0);
    assert_eq!(
        err.to_string(),
        "child could not be reaped (pid 4242): poll failed (kill: operation not permitted)"
    );
}

#[cfg(unix)]
#[test]
fn a_pid_the_os_says_is_no_longer_ours_is_lost_and_its_handle_is_dropped() {
    // ECHILD is the one proof: reaped elsewhere, pid possibly recycled. A
    // kill through the handle at quit could reach whatever owns it now.
    let mut child = Scripted::refusing(Answer::NotOurs);
    let err = terminate("/ws", &mut child).expect_err("not ours");
    assert!(matches!(err, ChildFailure::Lost(_)), "{err:?}");
    assert!(!err.retains_handle());
    assert!(
        err.to_string()
            .starts_with("child could not be reaped and is no longer this process's: "),
        "{err}"
    );
    assert_eq!(child.waits, 0);
}

#[test]
fn a_delivered_kill_is_followed_by_the_reap() {
    let mut child = Scripted {
        refuse_kill: false,
        poll: Answer::Running,
        wait_error: None,
        waits: 0,
    };
    assert_eq!(terminate("/ws", &mut child), Ok(()));
    assert_eq!(
        child.waits, 1,
        "the signal was delivered: the reap is prompt, and the reap is what matters"
    );
}

#[test]
fn a_delivered_kill_whose_reap_fails_keeps_the_handle_unless_the_pid_left_us() {
    let mut child = Scripted {
        refuse_kill: false,
        poll: Answer::Running,
        wait_error: Some(io::Error::other("wait failed")),
        waits: 0,
    };
    let err = terminate("/ws", &mut child).expect_err("not reaped");
    assert_eq!(
        err,
        ChildFailure::NotReaped {
            pid: 4242,
            detail: "wait failed".into(),
        }
    );
    assert!(err.retains_handle());

    #[cfg(unix)]
    {
        let mut child = Scripted {
            refuse_kill: false,
            poll: Answer::Running,
            wait_error: Some(echild()),
            waits: 0,
        };
        let err = terminate("/ws", &mut child).expect_err("reaped elsewhere");
        assert!(matches!(err, ChildFailure::Lost(_)), "{err:?}");
        assert!(!err.retains_handle());
    }
}

#[test]
fn the_handle_is_kept_for_every_failure_but_a_lost_pid() {
    // `Detached::cleanup` cannot be driven to these branches with a real
    // child; the rule it applies is pinned on its own.
    let running = ChildFailure::StillRunning {
        pid: 7,
        reason: "refused".into(),
    };
    let unknown = ChildFailure::NotReaped {
        pid: 7,
        detail: "poll failed".into(),
    };
    let lost = ChildFailure::Lost("no child processes".into());
    assert_eq!(keep_or_drop("handle", Ok(())), (None, None));
    assert_eq!(
        keep_or_drop("handle", Err(running.clone())),
        (Some(running), Some("handle"))
    );
    assert_eq!(
        keep_or_drop("handle", Err(unknown.clone())),
        (Some(unknown), Some("handle"))
    );
    assert_eq!(
        keep_or_drop("handle", Err(lost.clone())),
        (Some(lost), None)
    );
}

#[test]
fn a_still_running_report_carries_the_handle_out_as_an_orphan() {
    // `Detached::cleanup` cannot be made to hit the branch with a real child
    // (see above), so the outcome's contract is pinned directly: the handle
    // is taken once, and the report stays.
    let mut outcome = CleanupOutcome {
        child: Some(ChildFailure::StillRunning {
            pid: 7,
            reason: "refused".into(),
        }),
        port_file: None,
        orphan: Some(spawn_exited()),
    };
    assert!(!outcome.is_clean());
    let child = outcome.take_orphan().expect("the handle");
    assert!(outcome.take_orphan().is_none(), "taken once");
    assert!(!outcome.is_clean(), "the report is untouched");
    assert_eq!(
        outcome.to_string(),
        "child is still running (pid 7; kill refused: refused)"
    );
    drop(child);
}

/// #270 — a live handle with no recorded failure is NOT clean.
///
/// `content_server_stop` reports success on `is_clean`, so an outcome that
/// carries a child this process still owns must never answer `true` — even
/// when the error fields happen to be empty. The fields are `pub`, so this is
/// the only thing standing between a hand-assembled value and a "stopped"
/// reported over a running process.
#[test]
fn an_outcome_holding_a_live_handle_is_not_clean_even_with_no_error_recorded() {
    let mut outcome = CleanupOutcome {
        child: None,
        port_file: None,
        orphan: Some(spawn_exited()),
    };
    assert!(
        !outcome.is_clean(),
        "a retained handle is a process the caller could not confirm gone"
    );
    // Display still reads "clean" — the report describes FAILURES, and there
    // is none to name; the handle is what makes the outcome not clean.
    assert_eq!(outcome.to_string(), "clean");
    let child = outcome.take_orphan().expect("the handle");
    assert!(
        outcome.is_clean(),
        "once the manager has taken ownership there is nothing left behind"
    );
    drop(child);
}
