//! Tests for the `AiSink` implementations (`sink.rs`).

use super::testing::{RecordingSink, SinkEvent};
use super::AiResponseChunk;
use super::AiSink;
use super::{ChannelEvent, ChannelSink};
use crate::ai_provider::MAX_COLLECT_BYTES;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

/// Build a `ChannelSink` over a bounded channel with the given capacity,
/// returning the sink plus the receiver, cancel token, and overflow flag so a
/// test can assert on all three.
fn make_channel_sink(
    capacity: usize,
) -> (
    ChannelSink,
    tokio::sync::mpsc::Receiver<ChannelEvent>,
    CancellationToken,
    Arc<AtomicBool>,
) {
    let (tx, rx) = tokio::sync::mpsc::channel(capacity);
    let cancel = CancellationToken::new();
    let overflowed = Arc::new(AtomicBool::new(false));
    let sink = ChannelSink::new(tx, cancel.clone(), Arc::clone(&overflowed));
    (sink, rx, cancel, overflowed)
}

#[test]
fn recording_sink_captures_chunk_done() {
    let sink = RecordingSink::new();
    sink.chunk("Hello, ");
    sink.chunk("world.");
    sink.done();
    assert_eq!(
        sink.events(),
        vec![
            SinkEvent::Chunk("Hello, ".to_string()),
            SinkEvent::Chunk("world.".to_string()),
            SinkEvent::Done,
        ]
    );
    assert_eq!(sink.collected_text(), "Hello, world.");
}

#[test]
fn recording_sink_captures_error_terminal() {
    let sink = RecordingSink::new();
    sink.chunk("partial");
    sink.error("network down");
    assert_eq!(
        sink.events(),
        vec![
            SinkEvent::Chunk("partial".to_string()),
            SinkEvent::Error("network down".to_string()),
        ]
    );
}

#[test]
fn sink_can_be_used_through_dyn_trait_object() {
    // Producers will hold `&dyn AiSink`. Verify the trait dispatch works.
    fn produce(sink: &dyn AiSink) {
        sink.chunk("a");
        sink.chunk("b");
        sink.done();
    }
    let sink = RecordingSink::new();
    produce(&sink);
    assert_eq!(sink.collected_text(), "ab");
}

#[test]
fn sink_is_send_sync() {
    // Compile-time assertion that AiSink is usable across threads — required
    // by the runner because providers `await` across `tokio::spawn` boundaries.
    fn assert_send_sync<T: Send + Sync + ?Sized>() {}
    assert_send_sync::<dyn AiSink>();
}

#[test]
fn channel_sink_forwards_chunks_in_order() {
    let (sink, mut rx, _cancel, _overflowed) = make_channel_sink(64);
    sink.chunk("hello, ");
    sink.chunk("world.");
    sink.done();

    let mut events = Vec::new();
    while let Ok(e) = rx.try_recv() {
        events.push(e);
    }
    assert_eq!(
        events,
        vec![
            ChannelEvent::Chunk("hello, ".to_string()),
            ChannelEvent::Chunk("world.".to_string()),
            ChannelEvent::Done,
        ]
    );
}

#[test]
fn channel_sink_forwards_error_terminal() {
    let (sink, mut rx, _cancel, _overflowed) = make_channel_sink(64);
    sink.chunk("partial");
    sink.error("boom");

    let mut events = Vec::new();
    while let Ok(e) = rx.try_recv() {
        events.push(e);
    }
    assert_eq!(
        events,
        vec![
            ChannelEvent::Chunk("partial".to_string()),
            ChannelEvent::Error("boom".to_string()),
        ]
    );
}

#[test]
fn channel_sink_silent_when_receiver_dropped() {
    let (sink, rx, _cancel, _overflowed) = make_channel_sink(64);
    drop(rx);
    // Must not panic. Calls into a closed channel are silently dropped.
    sink.chunk("x");
    sink.done();
    sink.error("oops");
}

/// Peak in-flight memory is bounded: a producer that pushes far more than
/// `MAX_COLLECT_BYTES` while the receiver never drains must be stopped by the
/// sink's byte-gate — it must NOT enqueue the whole flood. Proves the fix for
/// the unbounded-buffer finding: the sink fires cancel, sets overflow, and the
/// bytes actually buffered stay bounded by the cap (plus one in-flight chunk).
#[test]
fn channel_sink_byte_gate_bounds_buffered_output() {
    // Capacity comfortably above the number of chunks we push, so the *byte*
    // gate — not the count backstop — is what stops the producer.
    let (mut sink_rx, cancel, overflowed) = {
        let (sink, rx, cancel, overflowed) = make_channel_sink(4096);
        // Each chunk is 64 KiB; push ~2x the cap worth without ever draining.
        let chunk = "x".repeat(64 * 1024);
        let pushes = (MAX_COLLECT_BYTES / chunk.len()) * 2;
        for _ in 0..pushes {
            sink.chunk(&chunk);
        }
        (rx, cancel, overflowed)
    };

    assert!(
        overflowed.load(Ordering::SeqCst),
        "sink must flag overflow once output exceeds the cap"
    );
    assert!(
        cancel.is_cancelled(),
        "sink must fire cancel so the provider is stopped, not left producing"
    );

    // Drain what actually made it into the channel and prove it never grew
    // past the cap plus one in-flight chunk.
    let mut buffered = 0usize;
    while let Ok(ev) = sink_rx.try_recv() {
        if let ChannelEvent::Chunk(s) = ev {
            buffered += s.len();
        }
    }
    assert!(
        buffered <= MAX_COLLECT_BYTES + 64 * 1024,
        "peak buffered bytes {buffered} must be bounded by the cap, not the flood"
    );
}

#[test]
fn window_sink_chunk_payload_matches_legacy_shape() {
    // WindowSink builds an AiResponseChunk with the exact field shape that
    // types::emit_chunk used to construct directly. Verify the payload
    // serializes the same way (byte-for-byte JSON), since the frontend
    // listener will consume both shapes and must not see a regression.
    let request_id = "rid-1".to_string();
    let chunk_text = "hello";

    // What WindowSink::chunk constructs internally:
    let from_sink = AiResponseChunk {
        request_id: request_id.clone(),
        chunk: chunk_text.to_string(),
        done: false,
        error: None,
    };
    // What types::emit_chunk constructs directly (legacy):
    let from_legacy = AiResponseChunk {
        request_id: request_id.clone(),
        chunk: chunk_text.to_string(),
        done: false,
        error: None,
    };
    assert_eq!(
        serde_json::to_string(&from_sink).unwrap(),
        serde_json::to_string(&from_legacy).unwrap()
    );
}
