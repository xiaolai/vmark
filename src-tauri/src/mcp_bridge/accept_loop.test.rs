//! Tests for `accept_loop.rs` (#167): the real listener, the real shutdown
//! channel, and what happens to the port when the loop ends. Loaded via
//! `#[path]`.

use super::accept_loop;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};

async fn loopback() -> (TcpListener, u16) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    (listener, port)
}

#[tokio::test]
async fn a_shutdown_signal_ends_the_loop_closes_the_port_and_runs_on_exit_once() {
    let (listener, port) = loopback().await;
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let exits = Arc::new(AtomicUsize::new(0));
    let exits_seen = Arc::clone(&exits);
    let (admitted_tx, mut admitted_rx) = mpsc::unbounded_channel();

    let handle = tokio::spawn(accept_loop(
        listener,
        shutdown_rx,
        move |_stream, addr| {
            let _ = admitted_tx.send(addr);
        },
        move || {
            exits_seen.fetch_add(1, Ordering::SeqCst);
        },
    ));

    // Live: a peer can connect while the loop runs — and the loop, not the
    // kernel's backlog, is what accepts it: wait for admission before the
    // shutdown races the accept.
    let peer = TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("the loop is accepting");
    let admitted_addr = tokio::time::timeout(Duration::from_secs(5), admitted_rx.recv())
        .await
        .expect("admitted in time")
        .expect("admission sees the socket");
    assert_eq!(Some(admitted_addr), peer.local_addr().ok());

    shutdown_tx
        .send(())
        .expect("the loop is listening for shutdown");
    tokio::time::timeout(Duration::from_secs(5), handle)
        .await
        .expect("the loop ends on shutdown")
        .expect("the loop task must not panic");

    assert_eq!(exits.load(Ordering::SeqCst), 1, "on_exit runs exactly once");
    assert!(
        admitted_rx.try_recv().is_err(),
        "exactly the one connection was admitted"
    );
    // Closed: the listener went with the loop, so the port refuses.
    let refused = TcpStream::connect(("127.0.0.1", port)).await;
    assert!(
        refused.is_err(),
        "the port must be closed once the loop has exited"
    );
}

#[tokio::test]
async fn every_accepted_socket_is_handed_to_admission_with_its_peer_address() {
    let (listener, port) = loopback().await;
    let (_shutdown_tx, shutdown_rx) = oneshot::channel();
    let (seen_tx, mut seen_rx) = mpsc::unbounded_channel();

    let handle = tokio::spawn(accept_loop(
        listener,
        shutdown_rx,
        move |stream, addr| {
            let _ = seen_tx.send((stream.peer_addr().ok(), addr));
        },
        || {},
    ));

    let mut peers = Vec::new();
    for _ in 0..3 {
        let stream = TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("connect");
        peers.push(stream.local_addr().expect("local addr"));
        let (stream_peer, addr) = tokio::time::timeout(Duration::from_secs(5), seen_rx.recv())
            .await
            .expect("admitted in time")
            .expect("admission sees the socket");
        assert_eq!(
            stream_peer,
            Some(addr),
            "the address handed over is the socket's own peer"
        );
    }
    let last = peers.last().copied().expect("three peers");
    assert!(
        peers.iter().filter(|p| **p == last).count() == 1,
        "distinct sockets, not one socket delivered three times"
    );
    handle.abort();
}

// #362 — shutdown WINS a tie. `select!` picks randomly between ready
// branches, so a socket already sitting in the backlog when the stop signal
// arrives was admitted about half the time, joining a bridge the user had
// just stopped. With `biased;` the outcome is decided, not sampled — which is
// why this can be asserted at all.
#[tokio::test]
async fn a_socket_already_in_the_backlog_is_not_admitted_after_shutdown() {
    for _ in 0..20 {
        let (listener, port) = loopback().await;
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let admitted = Arc::new(AtomicUsize::new(0));

        // Queued BEFORE the loop is polled: the accept branch is ready on the
        // very first poll, and so is the shutdown.
        let _client = TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("connect");
        shutdown_tx.send(()).expect("signal");

        let seen = Arc::clone(&admitted);
        accept_loop(
            listener,
            shutdown_rx,
            move |_stream, _addr| {
                seen.fetch_add(1, Ordering::SeqCst);
            },
            || {},
        )
        .await;
        assert_eq!(
            admitted.load(Ordering::SeqCst),
            0,
            "a stopped bridge admits nothing"
        );
    }
}

#[tokio::test]
async fn dropping_the_shutdown_sender_also_ends_the_loop() {
    // `stop_bridge` takes the sender out of its slot and sends; a sender that
    // is merely dropped (a start that failed after installing it) must not
    // leave an accept loop running forever.
    let (listener, port) = loopback().await;
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let (exit_tx, exit_rx) = oneshot::channel();

    let handle = tokio::spawn(accept_loop(
        listener,
        shutdown_rx,
        |_, _| {},
        move || {
            let _ = exit_tx.send(());
        },
    ));

    drop(shutdown_tx);
    tokio::time::timeout(Duration::from_secs(5), exit_rx)
        .await
        .expect("on_exit fires")
        .expect("sent");
    handle.await.expect("no panic");
    assert!(TcpStream::connect(("127.0.0.1", port)).await.is_err());
}

// ===== Accept failures (#363) ==============================================
//
// The retry counter, its threshold, the backoff and the reset are the loop's
// recovery logic, and nothing reached them: 30 consecutive real `accept`
// failures means exhausting the process's file descriptors, which a test in a
// shared binary must not do. `Scripted` supplies the failures instead.
//
// The clock is PAUSED in these tests, so tokio auto-advances the backoff and
// 29 retries cost no wall time. That is also why the fixture's sockets are
// established UP FRONT: auto-advance fires whenever every task is idle, and a
// task parked on real socket readiness counts as idle — so a `connect().await`
// inside `accept_one` would let a `timeout` around it jump straight to its
// deadline. `accept_one` therefore awaits nothing on the success path.

use super::{Accept, MAX_CONSECUTIVE_ACCEPT_ERRORS};
use std::collections::VecDeque;
use std::io;
use std::net::SocketAddr;
use std::sync::Mutex;

/// One scripted accept: an error, or one of the pre-established sockets.
enum Step {
    Fail,
    Accept,
}

/// A listener whose accepts are a script. Once the script runs out it never
/// completes, so the loop can only leave through shutdown or the error
/// threshold — never by running off the end of the fixture.
struct Scripted {
    steps: Mutex<VecDeque<Step>>,
    ready: Mutex<VecDeque<(TcpStream, SocketAddr)>>,
    /// The client ends, kept alive so the accepted halves stay connected.
    _peers: Vec<TcpStream>,
}

impl Scripted {
    async fn new(steps: Vec<Step>) -> Self {
        let helper = TcpListener::bind("127.0.0.1:0").await.expect("bind helper");
        let addr = helper.local_addr().expect("addr");
        let wanted = steps.iter().filter(|s| matches!(s, Step::Accept)).count();
        let mut ready = VecDeque::new();
        let mut peers = Vec::new();
        for _ in 0..wanted {
            let peer = TcpStream::connect(addr).await.expect("connect");
            ready.push_back(helper.accept().await.expect("accept"));
            peers.push(peer);
        }
        Self {
            steps: Mutex::new(steps.into_iter().collect()),
            ready: Mutex::new(ready),
            _peers: peers,
        }
    }

    fn failures(count: u32) -> Vec<Step> {
        (0..count).map(|_| Step::Fail).collect()
    }
}

impl Accept for Scripted {
    async fn accept_one(&self) -> io::Result<(TcpStream, SocketAddr)> {
        let next = self.steps.lock().expect("script lock").pop_front();
        match next {
            Some(Step::Fail) => Err(io::Error::from(io::ErrorKind::ConnectionAborted)),
            Some(Step::Accept) => Ok(self
                .ready
                .lock()
                .expect("ready lock")
                .pop_front()
                .expect("a socket was established for every Accept step")),
            // Script exhausted: wait forever rather than looping on an end.
            None => std::future::pending().await,
        }
    }
}

#[tokio::test(start_paused = true)]
async fn persistent_accept_errors_end_the_loop_and_run_on_exit_once() {
    let listener = Scripted::new(Scripted::failures(MAX_CONSECUTIVE_ACCEPT_ERRORS)).await;
    let (_shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let exits = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&exits);

    // No timeout needed: the script cannot end any other way, so a loop that
    // failed to give up would hang here rather than pass.
    accept_loop(
        listener,
        shutdown_rx,
        |_, _| {},
        move || {
            seen.fetch_add(1, Ordering::SeqCst);
        },
    )
    .await;

    assert_eq!(exits.load(Ordering::SeqCst), 1, "on_exit runs exactly once");
}

#[tokio::test(start_paused = true)]
async fn one_success_resets_the_consecutive_error_count() {
    // One short of the threshold, a success, then one short again. Without the
    // reset the second run would cross the threshold and the loop would end;
    // it must instead still be running, and end only on shutdown.
    let mut steps = Scripted::failures(MAX_CONSECUTIVE_ACCEPT_ERRORS - 1);
    steps.push(Step::Accept);
    steps.extend(Scripted::failures(MAX_CONSECUTIVE_ACCEPT_ERRORS - 1));
    let listener = Scripted::new(steps).await;

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let (admitted_tx, mut admitted_rx) = mpsc::unbounded_channel();
    let (exit_tx, exit_rx) = oneshot::channel();

    let handle = tokio::spawn(accept_loop(
        listener,
        shutdown_rx,
        move |_, addr| {
            let _ = admitted_tx.send(addr);
        },
        move || {
            let _ = exit_tx.send(());
        },
    ));

    // The one scripted success reaches admission…
    admitted_rx.recv().await.expect("the success is accepted");
    // …and after the second run of errors the loop is still alive, because the
    // reset kept it below the threshold. Nothing left to accept, so it parks;
    // the paused clock skips the backoffs.
    tokio::time::sleep(Duration::from_secs(60)).await;
    assert!(!handle.is_finished(), "the counter must reset on a success");

    shutdown_tx.send(()).expect("the loop is still listening");
    exit_rx.await.expect("on_exit fires");
    handle.await.expect("no panic");
}

#[tokio::test(start_paused = true)]
async fn a_shutdown_during_the_error_backoff_is_not_waited_out() {
    // The backoff used to be a bare `sleep().await` inside the accept arm, so
    // a stop arriving during it waited out up to a second of the failure it
    // was cancelling. Twenty failures is ~10 s of virtual backoff, so the loop
    // is certainly inside one when the shutdown lands.
    let listener = Scripted::new(Scripted::failures(20)).await;
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let (exit_tx, exit_rx) = oneshot::channel();

    let handle = tokio::spawn(accept_loop(
        listener,
        shutdown_rx,
        |_, _| {},
        move || {
            let _ = exit_tx.send(());
        },
    ));

    tokio::time::sleep(Duration::from_millis(250)).await;
    let sent_at = tokio::time::Instant::now();
    shutdown_tx.send(()).expect("the loop is listening");
    exit_rx.await.expect("on_exit fires");
    handle.await.expect("no panic");

    // Virtual time, so "how long the stop waited" is exact: waiting out the
    // rest of a backoff would show as hundreds of milliseconds here.
    assert!(
        sent_at.elapsed() < Duration::from_millis(50),
        "the stop waited out {:?} of a backoff it was cancelling",
        sent_at.elapsed()
    );
}

// ===== on_exit on the paths the loop does not RETURN from (#385) ===========

#[tokio::test]
async fn a_panic_in_admission_still_closes_the_port_and_runs_on_exit() {
    // `on_exit` used to be a plain call after the loop, so it ran only on the
    // paths the loop returns on. A panic in `admit` unwound straight past it,
    // leaving the bridge marked running with a live `port:token` file and no
    // listener — and `spawn_logged`, which catches the panic OUTSIDE this
    // future, saw nothing unusual.
    let (listener, port) = loopback().await;
    let (_shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let (exit_tx, exit_rx) = oneshot::channel();

    let handle = tokio::spawn(accept_loop(
        listener,
        shutdown_rx,
        |_, _| panic!("admission blew up"),
        move || {
            // The ordering `accept_loop` promises: the port is closed BEFORE
            // the caller is told the loop is gone, so a restart cannot race a
            // listener that is still bound. Asserted by REBINDING from inside
            // the hook rather than by connecting after it — a connect run
            // afterwards can be answered by whichever parallel test the OS
            // handed this ephemeral port to next, which is a flake, not a
            // property.
            let rebound = std::net::TcpListener::bind(("127.0.0.1", port)).is_ok();
            let _ = exit_tx.send(rebound);
        },
    ));

    let _peer = TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("the loop is accepting");

    assert!(
        handle.await.unwrap_err().is_panic(),
        "the panic is real, not swallowed by the guard"
    );
    assert!(
        exit_rx.await.expect("on_exit runs during the unwind"),
        "the port was still bound when on_exit was told the loop had gone"
    );
}

#[tokio::test]
async fn dropping_the_loop_future_still_runs_on_exit() {
    // The runtime dropping the task at shutdown is the other non-returning
    // exit: the bridge must not stay marked running behind a listener that
    // has already gone with the future.
    let (listener, port) = loopback().await;
    let (_shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let rebound = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&rebound);

    let fut = accept_loop(
        listener,
        shutdown_rx,
        |_, _| {},
        move || {
            seen.fetch_add(
                usize::from(std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()),
                Ordering::SeqCst,
            );
        },
    );
    let mut fut = Box::pin(fut);
    // Poll once so the loop is genuinely parked on `accept`, then drop it.
    assert!(
        tokio::time::timeout(Duration::from_millis(50), &mut fut)
            .await
            .is_err(),
        "the loop is still running"
    );
    drop(fut);

    assert_eq!(
        rebound.load(Ordering::SeqCst),
        1,
        "on_exit ran on the drop, with the port already released"
    );
}
