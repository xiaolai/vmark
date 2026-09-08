//! Tests for `routed_request.rs` — the stage that reaches a WINDOW.
//!
//! Moved here with their subject when `handle_message` was split (#376): the
//! bridge-internal id minter and the write-lock release are this module's, and
//! a test that lives away from the function it pins is one nobody thinks to
//! update with it.

use super::*;
use crate::mcp_bridge::managed::McpBridgeState;

/// Bridge-internal ids must be unique even when minted concurrently —
/// they key the shared pending map, where a collision would silently drop
/// one client's response channel.
#[test]
fn bridge_request_ids_are_unique_and_prefixed() {
    let mut handles = Vec::new();
    for _ in 0..4 {
        handles.push(std::thread::spawn(|| {
            (0..250)
                .map(|_| next_bridge_request_id())
                .collect::<Vec<_>>()
        }));
    }
    let ids: Vec<String> = handles
        .into_iter()
        .flat_map(|h| h.join().expect("id-minting thread must not panic"))
        .collect();

    assert!(ids.iter().all(|id| id.starts_with("bridge-")));
    let unique: std::collections::HashSet<&String> = ids.iter().collect();
    assert_eq!(unique.len(), ids.len(), "ids must never collide");
}

// -- the write lock is not held across delivery -------------------------------

/// Audit round 1, finding 8: the guard was declared with `let _write_guard`
/// and therefore lived to the end of `handle_message` — across the final
/// `deliver_response(...).await` — even though a comment above that call
/// claimed the lock had already been released. Delivery can force-disconnect
/// a backpressured peer (which takes the bridge state lock), so every other
/// write op queued behind one slow client's teardown.
///
/// `without_write_lock` takes the guard by value and drops it before awaiting,
/// which makes the ordering observable: the delivery future here reads the
/// lock at the moment it runs.
#[tokio::test]
async fn the_write_lock_is_released_before_the_delivery_future_runs() {
    let bridge = McpBridgeState::default();
    let guard = bridge.write_lock().await;

    let free_during_delivery = without_write_lock(Some(guard), async {
        // A second acquisition would block if the guard were still alive.
        tokio::time::timeout(std::time::Duration::from_millis(500), bridge.write_lock())
            .await
            .is_ok()
    })
    .await;

    assert!(
        free_during_delivery,
        "delivery must not run while the write lock is held"
    );
}

/// The read path passes `None` — nothing to release, and delivery still runs.
#[tokio::test]
async fn a_read_request_delivers_without_a_guard() {
    let bridge = McpBridgeState::default();

    let free = without_write_lock(None, async {
        tokio::time::timeout(std::time::Duration::from_millis(500), bridge.write_lock())
            .await
            .is_ok()
    })
    .await;

    assert!(free);
}
