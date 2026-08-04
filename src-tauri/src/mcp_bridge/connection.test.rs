//! WI-9 — the connection lifecycle over a real loopback socket.
//!
//! `handshake.test.rs` pins the policy functions in isolation; these drive
//! the whole path a peer actually takes — TCP accept, admission, origin-checked
//! upgrade, size-capped frames, auth, allocation — and prove the controls hold
//! when they are wired together (audit 20260728 §2.2, round-1 findings 4–6).
//!
//! Gated off Windows to match the rest of the bridge suite: `MockRuntime`
//! crashes there.
#![cfg(not(target_os = "windows"))]

use super::super::handshake::{MAX_FRAME_BYTES, MAX_PREAUTH_MESSAGE_BYTES};
use super::*;

/// Serializes tests that drive real sockets through `admit_connection`.
///
/// The connection gauge in `handshake.rs` is process-global: a test that
/// saturates it would make every other connection test observe a spurious
/// "at capacity" refusal.
///
/// Lives here rather than in `connection.rs`: it is only ever called from this
/// file, and a `#[cfg(test)]` helper in production source is production source
/// as far as the file-size gate — and a reader — is concerned.
fn connection_test_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(Default::default)
}
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{header::ORIGIN, HeaderValue};
use tokio_tungstenite::tungstenite::Error as WsError;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

const TOKEN: &str = "0123456789abcdef0123456789abcdef";

type ClientSocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(super::super::managed::McpBridgeState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

/// A bridge listener backed by a mock Tauri app, on an OS-assigned port.
///
/// Its accept loop is the PRODUCTION one: it calls `admit_connection`, so the
/// admission decision under test is the shipping code path rather than a
/// test-only imitation of it. The counters record what that decision did.
struct Server {
    app: tauri::App<tauri::test::MockRuntime>,
    port: u16,
    admitted: Arc<AtomicUsize>,
    refused: Arc<AtomicUsize>,
    peak_live: Arc<AtomicUsize>,
}

async fn serve() -> Server {
    let app = mock_app();
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("local addr").port();
    let handle = app.handle().clone();
    let admitted = Arc::new(AtomicUsize::new(0));
    let refused = Arc::new(AtomicUsize::new(0));
    let peak_live = Arc::new(AtomicUsize::new(0));
    let (a, r, p) = (admitted.clone(), refused.clone(), peak_live.clone());
    tokio::spawn(async move {
        while let Ok((stream, addr)) = listener.accept().await {
            if admit_connection(stream, addr, &handle, TOKEN) {
                a.fetch_add(1, Ordering::Relaxed);
                p.fetch_max(ConnectionSlot::live(), Ordering::Relaxed);
            } else {
                r.fetch_add(1, Ordering::Relaxed);
            }
        }
    });
    Server {
        app,
        port,
        admitted,
        refused,
        peak_live,
    }
}

async fn dial(port: u16, origin: Option<&str>) -> Result<ClientSocket, WsError> {
    let mut request = format!("ws://127.0.0.1:{port}/")
        .into_client_request()
        .expect("client request");
    if let Some(origin) = origin {
        request
            .headers_mut()
            .insert(ORIGIN, HeaderValue::from_str(origin).expect("origin"));
    }
    connect_async(request).await.map(|(socket, _)| socket)
}

/// Next JSON text frame, or `None` if the socket closed/errored/stalled.
async fn next_json(socket: &mut ClientSocket) -> Option<serde_json::Value> {
    loop {
        let frame = tokio::time::timeout(Duration::from_secs(5), socket.next())
            .await
            .ok()?;
        match frame {
            Some(Ok(Message::Text(text))) => return serde_json::from_str(&text).ok(),
            Some(Ok(_)) => continue,
            _ => return None,
        }
    }
}

async fn send_auth(socket: &mut ClientSocket, token: &str) {
    let frame = serde_json::json!({ "id": "auth", "type": "auth", "payload": { "token": token } });
    socket
        .send(Message::Text(frame.to_string().into()))
        .await
        .expect("send auth");
}

/// Whether `app`'s bridge holds a record for `client_id`.
async fn is_registered(app: &tauri::AppHandle<tauri::test::MockRuntime>, client_id: u64) -> bool {
    bridge(app).lock().await.clients.contains_key(&client_id)
}

/// Poll a synchronous predicate for up to 3s. Used where the observable
/// effect is produced by a detached task (writer abort) and is not synchronous.
async fn eventually_true(mut check: impl FnMut() -> bool) -> bool {
    for _ in 0..300 {
        if check() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    false
}

/// Same, for the registration check, which needs the async state lock.
async fn eventually_registered(
    app: &tauri::AppHandle<tauri::test::MockRuntime>,
    client_id: u64,
) -> bool {
    for _ in 0..300 {
        if is_registered(app, client_id).await {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    false
}

/// Wait for the process-global connection gauge to drain so the cap tests can
/// saturate it deterministically. Tests hold `connection_test_lock`, so the
/// only holders are connection tasks from an earlier test still winding down.
async fn await_idle_gauge() {
    for _ in 0..300 {
        if ConnectionSlot::live() == 0 {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!(
        "connection gauge never drained ({} slots still held)",
        ConnectionSlot::live()
    );
}

/// Read the welcome frame and return the client id the bridge minted.
async fn welcome_client_id(socket: &mut ClientSocket) -> u64 {
    let welcome = next_json(socket).await.expect("welcome frame");
    assert_eq!(welcome["type"], "status");
    assert_eq!(welcome["payload"]["authRequired"], serde_json::json!(true));
    welcome["payload"]["clientId"]
        .as_u64()
        .expect("welcome carries a client id")
}

// --- 1. Origin allowlist ---------------------------------------------------

/// The sidecar is a Node process: it sends no `Origin`. This is the case that
/// breaks the product if the check is inverted, so it is asserted end to end.
#[tokio::test]
async fn a_client_without_an_origin_header_connects() {
    let _lock = connection_test_lock().lock().await;
    await_idle_gauge().await;
    let server = serve().await;

    let mut socket = dial(server.port, None)
        .await
        .expect("an absent Origin means a non-browser client and must be allowed");

    assert!(welcome_client_id(&mut socket).await >= 1);
}

#[tokio::test]
async fn a_browser_origin_is_refused_with_403() {
    let _lock = connection_test_lock().lock().await;
    await_idle_gauge().await;
    let server = serve().await;

    let error = dial(server.port, Some("https://attacker.test"))
        .await
        .expect_err("a page origin must not be able to open the bridge");

    match error {
        WsError::Http(response) => assert_eq!(response.status(), 403),
        other => panic!("expected an HTTP 403 rejection, got {other:?}"),
    }
}

// --- 3. Message-size caps --------------------------------------------------

/// An oversized frame must kill the socket instead of being buffered — and it
/// must do so BEFORE auth, which is exactly where the unauthenticated DoS
/// surface was.
#[tokio::test]
async fn an_oversized_frame_terminates_the_connection() {
    let _lock = connection_test_lock().lock().await;
    await_idle_gauge().await;
    let server = serve().await;
    let mut socket = dial(server.port, None).await.expect("connect");
    welcome_client_id(&mut socket).await;

    let oversized = "x".repeat(MAX_FRAME_BYTES + 1024);
    let _ = socket.send(Message::Text(oversized.into())).await;

    let terminated = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(text))) => {
                    panic!("server answered an oversized frame instead of dropping it: {text}")
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return,
                Some(Ok(_)) => continue,
            }
        }
    })
    .await;
    assert!(
        terminated.is_ok(),
        "server must not keep an over-cap peer alive"
    );
}

/// Under the transport cap but over the PRE-AUTH cap (audit round 1, finding
/// 5): the transport happily buffers it, so the application layer is what has
/// to refuse it — and it must refuse even though the frame carries the real
/// token, proving the size is checked before the payload is trusted.
#[tokio::test]
async fn an_over_cap_preauth_frame_is_refused_even_with_the_real_token() {
    let _lock = connection_test_lock().lock().await;
    await_idle_gauge().await;
    let server = serve().await;
    let mut socket = dial(server.port, None).await.expect("connect");
    let client_id = welcome_client_id(&mut socket).await;

    let bloated = serde_json::json!({
        "id": "auth",
        "type": "auth",
        "payload": { "token": TOKEN, "pad": "x".repeat(MAX_PREAUTH_MESSAGE_BYTES) },
    })
    .to_string();
    assert!(
        bloated.len() < MAX_FRAME_BYTES,
        "must clear the transport cap"
    );
    socket
        .send(Message::Text(bloated.into()))
        .await
        .expect("send over-cap auth frame");

    let reply = next_json(&mut socket).await.expect("auth_result");
    assert_eq!(reply["payload"]["success"], serde_json::json!(false));
    assert!(
        !is_registered(server.app.handle(), client_id).await,
        "an over-cap pre-auth frame must not authenticate anyone"
    );
}

/// The complement: a frame within the pre-auth cap is delivered and answered
/// at the protocol layer. Without this, "everything dies" would pass the two
/// tests above.
#[tokio::test]
async fn a_frame_within_the_preauth_cap_still_reaches_the_auth_state_machine() {
    let _lock = connection_test_lock().lock().await;
    await_idle_gauge().await;
    let server = serve().await;
    let mut socket = dial(server.port, None).await.expect("connect");
    welcome_client_id(&mut socket).await;

    // Non-JSON, comfortably under the cap: the transport delivers it and the
    // auth state machine — not tungstenite — is what rejects it.
    let legal = "x".repeat(MAX_PREAUTH_MESSAGE_BYTES / 2);
    socket
        .send(Message::Text(legal.into()))
        .await
        .expect("send under-cap frame");

    let reply = next_json(&mut socket).await.expect("auth_result");
    assert_eq!(reply["type"], "auth_result");
    assert_eq!(reply["payload"]["success"], serde_json::json!(false));
}

// --- 4. No pre-auth allocation ---------------------------------------------

/// The core WI-9 property: an unauthenticated peer costs the process no
/// `clients` entry and no 1024-slot outbound queue — before it authenticates
/// and after it fails.
#[tokio::test]
async fn a_rejected_peer_never_gets_a_client_record() {
    let _lock = connection_test_lock().lock().await;
    await_idle_gauge().await;
    let server = serve().await;
    let mut socket = dial(server.port, None).await.expect("connect");
    let client_id = welcome_client_id(&mut socket).await;

    assert!(
        !is_registered(server.app.handle(), client_id).await,
        "the welcome frame must not imply an allocated client"
    );

    send_auth(&mut socket, "not-the-token").await;
    let reply = next_json(&mut socket).await.expect("auth_result");
    assert_eq!(reply["payload"]["success"], serde_json::json!(false));

    assert!(
        !is_registered(server.app.handle(), client_id).await,
        "a failed auth must leave nothing behind"
    );
}

/// And the positive case, so the deferral did not simply break registration.
#[tokio::test]
async fn an_authenticated_peer_is_registered() {
    let _lock = connection_test_lock().lock().await;
    await_idle_gauge().await;
    let server = serve().await;
    let mut socket = dial(server.port, None).await.expect("connect");
    let client_id = welcome_client_id(&mut socket).await;

    send_auth(&mut socket, TOKEN).await;
    let reply = next_json(&mut socket).await.expect("auth_result");
    assert_eq!(reply["payload"]["success"], serde_json::json!(true));

    assert!(
        eventually_registered(server.app.handle(), client_id).await,
        "a valid token must produce a client record"
    );
}

// --- 3b. Concurrent-connection cap -----------------------------------------

#[tokio::test]
async fn connections_beyond_the_cap_are_refused_and_capacity_is_reclaimed() {
    let _lock = connection_test_lock().lock().await;
    await_idle_gauge().await;
    let server = serve().await;

    let mut held = Vec::new();
    while let Some(slot) = ConnectionSlot::try_acquire() {
        held.push(slot);
    }
    assert_eq!(held.len(), MAX_CONCURRENT_CONNECTIONS);
    assert_eq!(ConnectionSlot::live(), MAX_CONCURRENT_CONNECTIONS);

    assert!(
        dial(server.port, None).await.is_err(),
        "a connection past the cap must be dropped before the upgrade"
    );

    // The RAII guard must give the capacity back, or one burst would wedge
    // the bridge until restart.
    drop(held);
    assert_eq!(ConnectionSlot::live(), 0);
    let mut socket = dial(server.port, None)
        .await
        .expect("capacity is reclaimed when connections end");
    welcome_client_id(&mut socket).await;
}

/// Audit round 1, finding 4: the cap has to bound what the ACCEPT LOOP
/// allocates, not just what a running connection task discovers about itself.
///
/// The previous shape acquired the slot inside an already-spawned task, so a
/// flood produced one task, one cloned `AppHandle` and one cloned token per
/// socket regardless of the cap — an unbounded pre-auth backlog. This floods
/// the listener with more concurrent peers than the cap and asserts the
/// refusal happened in the loop: `admit_connection` returned false for the
/// excess, so nothing was spawned or cloned for them.
#[tokio::test]
async fn a_concurrent_flood_is_capped_before_anything_is_spawned() {
    let _lock = connection_test_lock().lock().await;
    await_idle_gauge().await;
    let server = serve().await;

    let over = MAX_CONCURRENT_CONNECTIONS + 8;
    let mut dials = Vec::with_capacity(over);
    for _ in 0..over {
        let port = server.port;
        dials.push(tokio::spawn(async move { dial(port, None).await }));
    }

    let mut held = Vec::new();
    let mut client_refusals = 0usize;
    for task in dials {
        match task.await.expect("dial task must not panic") {
            Ok(socket) => held.push(socket),
            Err(_) => client_refusals += 1,
        }
    }

    assert_eq!(
        server.admitted.load(Ordering::Relaxed),
        MAX_CONCURRENT_CONNECTIONS,
        "the accept loop must not spawn a connection it has no slot for"
    );
    assert_eq!(
        server.refused.load(Ordering::Relaxed),
        over - MAX_CONCURRENT_CONNECTIONS,
        "every excess peer must be refused in the loop"
    );
    assert!(
        server.peak_live.load(Ordering::Relaxed) <= MAX_CONCURRENT_CONNECTIONS,
        "the live gauge must never exceed the cap under contention"
    );
    assert_eq!(held.len(), MAX_CONCURRENT_CONNECTIONS);
    assert_eq!(client_refusals, over - MAX_CONCURRENT_CONNECTIONS);

    drop(held);
    await_idle_gauge().await;
}

#[tokio::test]
async fn a_connection_slot_is_released_even_when_the_task_unwinds() {
    let _lock = connection_test_lock().lock().await;
    await_idle_gauge().await;

    let outcome = std::panic::catch_unwind(|| {
        let _slot = ConnectionSlot::try_acquire().expect("slot");
        assert_eq!(ConnectionSlot::live(), 1);
        panic!("simulated connection-task panic");
    });

    assert!(outcome.is_err());
    assert_eq!(
        ConnectionSlot::live(),
        0,
        "Drop must run on unwind — a panicking connection must not leak capacity"
    );
}

// --- 5. Teardown after registration (audit round 1, finding 6) --------------

/// Register a fake authenticated client and return its writer task plus a
/// probe sender. `probe.is_closed()` becomes true only once the writer task
/// has actually been dropped, which is how an abort is observed.
async fn register_with_writer(
    app: &tauri::AppHandle<tauri::test::MockRuntime>,
    client_id: u64,
) -> (tauri::async_runtime::JoinHandle<()>, mpsc::Sender<String>) {
    let (tx, mut rx) = mpsc::channel::<String>(4);
    let probe = tx.clone();
    let writer = tauri::async_runtime::spawn(async move { while rx.recv().await.is_some() {} });
    bridge(app).lock().await.clients.insert(
        client_id,
        ClientConnection {
            tx,
            shutdown: None,
            identity: None,
            principal: BridgePrincipal::Anonymous,
        },
    );
    (writer, probe)
}

/// `spawn_logged` swallows a panic at the task boundary, so before this fix a
/// panic in message handling skipped the whole cleanup block: the `clients`
/// entry survived with a live sender, and the detached writer task stayed
/// parked on `rx.recv()` for the rest of the process's life.
#[tokio::test]
async fn a_panic_after_registration_still_unregisters_and_stops_the_writer() {
    let _lock = connection_test_lock().lock().await;
    let app = mock_app();
    let client_id = 990_001;
    let (writer, probe) = register_with_writer(app.handle(), client_id).await;
    assert!(
        is_registered(app.handle(), client_id).await,
        "precondition: registered"
    );

    unregister_after(client_id, app.handle(), writer, async {
        panic!("simulated panic inside handle_message");
    })
    .await;

    assert!(
        !is_registered(app.handle(), client_id).await,
        "a panic must not leak the client record"
    );
    let closed = eventually_true(|| probe.is_closed()).await;
    assert!(
        closed,
        "the detached writer task must be aborted, not left parked on recv()"
    );
}

/// The same path on a clean exit — so the panic handling above did not buy
/// safety by breaking ordinary disconnect cleanup.
#[tokio::test]
async fn a_clean_exit_unregisters_and_stops_the_writer_too() {
    let _lock = connection_test_lock().lock().await;
    let app = mock_app();
    let client_id = 990_002;
    let (writer, probe) = register_with_writer(app.handle(), client_id).await;

    unregister_after(client_id, app.handle(), writer, async {}).await;

    assert!(!is_registered(app.handle(), client_id).await);
    assert!(eventually_true(|| probe.is_closed()).await);
}
