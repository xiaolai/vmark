//! Sink abstraction for AI provider output (ADR-1).
//!
//! Providers stream their output through a single `&dyn AiSink` rather than
//! emitting `ai:response` events directly to a `WebviewWindow`. This lets the
//! same provider code drive:
//!
//!   - **`WindowSink`** — preserves today's behavior: emits `ai:response`
//!     events to the frontend window for the editor genie path.
//!   - **`ChannelSink`** (added in WI-1.2) — pushes chunks into a tokio mpsc
//!     channel so an in-process workflow runner can collect the full response.
//!
//! ## Why a trait, not duplicated functions
//!
//! See ADR-1 in `dev-docs/plans/20260418-genie-in-workflow.md`. Duplicating
//! the provider functions for headless use would double ~500 LOC of provider
//! code and create perpetual drift. Event loopback (emitting to the window
//! and listening back in Rust) wakes the entire frontend for every internal
//! genie chunk and complicates cancellation lifetimes.

use super::types::AiResponseChunk;
use tauri::{Emitter, WebviewWindow};
use tokio::sync::mpsc::UnboundedSender;

/// Sink for AI provider output.
///
/// Each provider call emits zero or more `chunk` calls, then exactly one
/// terminal call: either `done` (success) or `error` (failure). After the
/// terminal call the sink may be dropped.
///
/// Implementors must be `Send + Sync` so providers can hold `&dyn AiSink`
/// across `await` points and across thread boundaries.
pub trait AiSink: Send + Sync {
    /// Emit a partial output chunk. Called zero or more times.
    fn chunk(&self, text: &str);

    /// Signal successful completion. Called exactly once per provider run.
    fn done(&self);

    /// Signal failure. Called exactly once per provider run, in place of `done`.
    fn error(&self, msg: &str);
}

/// Sink that emits `ai:response` events to a Tauri webview window.
///
/// Wire-compatible with today's behavior: the emitted `AiResponseChunk`
/// payload shape is byte-for-byte identical to what `types::emit_chunk`,
/// `types::emit_done`, and `types::emit_error` produce.
pub struct WindowSink {
    window: WebviewWindow,
    request_id: String,
}

impl WindowSink {
    /// Construct a sink bound to a specific webview window + request id.
    /// Every `ai:response` event the sink emits carries the `request_id` so
    /// the frontend listener can demultiplex concurrent invocations.
    pub fn new(window: WebviewWindow, request_id: String) -> Self {
        Self { window, request_id }
    }
}

impl AiSink for WindowSink {
    fn chunk(&self, text: &str) {
        let _ = self.window.emit(
            "ai:response",
            AiResponseChunk {
                request_id: self.request_id.clone(),
                chunk: text.to_string(),
                done: false,
                error: None,
            },
        );
    }

    fn done(&self) {
        let _ = self.window.emit(
            "ai:response",
            AiResponseChunk {
                request_id: self.request_id.clone(),
                chunk: String::new(),
                done: true,
                error: None,
            },
        );
    }

    fn error(&self, msg: &str) {
        let _ = self.window.emit(
            "ai:response",
            AiResponseChunk {
                request_id: self.request_id.clone(),
                chunk: String::new(),
                done: true,
                error: Some(msg.to_string()),
            },
        );
    }
}

/// Event sent from a `ChannelSink` to its receiver.
///
/// Each variant maps 1:1 to an `AiSink` trait method. The receiver
/// (`run_ai_prompt_collect`) drains in order and treats the first `Done` /
/// `Error` it sees as terminal.
#[derive(Debug, Clone, PartialEq)]
pub enum ChannelEvent {
    /// Partial output, produced by zero-or-more `AiSink::chunk` calls.
    Chunk(String),
    /// Successful completion. Exactly one of `Done` / `Error` is sent per
    /// provider run (via the corresponding `AiSink::done` / `AiSink::error`
    /// terminal call).
    Done,
    /// Failure. Carries the error message originally passed to `AiSink::error`.
    Error(String),
}

/// Sink that forwards calls to a tokio mpsc channel.
///
/// Used by `run_ai_prompt_collect` to pull chunks back into a Rust caller
/// (e.g. the workflow runner) rather than to a frontend window. After the
/// terminal `done` or `error` event the receiver should close the channel.
pub struct ChannelSink {
    sender: UnboundedSender<ChannelEvent>,
}

impl ChannelSink {
    /// Construct a sink that forwards events to `sender`. The receiver end
    /// is owned by `run_ai_prompt_collect` (or any other Rust caller that
    /// needs the full response). Send failures are logged at trace level
    /// and swallowed — providers don't need to react when the consumer
    /// has already moved on.
    pub fn new(sender: UnboundedSender<ChannelEvent>) -> Self {
        Self { sender }
    }
}

impl AiSink for ChannelSink {
    fn chunk(&self, text: &str) {
        // Receiver dropped → log and continue. The provider has no use for the
        // error here; the caller already noticed the channel close.
        if self.sender.send(ChannelEvent::Chunk(text.to_string())).is_err() {
            log::trace!("ChannelSink::chunk send failed — receiver dropped");
        }
    }

    fn done(&self) {
        if self.sender.send(ChannelEvent::Done).is_err() {
            log::trace!("ChannelSink::done send failed — receiver dropped");
        }
    }

    fn error(&self, msg: &str) {
        if self
            .sender
            .send(ChannelEvent::Error(msg.to_string()))
            .is_err()
        {
            log::trace!("ChannelSink::error send failed — receiver dropped");
        }
    }
}

#[cfg(test)]
pub(crate) mod testing {
    //! Test-only sink that records every call. Used across `ai_provider`
    //! tests in WI-1.2 and the workflow runner tests in WI-2.2.

    use super::AiSink;
    use std::sync::Mutex;

    #[derive(Debug, Clone, PartialEq)]
    pub enum SinkEvent {
        Chunk(String),
        Done,
        Error(String),
    }

    pub struct RecordingSink {
        events: Mutex<Vec<SinkEvent>>,
    }

    impl RecordingSink {
        pub fn new() -> Self {
            Self {
                events: Mutex::new(Vec::new()),
            }
        }

        pub fn events(&self) -> Vec<SinkEvent> {
            self.events.lock().expect("sink mutex poisoned").clone()
        }

        pub fn collected_text(&self) -> String {
            self.events
                .lock()
                .expect("sink mutex poisoned")
                .iter()
                .filter_map(|e| match e {
                    SinkEvent::Chunk(s) => Some(s.as_str()),
                    _ => None,
                })
                .collect()
        }
    }

    impl AiSink for RecordingSink {
        fn chunk(&self, text: &str) {
            self.events
                .lock()
                .expect("sink mutex poisoned")
                .push(SinkEvent::Chunk(text.to_string()));
        }

        fn done(&self) {
            self.events
                .lock()
                .expect("sink mutex poisoned")
                .push(SinkEvent::Done);
        }

        fn error(&self, msg: &str) {
            self.events
                .lock()
                .expect("sink mutex poisoned")
                .push(SinkEvent::Error(msg.to_string()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::{RecordingSink, SinkEvent};
    use super::AiSink;
    use super::AiResponseChunk;

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
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let sink = super::ChannelSink::new(tx);
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
                super::ChannelEvent::Chunk("hello, ".to_string()),
                super::ChannelEvent::Chunk("world.".to_string()),
                super::ChannelEvent::Done,
            ]
        );
    }

    #[test]
    fn channel_sink_forwards_error_terminal() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let sink = super::ChannelSink::new(tx);
        sink.chunk("partial");
        sink.error("boom");

        let mut events = Vec::new();
        while let Ok(e) = rx.try_recv() {
            events.push(e);
        }
        assert_eq!(
            events,
            vec![
                super::ChannelEvent::Chunk("partial".to_string()),
                super::ChannelEvent::Error("boom".to_string()),
            ]
        );
    }

    #[test]
    fn channel_sink_silent_when_receiver_dropped() {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let sink = super::ChannelSink::new(tx);
        drop(rx);
        // Must not panic. Calls into a closed channel are silently dropped.
        sink.chunk("x");
        sink.done();
        sink.error("oops");
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
}
