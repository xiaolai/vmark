// WI-20 — request/response lifecycle pins for the MCP bridge's shared state.
//
//! Written against the PRE-`.manage()` implementation and carried across the
//! migration UNCHANGED except for `shared()`, the one seam that names where the
//! state lives. Everything below asserts the CONTRACT — a payload reaches the
//! request that asked for it, a duplicate id is refused, an unknown id is a
//! no-op, stale entries are swept, 32 concurrent requests each get their own
//! answer — none of which is supposed to depend on the state being a process
//! global. If the move had changed any of it, these would have failed.
//!
//! Deliberately free of the marker-key/`__test_…__` discipline the older tests
//! in `state.test.rs` needed: every pin here owns its own `BridgeState`.

use super::super::managed::McpBridgeState;
use super::*;
use std::sync::Arc;

/// A shared handle to the state under test, as the server's tasks see it.
///
/// THE seam — the only thing the `.manage()` migration changed in this file.
/// Pre-migration it was `Arc<Mutex<BridgeState>>`, the shape the `BRIDGE_STATE`
/// static handed out; now it is the managed `McpBridgeState`. `.lock().await`
/// means the same thing either way, so no test body below had to change.
fn shared() -> Arc<McpBridgeState> {
    Arc::new(McpBridgeState::default())
}

fn payload(marker: &str) -> McpResponse {
    McpResponse {
        success: true,
        data: Some(serde_json::json!({ "for": marker })),
        error: None,
    }
}

/// Case 1: a registered request receives EXACTLY the payload sent to its id,
/// and the pending map is empty afterwards (no leak).
#[tokio::test]
async fn a_registered_request_receives_exactly_its_own_payload() {
    let state = shared();
    let (tx, rx) = oneshot::channel::<McpResponse>();

    {
        let mut guard = state.lock().await;
        try_register_pending(&mut guard, "req-1".to_string(), tx).expect("registers below cap");
        assert_eq!(guard.pending.len(), 1, "the request is in flight");
    }

    let resolver = state.clone();
    let resolved = tokio::spawn(async move {
        let mut guard = resolver.lock().await;
        resolve_pending(&mut guard, "req-1", payload("req-1"))
    });

    let response = tokio::time::timeout(std::time::Duration::from_secs(5), rx)
        .await
        .expect("the awaiting side must not hang")
        .expect("the channel must deliver");

    assert!(resolved.await.expect("resolver task").expect("resolves"));
    assert_eq!(response.data, Some(serde_json::json!({ "for": "req-1" })));
    assert!(response.success);
    assert!(
        state.lock().await.pending.is_empty(),
        "a resolved request must leave nothing behind"
    );
}

/// Case 2: a duplicate id is REFUSED, and — the part that matters — the
/// original request is still resolvable with its own payload. Silently
/// replacing the entry would strand the first client forever.
#[tokio::test]
async fn a_duplicate_id_is_rejected_and_the_original_still_resolves() {
    let state = shared();
    let (first_tx, first_rx) = oneshot::channel::<McpResponse>();
    let (second_tx, second_rx) = oneshot::channel::<McpResponse>();

    let mut guard = state.lock().await;
    try_register_pending(&mut guard, "dup".to_string(), first_tx).expect("first registration");
    let err = try_register_pending(&mut guard, "dup".to_string(), second_tx)
        .expect_err("the second registration must be refused");
    assert_eq!(
        err,
        "MCP bridge internal error: duplicate pending request id dup"
    );
    assert_eq!(guard.pending.len(), 1, "the original entry is untouched");

    assert!(resolve_pending(&mut guard, "dup", payload("first")).expect("resolves"));
    drop(guard);

    assert_eq!(
        first_rx.await.expect("original resolves").data,
        Some(serde_json::json!({ "for": "first" })),
        "the ORIGINAL channel receives the response, not the rejected one"
    );
    assert!(
        second_rx.await.is_err(),
        "the refused registration never became a pending request"
    );
}

/// Case 3: resolving an id that was never registered is a defined no-op —
/// `Ok(false)`, no panic, no state change. A response can legitimately arrive
/// after its request timed out.
#[tokio::test]
async fn resolving_an_unknown_id_is_a_defined_no_op() {
    let state = shared();
    let (tx, _rx) = oneshot::channel::<McpResponse>();
    let mut guard = state.lock().await;
    try_register_pending(&mut guard, "live".to_string(), tx).expect("registers");

    let hit = resolve_pending(&mut guard, "never-registered", payload("stray"))
        .expect("an unknown id is not an error");

    assert!(!hit, "nothing was answered");
    assert_eq!(guard.pending.len(), 1, "state unchanged");
    assert!(guard.pending.contains_key("live"));
}

/// The one resolution failure that IS an error: the requester went away, so
/// the response has nowhere to land. The entry is still removed.
#[tokio::test]
async fn resolving_a_request_whose_requester_left_reports_a_closed_channel() {
    let state = shared();
    let (tx, rx) = oneshot::channel::<McpResponse>();
    let mut guard = state.lock().await;
    try_register_pending(&mut guard, "abandoned".to_string(), tx).expect("registers");
    drop(rx);

    let err = resolve_pending(&mut guard, "abandoned", payload("nobody"))
        .expect_err("a dead receiver must be reported");

    assert_eq!(err, "Response channel closed");
    assert!(
        guard.pending.is_empty(),
        "the entry is dropped either way — no leak on the failure path"
    );
}

/// Case 4: entries older than the TTL are swept when the next request
/// registers, so a webview that never answers cannot grow the map without
/// bound.
#[tokio::test]
async fn stale_requests_are_swept_and_leave_no_leak() {
    let state = shared();
    let mut guard = state.lock().await;
    let mut abandoned = Vec::new();
    for i in 0..8 {
        let (tx, rx) = oneshot::channel::<McpResponse>();
        abandoned.push(rx);
        guard.pending.insert(
            format!("stale-{i}"),
            PendingRequest {
                response_tx: tx,
                created_at: Instant::now() - std::time::Duration::from_secs(PENDING_TTL_SECS + 1),
            },
        );
    }

    let (tx, _rx) = oneshot::channel::<McpResponse>();
    try_register_pending(&mut guard, "fresh".to_string(), tx).expect("registers");

    assert_eq!(
        guard.pending.len(),
        1,
        "every stale entry is gone; only the fresh one remains"
    );
    assert!(guard.pending.contains_key("fresh"));
}

/// Case 6: 32 concurrent register+resolve round-trips. The hard timeout is the
/// deadlock assertion; the per-id payload match is the correctness one — a
/// crossed channel would deliver another request's answer.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn thirty_two_concurrent_requests_each_receive_their_own_payload() {
    let state = shared();
    let mut waiters = Vec::new();

    for i in 0..32u32 {
        let id = format!("concurrent-{i}");
        let register_state = state.clone();
        let resolve_state = state.clone();
        let resolve_id = id.clone();
        waiters.push(tokio::spawn(async move {
            let (tx, rx) = oneshot::channel::<McpResponse>();
            {
                let mut guard = register_state.lock().await;
                try_register_pending(&mut guard, id.clone(), tx).expect("registers");
            }
            let resolver = tokio::spawn(async move {
                let mut guard = resolve_state.lock().await;
                resolve_pending(&mut guard, &resolve_id, payload(&resolve_id)).expect("resolves")
            });
            let response = rx.await.expect("delivered");
            assert!(resolver.await.expect("resolver task"));
            (i, response)
        }));
    }

    let settled = tokio::time::timeout(std::time::Duration::from_secs(20), async {
        let mut out = Vec::new();
        for waiter in waiters {
            out.push(waiter.await.expect("no task may panic"));
        }
        out
    })
    .await
    .expect("32 parallel round-trips must not deadlock");

    assert_eq!(settled.len(), 32);
    for (i, response) in settled {
        assert_eq!(
            response.data,
            Some(serde_json::json!({ "for": format!("concurrent-{i}") })),
            "request {i} received another request's payload"
        );
    }
    assert!(
        state.lock().await.pending.is_empty(),
        "no pending entry survives 32 completed round-trips"
    );
}

/// Case 8: a task that panics while holding the state lock must not wedge the
/// next acquirer. (Behavioural replacement for hand-rolled poison recovery:
/// a tokio mutex simply releases on unwind.)
#[tokio::test]
async fn a_panicking_holder_does_not_wedge_the_next_acquirer() {
    let state = shared();
    let panicking = state.clone();

    let outcome = tokio::spawn(async move {
        let mut guard = panicking.lock().await;
        guard.next_client_id += 1;
        panic!("simulated panic while holding the bridge state");
    })
    .await;
    assert!(outcome.is_err(), "the task really did panic");

    let acquired = tokio::time::timeout(std::time::Duration::from_secs(5), state.lock())
        .await
        .expect("the lock must still be acquirable after a panicking holder");
    assert_eq!(
        acquired.next_client_id, 2,
        "the mutation made before the panic is visible; the lock is usable"
    );
}
