//! Tests for `capture.rs`: the time and size bounds on a helper process.

use super::*;
use crate::ai_provider::spawn::build_command;

#[cfg(unix)]
fn sh(script: &str) -> Command {
    let mut c = crate::ai_provider::build_command("/bin/sh", &[]);
    c.args(["-c", script]);
    c
}

#[cfg(unix)]
#[test]
fn capture_returns_stdout_on_success() {
    let out = capture_stdout_with_timeout(
        sh("printf hello-capture"),
        std::time::Duration::from_secs(5),
        "test",
    );
    assert_eq!(out.as_deref(), Some("hello-capture"));
}

#[cfg(unix)]
#[test]
fn capture_none_on_nonzero_exit() {
    let out = capture_stdout_with_timeout(
        sh("printf partial; exit 3"),
        std::time::Duration::from_secs(5),
        "test",
    );
    assert_eq!(out, None);
}

#[test]
fn capture_none_on_spawn_failure() {
    let out = capture_stdout_with_timeout(
        crate::ai_provider::build_command("/no/such/binary/vmark-xyz", &[]),
        std::time::Duration::from_secs(1),
        "test",
    );
    assert_eq!(out, None);
}

#[cfg(unix)]
#[test]
fn capture_timeout_kills_long_running_child() {
    let started = std::time::Instant::now();
    let out = capture_stdout_with_timeout(
        sh("sleep 10"),
        std::time::Duration::from_millis(200),
        "test",
    );
    assert_eq!(out, None);
    assert!(
        started.elapsed() < std::time::Duration::from_secs(3),
        "timeout must kill the child promptly, took {:?}",
        started.elapsed()
    );
}

#[test]
fn detailed_capture_names_each_failure() {
    let bound = std::time::Duration::from_secs(5);
    assert_eq!(
        capture_stdout_detailed(build_command("/no/such/vmark-xyz", &[]), bound, "t"),
        Err(CaptureFailure::Spawn)
    );
    #[cfg(unix)]
    {
        let sh = |script: &str| build_command("sh", &["-c", script]);
        assert_eq!(
            capture_stdout_detailed(sh("echo ok"), bound, "t").as_deref(),
            Ok("ok\n")
        );
        assert_eq!(
            capture_stdout_detailed(sh("exit 3"), bound, "t"),
            Err(CaptureFailure::Exit)
        );
        assert_eq!(
            capture_stdout_detailed(sh("sleep 5"), std::time::Duration::from_millis(100), "t"),
            Err(CaptureFailure::Timeout)
        );
    }
}

/// A shell rc file that starts a daemon leaks stdout to it, so the shell can
/// exit while the pipe stays open for the daemon's whole life. The bound has to
/// cover that wait as well: the PATH probe holds its cache's lock across a first
/// capture, and an unbounded wait would stall every reader of PATH.
#[cfg(unix)]
#[test]
fn the_bound_also_covers_a_grandchild_holding_stdout_open() {
    let started = std::time::Instant::now();
    let got = capture_stdout_detailed(
        build_command("sh", &["-c", "sleep 4 & echo ok"]),
        std::time::Duration::from_millis(300),
        "t",
    );
    assert_eq!(got, Err(CaptureFailure::Timeout));
    assert!(
        started.elapsed() < std::time::Duration::from_secs(3),
        "waited {:?} for the grandchild",
        started.elapsed()
    );
}

/// After a timeout nothing reads the pipe, so a grandchild still writing must
/// see it close rather than feed a buffer no one will ever collect.
#[cfg(unix)]
#[test]
fn a_grandchild_that_keeps_writing_sees_the_pipe_close_after_a_timeout() {
    let dir = tempfile::tempdir().unwrap();
    let closed = dir.path().join("closed");
    // `trap` makes the write fail rather than kill the loop, so the marker can
    // report it. The loop ends by itself so a regression cannot leak a process.
    let script = format!(
        "(trap '' PIPE; i=0; while [ $i -lt 100 ] && echo x; do i=$((i+1)); sleep 0.05; done; \
         [ $i -lt 100 ] && : > '{}') & echo ok",
        closed.display()
    );
    let got = capture_stdout_detailed(
        build_command("sh", &["-c", &script]),
        std::time::Duration::from_millis(200),
        "t",
    );
    assert_eq!(got, Err(CaptureFailure::Timeout));

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
    while !closed.exists() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    assert!(closed.exists(), "the pipe stayed open after the timeout");
}

/// A chunk is ready on nearly every poll here, so only a deadline checked apart
/// from channel readiness ends this capture on time.
#[cfg(unix)]
#[test]
fn the_bound_holds_while_a_grandchild_writes_without_a_pause() {
    let started = std::time::Instant::now();
    let got = capture_stdout_detailed(
        build_command("sh", &["-c", "(while :; do printf x; done) & echo ok"]),
        std::time::Duration::from_millis(300),
        "t",
    );
    assert_eq!(got, Err(CaptureFailure::Timeout));
    assert!(started.elapsed() < std::time::Duration::from_secs(3));
}

#[cfg(unix)]
#[test]
fn output_past_the_cap_stops_the_capture() {
    let got = capture_stdout_detailed(
        build_command("sh", &["-c", "head -c 67108864 /dev/zero"]),
        std::time::Duration::from_secs(20),
        "t",
    );
    assert_eq!(got, Err(CaptureFailure::TooMuchOutput));
}

#[cfg(unix)]
#[test]
fn output_exactly_at_the_cap_is_kept() {
    let script = format!("head -c {MAX_CAPTURE_BYTES} /dev/zero");
    let got = capture_stdout_detailed(
        build_command("sh", &["-c", &script]),
        std::time::Duration::from_secs(20),
        "t",
    );
    assert_eq!(got.map(|text| text.len()), Ok(MAX_CAPTURE_BYTES));
}

/// A child that closes stdout early is still waited for, and still judged by
/// its exit status.
#[cfg(unix)]
#[test]
fn a_child_that_closes_stdout_first_is_still_judged_by_its_exit() {
    let got = capture_stdout_detailed(
        build_command("sh", &["-c", "echo ok; exec >&-; sleep 0.2; exit 3"]),
        std::time::Duration::from_secs(5),
        "t",
    );
    assert_eq!(got, Err(CaptureFailure::Exit));
}

/// Large output spans many chunks and must arrive whole and in order.
#[cfg(unix)]
#[test]
fn output_larger_than_a_chunk_arrives_whole() {
    let got = capture_stdout_detailed(
        build_command(
            "sh",
            &[
                "-c",
                "i=0; while [ $i -lt 20000 ]; do echo $i; i=$((i+1)); done",
            ],
        ),
        std::time::Duration::from_secs(20),
        "t",
    )
    .unwrap();
    let expected: String = (0..20000).map(|i| format!("{i}\n")).collect();
    assert_eq!(got, expected);
}
