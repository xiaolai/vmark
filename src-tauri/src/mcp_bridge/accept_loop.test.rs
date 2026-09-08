//! Tests for `accept_loop.rs` (#167): the real listener, the real shutdown
//! channel, and what happens to the port when the loop ends. Loaded via
//! `#[path]`.

use super::accept_loop;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};

async fn loopback() -> (TcpListener, u16) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    (listener, port)
}

/// The real listener, wrapped so that the loop letting go of it is observable
/// without asking the operating system about a port.
///
/// Four tests here need the same fact — the loop let its listener go — and all
/// four used to get it by ASKING THE PORT: two rebound it from inside
/// `on_exit`, two connected to it afterwards and required a refusal. That reads
/// as direct and is not. The ephemeral port table is shared with every other
/// test in this binary and with the rest of the machine, and nothing stops this
/// thread being descheduled across the gap. So "the rebind failed" means
/// *something* holds this port, and "the connect succeeded" means *something*
/// is listening on it — while the tests reported "the loop still holds it",
/// which neither observation supports.
///
/// Both directions were observed, which is what makes this a mechanism rather
/// than an instance. Measured on macOS, 2026-09-08/09: three failures of these
/// tests across 18 full-suite runs — then, with only the two rebinds converted,
/// a further run failed at a CONNECT site instead. A different test, a
/// different spelling, the same shared resource; converting half the class left
/// the other half to fire.
///
/// The ordering itself never varied: it is fixed by declaration order in
/// `accept_loop`, every one of these tests passes deterministically in
/// isolation, and reversing that order fails them in 0.06s, every time. Only
/// the observation varied. Two rival explanations were ruled out by probe
/// rather than by argument: a 2000-iteration replay of exactly this
/// close-then-rebind sequence with a live peer never failed (so it is not the
/// connection's TCP teardown state), and again never failed with eight threads
/// churning ephemeral ports beside it — so the window is a scheduling one,
/// which a quiet probe cannot open.
///
/// Keep new assertions off the port table. Connecting to a port to prove a
/// listener is GONE is the same defect wearing the opposite sign: it fails
/// loudly when a stranger is listening, and passes silently when one is not.
///
/// `Drop` closes the real listener FIRST and only then records the release, so
/// an observed release still means the file descriptor is gone. That is the
/// whole property, observed through a channel nothing else in the process can
/// reach into.
struct ReleaseRecorder {
    /// `None` only after `Drop` has taken and closed it.
    listener: Option<TcpListener>,
    released: Arc<AtomicBool>,
}

impl ReleaseRecorder {
    fn wrap(listener: TcpListener) -> (Self, Arc<AtomicBool>) {
        let released = Arc::new(AtomicBool::new(false));
        let recorder = Self {
            listener: Some(listener),
            released: Arc::clone(&released),
        };
        (recorder, released)
    }
}

impl Drop for ReleaseRecorder {
    fn drop(&mut self) {
        // Close the port, THEN say so — never the other way round, or a
        // recorded release would stop implying a closed descriptor.
        drop(self.listener.take());
        self.released.store(true, Ordering::SeqCst);
    }
}

impl Accept for ReleaseRecorder {
    async fn accept_one(&self) -> io::Result<(TcpStream, SocketAddr)> {
        self.listener
            .as_ref()
            .expect("only Drop takes the listener")
            .accept()
            .await
    }
}

/// `loopback`, with the listener wrapped so that its release is observable.
async fn loopback_recorded() -> (ReleaseRecorder, u16, Arc<AtomicBool>) {
    let (listener, port) = loopback().await;
    let (recorder, released) = ReleaseRecorder::wrap(listener);
    (recorder, port, released)
}

#[tokio::test]
async fn a_shutdown_signal_ends_the_loop_closes_the_port_and_runs_on_exit_once() {
    let (recorder, port, released) = loopback_recorded().await;
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let exits = Arc::new(AtomicUsize::new(0));
    let exits_seen = Arc::clone(&exits);
    let closed_first = Arc::new(AtomicBool::new(false));
    let observed = Arc::clone(&closed_first);
    let (admitted_tx, mut admitted_rx) = mpsc::unbounded_channel();

    let handle = tokio::spawn(accept_loop(
        recorder,
        shutdown_rx,
        move |_stream, addr| {
            let _ = admitted_tx.send(addr);
        },
        move || {
            // Sampled INSIDE the hook, so what is pinned is the ORDER, not the
            // eventual state — by the time the loop has returned the listener
            // is gone either way, and an assertion made out here could not tell
            // a correct ordering from a reversed one.
            observed.store(released.load(Ordering::SeqCst), Ordering::SeqCst);
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
    // Closed: the listener went with the loop. Observed through the recorder,
    // never by connecting to the port — a connect here is answered by whichever
    // parallel test has since been handed this ephemeral port, and that is what
    // failed this assertion on 2026-09-09 for a property that held.
    assert!(
        closed_first.load(Ordering::SeqCst),
        "the listener must be closed before on_exit is told the loop has exited"
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
    let (recorder, _port, released) = loopback_recorded().await;
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let (exit_tx, exit_rx) = oneshot::channel();

    let handle = tokio::spawn(accept_loop(
        recorder,
        shutdown_rx,
        |_, _| {},
        move || {
            // The hook carries what it saw, so the ORDER is what is pinned —
            // see the sibling above.
            let _ = exit_tx.send(released.load(Ordering::SeqCst));
        },
    ));

    drop(shutdown_tx);
    let closed_first = tokio::time::timeout(Duration::from_secs(5), exit_rx)
        .await
        .expect("on_exit fires")
        .expect("sent");
    handle.await.expect("no panic");
    // Through the recorder, not a connect — see `ReleaseRecorder`.
    assert!(
        closed_first,
        "the listener must go with the loop, before on_exit says it has"
    );
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
    let (recorder, port, released) = loopback_recorded().await;
    let (_shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let (exit_tx, exit_rx) = oneshot::channel();

    let handle = tokio::spawn(accept_loop(
        recorder,
        shutdown_rx,
        |_, _| panic!("admission blew up"),
        move || {
            // Read INSIDE the hook: what has to hold is the ordering, not the
            // eventual state, so the observation has to be taken at the moment
            // the caller is told the loop is gone.
            let _ = exit_tx.send(released.load(Ordering::SeqCst));
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
        "the listener was still open when on_exit was told the loop had gone"
    );
}

#[tokio::test]
async fn dropping_the_loop_future_still_runs_on_exit() {
    // The runtime dropping the task at shutdown is the other non-returning
    // exit: the bridge must not stay marked running behind a listener that
    // has already gone with the future.
    let (recorder, _port, released) = loopback_recorded().await;
    let (_shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    // Two separate claims, kept separate: the hook ran exactly once, and the
    // listener was already closed when it did. Folding them into one counter
    // let either failure be read as the other.
    let exits = Arc::new(AtomicUsize::new(0));
    let runs = Arc::clone(&exits);
    let closed_first = Arc::new(AtomicBool::new(false));
    let observed = Arc::clone(&closed_first);

    let fut = accept_loop(
        recorder,
        shutdown_rx,
        |_, _| {},
        move || {
            observed.store(released.load(Ordering::SeqCst), Ordering::SeqCst);
            runs.fetch_add(1, Ordering::SeqCst);
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

    assert_eq!(exits.load(Ordering::SeqCst), 1, "on_exit ran on the drop");
    assert!(
        closed_first.load(Ordering::SeqCst),
        "on_exit was told the loop had gone while its listener was still open"
    );
}
