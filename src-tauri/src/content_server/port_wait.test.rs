//! Tests for `port_wait.rs`: the port-file poll that decides whether a start
//! saw ITS child's record (#323), whether the child died first, and whether it
//! could be polled at all (#328). Loaded via `#[path]`.

use super::*;
use std::process::Child;

/// A child that outlives the poll, on either platform (mirrors the helper in
/// `manager.test.rs`).
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

/// A child that is already gone by the time it is polled.
fn spawn_exiting() -> Child {
    let mut child = if cfg!(windows) {
        std::process::Command::new("cmd")
            .args(["/C", "exit"])
            .spawn()
    } else {
        std::process::Command::new("true").spawn()
    }
    .expect("spawn exiting child");
    let _ = child.wait();
    child
}

fn write_record(path: &std::path::Path, token: &str, port: u16) {
    std::fs::write(path, format!("{{\"port\":{port},\"token\":\"{token}\"}}"))
        .expect("write port record");
}

#[tokio::test]
async fn a_record_carrying_this_childs_token_is_the_port() {
    let dir = tempfile::tempdir().expect("tempdir");
    let port_file = dir.path().join("ws.port.json");
    write_record(&port_file, "mine", 4321);

    let mut child = spawn_sleeping();
    let waited = await_port_of(&port_file, "mine", &mut child).await;
    assert!(
        matches!(waited, PortWait::Port(4321)),
        "the child's own port"
    );
    let _ = child.kill();
    let _ = child.wait();
}

// The token check is the whole reason a start can survive a concurrent one
// (#323): a record another attempt's child wrote must never be read as this
// child's port, or the bearer token goes to whatever listens there.
#[tokio::test]
async fn a_record_carrying_another_starts_token_is_not_this_childs_port() {
    let dir = tempfile::tempdir().expect("tempdir");
    let port_file = dir.path().join("ws.port.json");
    write_record(&port_file, "the-other-start", 4321);

    // The child exits, so the poll ends on liveness rather than after the
    // full ten-second budget — the foreign record was never accepted.
    let mut child = spawn_exiting();
    assert!(matches!(
        await_port_of(&port_file, "mine", &mut child).await,
        PortWait::Exited
    ));
    assert!(
        port_file.exists(),
        "and the other start's record is untouched"
    );
}

#[tokio::test]
async fn an_unparseable_record_is_skipped_rather_than_trusted() {
    let dir = tempfile::tempdir().expect("tempdir");
    let port_file = dir.path().join("ws.port.json");
    std::fs::write(&port_file, b"not json").expect("write");

    let mut child = spawn_exiting();
    assert!(matches!(
        await_port_of(&port_file, "mine", &mut child).await,
        PortWait::Exited
    ));
}

#[tokio::test]
async fn a_child_that_dies_before_writing_a_record_is_reported_as_exited() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut child = spawn_exiting();
    assert!(matches!(
        await_port_of(&dir.path().join("never-written"), "mine", &mut child).await,
        PortWait::Exited
    ));
}

// #328 — a child the OS cannot poll is not a child that is running. Reading
// the error as "still alive" spent the whole ten-second budget and then
// reported the generic port timeout, losing the real diagnosis. A real
// `Child` cannot be made to fail `try_wait`, hence the seam.
struct UnpollableChild;

impl Pollable for UnpollableChild {
    fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        Err(std::io::Error::other("waitpid refused"))
    }
}

#[tokio::test]
async fn a_child_that_cannot_be_polled_is_reported_at_once_not_waited_out() {
    let dir = tempfile::tempdir().expect("tempdir");
    let started = std::time::Instant::now();
    let waited = await_port_of(
        &dir.path().join("never-written"),
        "mine",
        &mut UnpollableChild,
    )
    .await;
    match waited {
        PortWait::PollFailed(detail) => assert!(detail.contains("waitpid refused"), "{detail}"),
        other => panic!("the poll failure must travel, got {:?}", DebugWait(&other)),
    }
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "reported at once, not after the ten-second budget"
    );
}

/// `PortWait` has no `Debug`; this is enough to name it in a failure.
struct DebugWait<'a>(&'a PortWait);

impl std::fmt::Debug for DebugWait<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self.0 {
            PortWait::Port(_) => "Port",
            PortWait::Exited => "Exited",
            PortWait::PollFailed(_) => "PollFailed",
            PortWait::TimedOut => "TimedOut",
        })
    }
}

// ===== #327 — port 0 announces a readiness the server does not have =======

#[tokio::test]
async fn a_record_claiming_port_zero_is_not_accepted_as_this_childs_port() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("port.json");
    write_record(&path, "tok-1", 0);
    let mut child = spawn_exiting();

    // Port 0 is what a listener reports before it binds. Accepting it handed
    // the caller `http://127.0.0.1:0` behind a registry entry that said the
    // server was running; the record is skipped like one carrying another
    // start's token, so the child's own exit is what is reported.
    let outcome = await_port_of(&path, "tok-1", &mut child).await;
    assert!(
        matches!(outcome, PortWait::Exited),
        "port 0 must not be read as a bound port"
    );
    let _ = child.kill();
}
