//! Tests for `state.rs` (moved from the inline `#[cfg(test)]` module;
//! included via `#[path]`).

use super::super::managed::McpBridgeState;
use super::*;

// -- bounded outbound channel -------------------------------------------
//
// The per-client outbound channel must not be unbounded. A misbehaving
// sidecar that stops draining its socket would otherwise grow the queue
// until the process is OOM-killed.

#[tokio::test]
async fn client_tx_overflow_returns_full_not_blocking() {
    // A stalled receiver must not block senders past the configured cap.
    let (tx, _rx) = mpsc::channel::<String>(CLIENT_TX_CAPACITY);
    for i in 0..CLIENT_TX_CAPACITY {
        tx.try_send(format!("msg-{i}"))
            .expect("messages within capacity must enqueue");
    }
    // Next send must return Full, not block.
    match tx.try_send("overflow".to_string()) {
        Err(mpsc::error::TrySendError::Full(_)) => {}
        other => panic!("expected Full at capacity, got {:?}", other.err()),
    }
}

// -- is_read_only_operation ------------------------------------------------

#[test]
fn legacy_operations_are_write_class_fail_closed() {
    // Audit 20260729 C4: the pre-pruning legacy names are unreachable here —
    // the frontend dispatcher accepts only vmark.*, and windows.list /
    // windows.getFocused are Rust-answered in routing BEFORE this classifier
    // runs. They must fall through to write-class (fail closed), not carry a
    // dead read-only allowlist.
    for legacy in [
        "document.getContent",
        "document.search",
        "selection.get",
        "cursor.getContext",
        "outline.get",
        "metadata.get",
        "windows.list",
        "windows.getFocused",
        "workspace.getDocumentInfo",
        "tabs.list",
        "editor.getUndoState",
        "suggestion.list",
        "paragraph.read",
        "protocol.getCapabilities",
        "structure.getAst",
        "genies.list",
    ] {
        assert!(
            !is_read_only_operation(legacy),
            "legacy op {legacy} must be write-class (fail closed)"
        );
    }
}

#[test]
fn read_only_vmark_pruned_surface_operations() {
    // Regression for #925 — pruned 5-tool surface uses vmark.* prefix.
    // Read types must be allowlisted so concurrent AI clients don't
    // queue behind WRITE_LOCK on every pure-read call.
    assert!(is_read_only_operation("vmark.session.get_state"));
    assert!(is_read_only_operation("vmark.document.read"));
    assert!(is_read_only_operation("vmark.selection.get"));
    assert!(is_read_only_operation("vmark.workflow.validate"));
}

#[test]
fn read_only_browser_operations() {
    // Codex audit 20260718 — browser read-class ops mutate nothing and must
    // not serialize behind WRITE_LOCK. The bounded waits are the worst case:
    // classified as writes they would hold the global write lock for up to
    // their full 12s timeout, stalling every concurrent writer.
    assert!(is_read_only_operation("vmark.browser.read"));
    assert!(is_read_only_operation("vmark.browser.wait_for"));
    assert!(is_read_only_operation("vmark.browser.query"));
    assert!(is_read_only_operation("vmark.browser.screenshot"));
    // `vmark.browser.wait` was write-class (audit 20260729) while its frontend
    // handler activated the target window and created the native view. Since
    // the 2026-09-03 audit (L-03) it only observes a navigation ticket, so it is
    // read-class like its siblings — and the manifest parity test on the TS side
    // (operationManifestParity.test.ts) pins the two lists against each other.
    assert!(is_read_only_operation("vmark.browser.wait"));
    // Write-class browser ops stay serialized.
    assert!(!is_read_only_operation("vmark.browser.act"));
    assert!(!is_read_only_operation("vmark.browser.close"));
}

#[test]
fn duplicate_pending_request_id_is_rejected() {
    let mut state = BridgeState::default();
    let (tx1, _rx1) = tokio::sync::oneshot::channel();
    let (tx2, _rx2) = tokio::sync::oneshot::channel();

    assert!(try_register_pending(&mut state, "req-1".into(), tx1).is_ok());
    // Same id again: must be rejected, NOT silently replace (and strand)
    // the original request's response channel.
    let err = try_register_pending(&mut state, "req-1".into(), tx2).unwrap_err();
    assert!(err.contains("duplicate pending request id"));
    assert_eq!(state.pending.len(), 1);
}

#[test]
fn coherence_operations_never_reach_this_classifier() {
    // WI-1 (audit-followups 20260729): coherence ops are Rust-answered in
    // `answer_rust_side` BEFORE the lock decision consults this classifier;
    // their lock policy lives in `routing::answer_coherence_async`. Entries
    // here would be unreachable — they must all fall through (fail closed).
    assert!(!is_read_only_operation("vmark.coherence.status"));
    assert!(!is_read_only_operation("vmark.coherence.claims"));
    assert!(!is_read_only_operation("vmark.coherence.contexts"));
    assert!(!is_read_only_operation("vmark.coherence.edges"));
    assert!(!is_read_only_operation("vmark.coherence.resolve"));
}

#[test]
fn write_operations_not_read_only() {
    assert!(!is_read_only_operation("document.insertAtCursor"));
    assert!(!is_read_only_operation("document.insertAtPosition"));
    assert!(!is_read_only_operation("document.replaceInSource"));
    assert!(!is_read_only_operation("document.setContent"));
    assert!(!is_read_only_operation("selection.replace"));
    assert!(!is_read_only_operation("editor.undo"));
    assert!(!is_read_only_operation("editor.redo"));
    assert!(!is_read_only_operation("tabs.create"));
    assert!(!is_read_only_operation("tabs.close"));
    assert!(!is_read_only_operation("tabs.switch"));
}

/// Exhaustive coverage of all known write operations from the frontend MCP
/// bridge. This ensures no write operation is accidentally classified as
/// read-only in a future refactor.
#[test]
fn exhaustive_write_operations_not_read_only() {
    let write_ops = [
        // Document mutations
        "document.insert",
        "document.insertAtCursor",
        "document.insertAtPosition",
        "document.replaceInSource",
        "document.setContent",
        // Selection/cursor mutations
        "selection.replace",
        "selection.set",
        "cursor.setPosition",
        // Editor commands
        "editor.undo",
        "editor.redo",
        "editor.focus",
        "editor.setMode",
        // Format operations
        "format.clear",
        "format.removeLink",
        "format.setLink",
        "format.toggle",
        // List operations
        "list.batchModify",
        "list.decreaseIndent",
        "list.increaseIndent",
        "list.toggle",
        // Block operations
        "block.insertHorizontalRule",
        "block.setType",
        // Table operations
        "table.addColumnAfter",
        "table.addColumnBefore",
        "table.addRowAfter",
        "table.addRowBefore",
        "table.batchModify",
        "table.delete",
        "table.deleteColumn",
        "table.deleteRow",
        "table.insert",
        "table.toggleHeaderRow",
        // Mutation/batch operations
        "mutation.applyDiff",
        "mutation.batchEdit",
        "mutation.replaceAnchored",
        // Section operations
        "section.insert",
        "section.move",
        "section.update",
        // Paragraph write
        "paragraph.write",
        // Suggestion mutations
        "suggestion.accept",
        "suggestion.acceptAll",
        "suggestion.reject",
        "suggestion.rejectAll",
        // Tab mutations
        "tabs.create",
        "tabs.close",
        "tabs.switch",
        "tabs.reopenClosed",
        // Window mutations
        "windows.focus",
        // Workspace mutations
        "workspace.closeWindow",
        "workspace.newDocument",
        "workspace.openDocument",
        "workspace.reloadDocument",
        "workspace.saveDocument",
        "workspace.saveDocumentAs",
        // Genie invocation (side-effecting)
        "genies.invoke",
        // Smart/media insert
        "smartInsert",
        "insertMedia",
        // VMark-specific commands
        "vmark.cjkFormat",
        "vmark.cjkPunctuationConvert",
        "vmark.cjkSpacingFix",
        "vmark.insertMarkmap",
        "vmark.insertMathBlock",
        "vmark.insertMathInline",
        "vmark.insertMermaid",
        "vmark.insertSvg",
        "vmark.insertWikiLink",
        // Pruned 5-tool surface — write types. Regression for #925 —
        // these must stay out of the read allowlist or document state
        // can diverge under concurrent AI-client load.
        "vmark.workspace.new",
        "vmark.workspace.open",
        "vmark.workspace.save",
        "vmark.workspace.save_as",
        "vmark.workspace.close",
        "vmark.workspace.switch_tab",
        "vmark.workspace.focus_window",
        "vmark.document.write",
        "vmark.document.transform",
        "vmark.workflow.apply_patch",
        "vmark.selection.set",
        // Embedded-browser write-class ops (wire types in
        // server/mcp/src/tools/browser.ts). `console` counts as a
        // write because `clear: true` drains the page's console buffer.
        "vmark.browser.act",
        "vmark.browser.open",
        "vmark.browser.navigate",
        "vmark.browser.style",
        "vmark.browser.execute_js",
        "vmark.browser.session.save",
        "vmark.browser.session.load",
        "vmark.browser.console",
    ];
    for op in &write_ops {
        assert!(
            !is_read_only_operation(op),
            "Expected '{}' to be classified as a write (non-read-only) operation",
            op
        );
    }
}

#[test]
fn unknown_operations_not_read_only() {
    assert!(!is_read_only_operation(""));
    assert!(!is_read_only_operation("nonexistent.operation"));
    assert!(!is_read_only_operation("document.getContent ")); // trailing space
}

/// Case sensitivity: operation names are exact-match. Upper/mixed case
/// variants must not accidentally match.
#[test]
fn is_read_only_is_case_sensitive() {
    assert!(!is_read_only_operation("Document.GetContent"));
    assert!(!is_read_only_operation("DOCUMENT.GETCONTENT"));
    assert!(!is_read_only_operation("document.getcontent"));
    assert!(!is_read_only_operation("SELECTION.GET"));
    assert!(!is_read_only_operation("Outline.Get"));
}

/// Whitespace edge cases: leading, trailing, embedded spaces must not match.
#[test]
fn is_read_only_rejects_whitespace_variants() {
    assert!(!is_read_only_operation(" document.getContent"));
    assert!(!is_read_only_operation("document.getContent "));
    assert!(!is_read_only_operation(" document.getContent "));
    assert!(!is_read_only_operation("document .getContent"));
    assert!(!is_read_only_operation("document. getContent"));
    assert!(!is_read_only_operation("\tdocument.getContent"));
    assert!(!is_read_only_operation("document.getContent\n"));
}

/// Partial/substring matches must not trigger a read-only classification.
#[test]
fn is_read_only_rejects_partial_matches() {
    assert!(!is_read_only_operation("document"));
    assert!(!is_read_only_operation("getContent"));
    assert!(!is_read_only_operation("document."));
    assert!(!is_read_only_operation(".getContent"));
    assert!(!is_read_only_operation("document.getContent.extra"));
    assert!(!is_read_only_operation("prefix.document.getContent"));
}

/// Unicode and special character strings should never match.
#[test]
fn is_read_only_rejects_unicode_and_special_chars() {
    assert!(!is_read_only_operation("document.getContent\u{200B}")); // zero-width space
    assert!(!is_read_only_operation("döcument.getContent"));
    assert!(!is_read_only_operation("文档.获取内容"));
    assert!(!is_read_only_operation("document\0getContent")); // null byte
}

/// Very long strings should not cause issues.
#[test]
fn is_read_only_handles_long_strings() {
    let long_op = "a".repeat(10_000);
    assert!(!is_read_only_operation(&long_op));
}

// -- try_register_pending ---------------------------------------------------
//
// Uses a LOCAL BridgeState (fields are pub(crate)) so the overload cap can
// be exercised without stuffing 1000 entries into the shared global map
// that parallel tests also touch.

fn local_state() -> BridgeState {
    BridgeState::default()
}

fn fresh_pending() -> (PendingRequest, oneshot::Receiver<McpResponse>) {
    let (tx, rx) = oneshot::channel::<McpResponse>();
    (
        PendingRequest {
            response_tx: tx,
            created_at: Instant::now(),
        },
        rx,
    )
}

#[test]
fn try_register_pending_inserts_below_cap() {
    let mut state = local_state();
    let (tx, _rx) = oneshot::channel::<McpResponse>();

    try_register_pending(&mut state, "req-1".to_string(), tx).expect("must register");

    assert!(state.pending.contains_key("req-1"));
}

#[test]
fn try_register_pending_rejects_at_cap_with_client_facing_error() {
    let mut state = local_state();
    let mut rxs = Vec::new();
    for i in 0..MAX_PENDING_REQUESTS {
        let (req, rx) = fresh_pending();
        state.pending.insert(format!("fill-{i}"), req);
        rxs.push(rx);
    }

    let (tx, _rx) = oneshot::channel::<McpResponse>();
    let err =
        try_register_pending(&mut state, "overflow".to_string(), tx).expect_err("cap must reject");

    // The exact message the client receives instead of hanging.
    assert_eq!(
        err,
        format!(
            "MCP bridge pending request queue full ({} in flight)",
            MAX_PENDING_REQUESTS
        )
    );
    assert!(!state.pending.contains_key("overflow"));
}

#[test]
fn try_register_pending_sweeps_stale_entries_before_cap_check() {
    use std::time::Duration;

    let mut state = local_state();
    for i in 0..MAX_PENDING_REQUESTS {
        let (tx, _rx) = oneshot::channel::<McpResponse>();
        state.pending.insert(
            format!("stale-{i}"),
            PendingRequest {
                response_tx: tx,
                created_at: Instant::now() - Duration::from_secs(PENDING_TTL_SECS * 2),
            },
        );
    }

    let (tx, _rx) = oneshot::channel::<McpResponse>();
    try_register_pending(&mut state, "fresh".to_string(), tx)
        .expect("stale entries must be swept, freeing capacity");

    assert!(state.pending.contains_key("fresh"));
    assert_eq!(state.pending.len(), 1, "all stale entries swept");
}

// -- webview heartbeat ----------------------------------------------------
//
// These used to be ONE test with a "Restore" line at the end, because
// `WEBVIEW_ALIVE` was a process-global `AtomicBool` that parallel tests raced
// over. The flag lives on the managed state now, so each case owns one.

#[test]
fn a_fresh_bridge_considers_the_webview_alive() {
    // A suspicion flag: suspecting a webview nobody has talked to yet would
    // log a wake-retry on the very first request.
    assert!(McpBridgeState::default().is_webview_alive());
}

#[test]
fn the_liveness_flag_round_trips() {
    let bridge = McpBridgeState::default();

    bridge.set_webview_alive(false);
    assert!(!bridge.is_webview_alive());
    bridge.set_webview_alive(true);
    assert!(bridge.is_webview_alive());
}

#[test]
fn repeated_sets_are_idempotent_and_the_last_write_wins() {
    let bridge = McpBridgeState::default();

    for _ in 0..1000 {
        bridge.set_webview_alive(true);
        bridge.set_webview_alive(false);
    }
    assert!(!bridge.is_webview_alive());

    for _ in 0..1000 {
        bridge.set_webview_alive(false);
        bridge.set_webview_alive(true);
    }
    assert!(bridge.is_webview_alive());
}

/// Threads toggling the flag concurrently: the final value is not predictable,
/// but the flag must remain readable and the run must not panic.
#[test]
fn concurrent_toggling_is_safe() {
    let bridge = McpBridgeState::default();
    let barrier = std::sync::Barrier::new(4);

    std::thread::scope(|scope| {
        for i in 0..4 {
            let (bridge, barrier) = (&bridge, &barrier);
            scope.spawn(move || {
                barrier.wait();
                for _ in 0..500 {
                    bridge.set_webview_alive(i % 2 == 0);
                }
            });
        }
    });

    let _ = bridge.is_webview_alive();
}

// -- state isolation (WI-20) ----------------------------------------------
//
// The proof the migration was structural, not cosmetic. `get_bridge_state()`
// returned the SAME `Arc` to every caller in the process, and two tests here
// asserted exactly that (`bridge_state_is_singleton`,
// `bridge_state_shared_mutation`) — which is why every other test had to key
// its entries under a `__test_…__` marker and clean up after itself. These two
// assert the opposite, using the SAME ids on both sides.

#[tokio::test]
async fn two_bridges_do_not_observe_each_others_requests() {
    let first = McpBridgeState::default();
    let second = McpBridgeState::default();

    let (tx, _rx) = oneshot::channel::<McpResponse>();
    try_register_pending(&mut *first.lock().await, "req-1".to_string(), tx)
        .expect("registers on the first bridge");

    assert!(
        second.lock().await.pending.is_empty(),
        "a second bridge must not see the first bridge's in-flight request"
    );
    // …and the SAME id registers cleanly on the second, which it could not do
    // if the two shared a map: the duplicate guard would refuse it.
    let (tx, _rx) = oneshot::channel::<McpResponse>();
    try_register_pending(&mut *second.lock().await, "req-1".to_string(), tx)
        .expect("the same id is free on an independent bridge");
}

#[tokio::test]
async fn two_bridges_mint_client_ids_independently() {
    let first = McpBridgeState::default();
    let second = McpBridgeState::default();

    first.lock().await.next_client_id += 5;

    assert_eq!(
        second.lock().await.next_client_id,
        1,
        "one bridge's client-id counter must not advance another's"
    );
}

// -- shutdown signal and write lock ---------------------------------------

/// Store a sender, take it back, fire it, and verify the receiver gets the
/// signal — the full lifecycle `stop_bridge` depends on.
#[tokio::test]
async fn the_shutdown_signal_is_installed_taken_and_fired_once() {
    let bridge = McpBridgeState::default();
    let (tx, rx) = oneshot::channel::<()>();

    *bridge.shutdown_slot().await = Some(tx);

    let taken = bridge.shutdown_slot().await.take();
    assert!(taken.is_some());
    assert!(
        bridge.shutdown_slot().await.is_none(),
        "the sender is gone after being taken — a second stop must not re-fire it"
    );
    taken.expect("sender").send(()).expect("send");
    assert!(rx.await.is_ok(), "the server loop receives the signal");
}

/// The write lock serializes its holders: a read-yield-write sequence under it
/// cannot lose an increment.
#[tokio::test]
async fn the_write_lock_serializes_its_holders() {
    let bridge = std::sync::Arc::new(McpBridgeState::default());
    let counter = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
    let mut handles = Vec::new();

    for _ in 0..5 {
        let bridge = bridge.clone();
        let counter = counter.clone();
        handles.push(tokio::spawn(async move {
            let _guard = bridge.write_lock().await;
            let value = counter.load(std::sync::atomic::Ordering::SeqCst);
            tokio::task::yield_now().await;
            counter.store(value + 1, std::sync::atomic::Ordering::SeqCst);
        }));
    }
    for handle in handles {
        handle.await.expect("no task may panic");
    }

    assert_eq!(counter.load(std::sync::atomic::Ordering::SeqCst), 5);
}

// -- auth token generation ---------------------------------------------------

#[test]
fn auth_token_is_64_hex_chars() {
    let token = generate_auth_token();
    assert_eq!(token.len(), 64, "Token should be 64 hex chars (32 bytes)");
    assert!(
        token.chars().all(|c| c.is_ascii_hexdigit()),
        "Token should contain only hex chars: {}",
        token
    );
}

#[test]
fn auth_token_is_unique_per_call() {
    let t1 = generate_auth_token();
    let t2 = generate_auth_token();
    assert_ne!(t1, t2, "Two tokens should not be identical");
}

#[test]
fn auth_token_has_sufficient_entropy() {
    // Generate 100 tokens and verify no duplicates
    let tokens: std::collections::HashSet<String> =
        (0..100).map(|_| generate_auth_token()).collect();
    assert_eq!(tokens.len(), 100, "100 tokens should all be unique");
}

// -- pending request TTL --------------------------------------------------

#[tokio::test]
async fn pending_request_has_created_at() {
    let (tx, _rx) = oneshot::channel::<McpResponse>();
    let req = PendingRequest {
        response_tx: tx,
        created_at: std::time::Instant::now(),
    };
    assert!(req.created_at.elapsed().as_secs() < 1);
}

#[tokio::test]
async fn pending_map_cap_is_defined() {
    // Just assert the constant is used where it claims to be
    assert_eq!(MAX_PENDING_REQUESTS, 1000);
}

#[test]
fn cleanup_stale_pending_removes_old_entries() {
    use std::time::Duration;

    let mut state = local_state();
    let (stale_tx, _stale_rx) = oneshot::channel::<McpResponse>();
    state.pending.insert(
        "stale".to_string(),
        PendingRequest {
            response_tx: stale_tx,
            created_at: Instant::now() - Duration::from_secs(PENDING_TTL_SECS * 2),
        },
    );
    let (fresh_tx, _fresh_rx) = oneshot::channel::<McpResponse>();
    state.pending.insert(
        "fresh".to_string(),
        PendingRequest {
            response_tx: fresh_tx,
            created_at: Instant::now(),
        },
    );

    cleanup_stale_pending(&mut state);

    assert!(!state.pending.contains_key("stale"));
    assert!(state.pending.contains_key("fresh"));
}

/// The checked-cutoff path: an entry created "now" must always survive
/// cleanup, and repeated cleanup calls must not panic. (The underflow
/// itself — uptime shorter than the TTL — cannot be simulated in a test,
/// so this exercises the `checked_sub` + `is_none_or` retain logic.)
#[test]
fn cleanup_stale_pending_retains_fresh_instant() {
    let mut state = local_state();
    let (tx, _rx) = oneshot::channel::<McpResponse>();
    state.pending.insert(
        "fresh".to_string(),
        PendingRequest {
            response_tx: tx,
            created_at: Instant::now(),
        },
    );

    cleanup_stale_pending(&mut state);
    cleanup_stale_pending(&mut state);

    assert!(state.pending.contains_key("fresh"));
}
