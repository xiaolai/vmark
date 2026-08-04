// WI-20 / audit 20260803 §5 — the connection-admission generation.
//
//! The stale-generation registration path is the bridge's only defence against
//! an authenticated stray outliving the bridge it authenticated to, and it had
//! no test at all: `try_register_client` was exercised only end-to-end through
//! `serve_authenticated`, where the generation argument is whatever
//! `admit_connection` captured and never anything else.
//!
//! Every case below builds its own `McpBridgeState`, so the generation counter
//! starts at a known value and nothing is shared between tests.

use super::*;
use crate::mcp_bridge::state::CLIENT_TX_CAPACITY;
use std::sync::Arc;

/// A client record like the one `serve_authenticated` builds. The channels are
/// held by the caller so the record stays live for the assertion.
fn client() -> (
    ClientConnection,
    tokio::sync::mpsc::Receiver<String>,
    oneshot::Receiver<()>,
) {
    let (tx, rx) = tokio::sync::mpsc::channel::<String>(CLIENT_TX_CAPACITY);
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    (
        ClientConnection {
            tx,
            shutdown: Some(shutdown_tx),
            identity: None,
            principal: BridgePrincipal::Anonymous,
        },
        rx,
        shutdown_rx,
    )
}

/// What `stop_bridge` does, minus the socket and port-file work: bump the
/// generation and drain, both under the tables lock.
async fn stop(state: &McpBridgeState) {
    let mut guard = state.lock().await;
    state.bump_connection_generation();
    for (_, mut client) in guard.clients.drain() {
        if let Some(shutdown) = client.shutdown.take() {
            let _ = shutdown.send(());
        }
    }
}

#[tokio::test]
async fn a_registration_that_lands_before_the_stop_is_drained_by_it() {
    // The FIRST of the two orderings the generation exists to make total: the
    // peer wins the race, registers, and is then torn down like any other
    // connected client. It must not be left behind holding a live `tx`.
    let state = McpBridgeState::default();
    let admitted = state.connection_generation();
    let (connection, _rx, shutdown_rx) = client();

    assert!(
        state.try_register_client(7, connection, admitted).await,
        "the generation has not moved, so registration must succeed"
    );
    assert!(state.lock().await.clients.contains_key(&7));

    stop(&state).await;

    assert!(
        state.lock().await.clients.is_empty(),
        "the drain must reach a client that registered before the bump"
    );
    assert!(
        shutdown_rx.await.is_ok(),
        "the drained client must be told to shut down, not silently dropped"
    );
}

#[tokio::test]
async fn a_registration_after_the_generation_moved_is_refused() {
    // The SECOND ordering: the peer was still mid-handshake when the bridge
    // stopped. Its generation is stale, so it never enters the table — and the
    // caller closes its socket on the `false`.
    let state = McpBridgeState::default();
    let admitted = state.connection_generation();

    stop(&state).await;

    let (connection, _rx, _shutdown_rx) = client();
    assert!(
        !state.try_register_client(7, connection, admitted).await,
        "a peer admitted under the previous generation must be refused"
    );
    assert!(
        state.lock().await.clients.is_empty(),
        "a refused registration must leave NOTHING behind — a record here \
         would survive shutdown and keep answering"
    );
}

#[tokio::test]
async fn a_peer_admitted_after_the_restart_registers_normally() {
    // The refusal must be about the OLD bridge, not about having stopped once.
    // A boolean "accepting" flag could not tell these two peers apart.
    let state = McpBridgeState::default();
    let stale = state.connection_generation();
    stop(&state).await;

    let fresh = state.connection_generation();
    assert_ne!(stale, fresh, "stopping must move the generation");

    let (connection, _rx, _shutdown_rx) = client();
    assert!(state.try_register_client(9, connection, fresh).await);
    assert!(state.lock().await.clients.contains_key(&9));

    // …and the stale peer is still refused, now against the restarted bridge.
    let (connection, _rx, _shutdown_rx) = client();
    assert!(!state.try_register_client(8, connection, stale).await);
    assert_eq!(state.lock().await.clients.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn an_in_flight_handshake_that_loses_the_lock_to_the_stop_is_refused() {
    // The interleaving the doc comment claims is impossible to lose. The peer
    // finished authenticating BEFORE the stop and is about to register; the
    // stop takes the tables lock first. Holding the lock in the test freezes
    // the registration at exactly that point.
    //
    // This is the case a check outside the lock would get wrong: the peer's
    // generation is still current when it decides to register, and stale by
    // the time it writes.
    let state = Arc::new(McpBridgeState::default());
    let admitted = state.connection_generation();

    let held = state.lock().await;

    let registering = tokio::spawn({
        let state = Arc::clone(&state);
        async move {
            let (connection, rx, shutdown_rx) = client();
            let ok = state.try_register_client(7, connection, admitted).await;
            // Keep the peer's channels alive until the answer is known.
            drop((rx, shutdown_rx));
            ok
        }
    });
    // Paused-clock determinism (audit 20260803 round 2 — the round-1 version
    // slept 50 ms of real time and hoped): under `start_paused`, awaiting this
    // sleep cannot complete while any other task is runnable — virtual time
    // only auto-advances once every task is parked. When it returns, the
    // registration task is GUARANTEED to be blocked on the tables lock this
    // test holds.
    tokio::time::sleep(std::time::Duration::from_millis(1)).await;

    // The stop happens while the registration is parked. It cannot take the
    // lock either, so bump directly — this IS what `stop_bridge` does under
    // the very lock this test is holding.
    state.bump_connection_generation();
    drop(held);

    assert!(
        !registering.await.expect("the task must not panic"),
        "an authenticated peer that registers after the bump must be refused"
    );
    assert!(state.lock().await.clients.is_empty());
}

#[tokio::test]
async fn a_refused_registration_leaves_the_generation_and_other_clients_alone() {
    // A refusal is not a mutation: the surviving peers of the current bridge
    // must be untouched, and the counter must not drift.
    let state = McpBridgeState::default();
    let stale = state.connection_generation();
    stop(&state).await;
    let current = state.connection_generation();

    let (keeper, _keeper_rx, _keeper_shutdown) = client();
    assert!(state.try_register_client(1, keeper, current).await);

    let (rejected, _rx, _shutdown) = client();
    assert!(!state.try_register_client(2, rejected, stale).await);

    assert_eq!(state.connection_generation(), current, "counter drifted");
    let guard = state.lock().await;
    assert_eq!(guard.clients.len(), 1);
    assert!(guard.clients.contains_key(&1));
}

#[tokio::test]
async fn an_unknown_client_id_authorizes_nothing() {
    // `connection_principal` is the ONLY input to a bridge authorization
    // decision, and a refused (or drained) peer has no record — so it must
    // resolve to Anonymous rather than to whatever id it claims.
    let state = McpBridgeState::default();
    assert_eq!(
        state.connection_principal(404).await,
        BridgePrincipal::Anonymous
    );
}
