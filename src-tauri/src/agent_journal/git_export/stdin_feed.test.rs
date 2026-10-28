//! Tests for `stdin_feed.rs`: when the OS refuses the writer thread the
//! export reports a stable `ExportError::Git` (not a task panic), and the
//! child it would have fed is stopped and reaped.
//!
//! Edge cases: a child that would block forever on its stdin (so a missed
//! kill hangs the test instead of passing), a successful feed of CJK bytes.

use super::*;
use crate::ai_provider::build_command;
use std::process::Stdio;

/// A `git` that reads stdin until it closes.
fn reading_git() -> (Child, ChildStdin) {
    let mut child = build_command("git", &["hash-object", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("git runs");
    let pipe = child.stdin.take().expect("stdin piped");
    (child, pipe)
}

fn no_threads(_: Builder, _: Feed) -> io::Result<JoinHandle<io::Result<()>>> {
    Err(io::Error::other("Resource temporarily unavailable"))
}

#[test]
fn a_refused_writer_thread_is_a_git_error_and_the_child_is_stopped() {
    let (child, pipe) = reading_git();
    let pid = child.id();
    let err = fed_output(child, pipe, b"x".to_vec(), no_threads).expect_err("no writer");
    assert!(matches!(err, ExportError::Git(_)), "{err:?}");
    assert!(
        err.to_string().contains("cannot start the stdin writer"),
        "{err}"
    );
    // Reaped: the pid no longer names our child.
    #[cfg(unix)]
    assert_ne!(
        // SAFETY: signal 0 only checks that `pid` exists; nothing is sent.
        unsafe { libc::kill(pid as i32, 0) },
        0,
        "child {pid} reaped"
    );
    let _ = pid;
}

#[test]
fn a_started_writer_feeds_the_whole_stdin() {
    let (child, pipe) = reading_git();
    let out = fed_output(child, pipe, "中文\n".as_bytes().to_vec(), start_thread).expect("fed");
    assert!(out.status.success());
    // `git hash-object` of the blob "中文\n".
    let expected = build_command("git", &["hash-object", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .and_then(|mut c| {
            c.stdin.take().unwrap().write_all("中文\n".as_bytes())?;
            c.wait_with_output()
        })
        .expect("git runs");
    assert_eq!(out.stdout, expected.stdout);
}
